// Motion: positions, steps, turns, leg IK, start/end, and the per-frame animate(t). Positions and step pattern come from choreography.json.
// ---------- posing helpers (work in world space, independent of bone axes)
const _q=new THREE.Quaternion(), _qp=new THREE.Quaternion(), _qi=new THREE.Quaternion(), _a=new THREE.Vector3(), _b=new THREE.Vector3(), _c=new THREE.Vector3();
function rotWorld(bone,qw){ // apply world-space rotation qw to bone
  bone.parent.getWorldQuaternion(_qp); _qi.copy(_qp).invert();
  bone.quaternion.premultiply(_qp).premultiply(qw).premultiply(_qi);
  bone.updateMatrixWorld(true);
}
function aim(bone,endBone,dirW,twist=0){
  bone.getWorldPosition(_a); endBone.getWorldPosition(_b); _c.subVectors(_b,_a).normalize();
  _q.setFromUnitVectors(_c,dirW);
  if(twist){ const t=new THREE.Quaternion().setFromAxisAngle(dirW,twist); _q.premultiply(t); }
  rotWorld(bone,_q);
}
function resetPose(d){ Object.values(d.bones).forEach(b=>b.quaternion.identity()); d.bones.root.position.copy(d.rest.root); }

// ---------- positions: per arm [raise to side, raise forward, elbow forward, elbow in-plane, palm twist], head [bow, tilt]
const A=(abd,flex,ex,ez,palm)=>({abd,flex,ex,ez,palm});
const armOf=a=>A(...a);
const SEQ=CHOREO.positions.map(s=>({name:s.name, L:armOf(s.left), R:armOf(s.right), head:s.head}));
const STEPS=CHOREO.step_pattern;
const FINAL={L:armOf(CHOREO.final_pose.left), R:armOf(CHOREO.final_pose.right), head:CHOREO.final_pose.head};
const NPOS=SEQ.length;
function lerpArm(a,b,k){ const o={}; for(const key in a) o[key]=lerp(a[key],b[key],k); return o; }
const _e=new THREE.Euler(), _m3=new THREE.Quaternion(), _m4=new THREE.Quaternion();
function armDirs(s,q,pers,yawQ){
  const abd=q.abd*pers[0]+pers[1];
  _m3.setFromEuler(_e.set(-q.flex*D,0,s*abd*D,'XYZ'));
  _m4.setFromEuler(_e.set(-q.ex*D,0,s*q.ez*D,'XYZ'));
  const up=new THREE.Vector3(0,-1,0).applyQuaternion(_m3).applyQuaternion(yawQ);
  const fo=new THREE.Vector3(0,-1,0).applyQuaternion(_m4).applyQuaternion(_m3).applyQuaternion(yawQ);
  return [up,fo,abd];
}
const UPV=new THREE.Vector3(0,1,0);
function legIK(d,side,target,yawQ){
  const b=d.bones, ul=b['upperleg01.'+side], ll=b['lowerleg01.'+side], ft=b['foot.'+side];
  const H=ul.getWorldPosition(new THREE.Vector3());
  const r=d.rest, sc=d.sc;
  const L1=r['lowerleg01.'+side].distanceTo(r['upperleg01.'+side])*sc, L2=r['foot.'+side].distanceTo(r['lowerleg01.'+side])*sc;
  const T=target.clone(); let dv=T.clone().sub(H); let dist=Math.min(dv.length(),(L1+L2)*0.999); const dir=dv.normalize();
  const a=(L1*L1-L2*L2+dist*dist)/(2*dist), hh=Math.sqrt(Math.max(0,L1*L1-a*a));
  const fwd=new THREE.Vector3(0,0,1).applyQuaternion(yawQ); const pole=fwd.sub(dir.clone().multiplyScalar(fwd.dot(dir))).normalize();
  const K=H.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(hh));
  aim(ul,ll,K.clone().sub(H).normalize());
  const Kw=ll.getWorldPosition(new THREE.Vector3());
  aim(ll,ft,T.clone().sub(Kw).normalize());
  // keep the foot flat, pointing where the body points
  const toe=b['toe3-1.'+side]; const rf=r['toe3-1.'+side].clone().sub(r['foot.'+side]).normalize().applyQuaternion(yawQ);
  aim(ft,toe,rf);
}

// per-dancer timing at time t: position slot, step, weight shift (cx, cz in metres) and turn (rot); a pure function of t
function timing(i,t,oW){
  const ti=t-LAG[i]*P.loose;
  const pb=beatPos(ti);
  const posLen=CPB*P.posBars, q=pb/posLen, slot=Math.floor(q), frac=q-slot;
  const ci=((slot%NPOS)+NPOS)%NPOS, pi=(((slot-1)%NPOS)+NPOS)%NPOS;
  const cur=SEQ[ci], prev=SEQ[pi];
  const k=ease(clamp(frac/P.sharp));
  const inBar=((pb%CPB)+CPB)%CPB; 
  const dip=Math.exp(-inBar*1.6)*P.accent*(1-oW);
  const bar=Math.floor(pb/CPB), bf=pb/CPB-bar;
  const NS=STEPS.length, S0=STEPS[(((bar-1)%NS)+NS)%NS], S1=STEPS[((bar%NS)+NS)%NS];
  const kl=ease(clamp(bf/0.16)), kt=ease(clamp((bf-0.1)/0.22)), kb=(kl+kt)/2;
  const leadSide = S1[0]!==0 ? S1[0] : (bar%2?1:-1);
  const st=P.step*(1-oW);
  let rot=0;
  const slotEnd=ti+(1-frac)*posLen*F.beat_period;
  if(P.turnPos && ci===P.turnPos-1 && slotEnd<=P.outStart){ rot=2*Math.PI*ease(clamp((frac-0.04)/0.85)); }
  const cx=lerp(S0[0],S1[0],kb)*st*0.5, cz=lerp(S0[1],S1[1],kb)*st*0.5;
  return {ti,pb,posLen,frac,ci,cur,prev,k,dip,bar,bf,S0,S1,kl,kt,leadSide,st,rot,cx,cz};
}
const outroW=t=>ease(clamp(clamp((t-P.outStart)/Math.max(0.1,P.outLen))*2.2));
// skirt swing: the hem trails where the hips were over the last ~0.4 s and flares out while turning
// (sampled from timing() instead of simulated, so any frame renders the same when scrubbing or rendering)
const SW_TAU=[0.05,0.1,0.16,0.23,0.31,0.4], SW_W=SW_TAU.map(x=>Math.exp(-x/0.14)), SW_SUM=SW_W.reduce((a,b)=>a+b,0);
function skirtSwing(i,t,now){
  let lx=0, lz=0;
  SW_TAU.forEach((tau,j)=>{ const p=timing(i,t-tau,outroW(t-tau)); lx+=SW_W[j]*(p.cx-now.cx); lz+=SW_W[j]*(p.cz-now.cz); });
  lx/=SW_SUM; lz/=SW_SUM;
  const back=timing(i,t-0.08,outroW(t-0.08)); let w=now.rot-back.rot; if(w<0) w+=2*Math.PI;   // turned in the last 80 ms
  const spin=clamp(w/(2*Math.PI*0.08)/1.5);   // 0..1 at 1.5 turns per second
  // into the body's own frame (the skirt morphs are in bind space), scaled up: the cloth swings further than the hips move
  const c=Math.cos(-now.rot), s=Math.sin(-now.rot), g=3.5*P.swing;
  let x=(c*lx+s*lz)*g, z=(-s*lx+c*lz)*g; const L=Math.hypot(x,z), M=0.3; if(L>M){ x*=M/L; z*=M/L; }
  const p1=timing(i,t-0.1,outroW(t-0.1)), speed=Math.hypot(now.cx-p1.cx,now.cz-p1.cz)/0.1;   // hip speed, m/s
  return {x,z,flare:P.swing*(0.8*spin+0.5*clamp(speed/0.6))};
}

// sash colours: each actor with a sash_color (actors.csv) always wears it; choreography.json "partners" lists, from a
// given time ("at", like scene.json), who is paired with whom; the other actor's sash blends to that colour over "blend"
// bars, and an actor in no pair fades back to neutral (the lone one)
const SASH_OWN=CFG.map(c=>c.sash?new THREE.Color(c.sash):null), SPOT_I={}; CFG.forEach((c,i)=>SPOT_I[c.spot]=i);
const PARTNERS=(CHOREO.partners||[]).map(e=>{ const take=CFG.map(()=>null);
    (e.pairs||[]).forEach(([a,b])=>{ const ia=SPOT_I[a], ib=SPOT_I[b]; if(ia===undefined||ib===undefined) return;
      if(SASH_OWN[ib]&&!SASH_OWN[ia]) take[ia]=SASH_OWN[ib]; if(SASH_OWN[ia]&&!SASH_OWN[ib]) take[ib]=SASH_OWN[ia]; });
    return {T:atTime(e.at), dur:(e.blend===undefined?2:e.blend)*CPB*F.beat_period, take}; }).sort((a,b)=>a.T-b.T);
const _sc=new THREE.Color();
function applyCostumeColor(i){ const v=P.colors[CFG[i].spot]||{};   // look.json "colors" override actors.csv (set in place, PARTNERS share these objects)
  if(v.cloth) dancers[i].robeBase.set(v.cloth); if(v.sash&&SASH_OWN[i]) SASH_OWN[i].set(v.sash); }
CFG.forEach((c,i)=>applyCostumeColor(i));
function sashAt(i,t){                 // -> [colour, amount 0..1] or null; a pure function of t
  if(SASH_OWN[i]) return [SASH_OWN[i],1];
  let r=0,g=0,b=0,k=0;                 // colour premultiplied by its amount, so blending to and from neutral is linear
  for(let j=0;j<PARTNERS.length;j++){ const e=PARTNERS[j]; if(t<e.T) break;
    const end=j+1<PARTNERS.length?Math.min(t,PARTNERS[j+1].T):t, u=ease(clamp((end-e.T)/Math.max(1e-3,e.dur))), c=e.take[i];
    r=lerp(r,c?c.r:0,u); g=lerp(g,c?c.g:0,u); b=lerp(b,c?c.b:0,u); k=lerp(k,c?1:0,u); }
  return k>1e-3?[_sc.setRGB(r/k,g/k,b/k),k]:null;
}

let lastT=null;
function animate(t){
  const rms=feat('rms',t), cent=feat('cent',t), flat=feat('flat',t), low=feat('low',t), onset=feat('onset',t);
  // ---- light and color
  const cA=new THREE.Color().setHSL(P.hueDark/360,0.6,0.6), cB=new THREE.Color().setHSL(P.hueBright/360,0.55,0.62);
  const tintC=cA.clone().lerp(cB,cent);
  const lightC=new THREE.Color(0xfff4e6).lerp(tintC,P.tint);
  let L=P.dim*(1-P.resp+P.resp*(0.35+1.15*rms))+onset*0.04; L=clamp(L,0.05,1.3);
  const MS=F.music_start||0;
  const fin=P.fadeIn>0?ease(clamp((t-MS)/P.fadeIn)):(t>=MS?1:0);
  const outro=clamp((t-P.outStart)/Math.max(0.1,P.outLen)), oW=ease(clamp(outro*2.2)), oL=ease(outro);
  L*=fin*(1-oL);
  if(ENV.update) ENV.update(t,{rms,cent,flat,low,onset,L,lightC,tintC,fin,oL});
  else {
  backdrop.material.color.copy(lightC).multiplyScalar(0.42*L);
  back.color.copy(lightC); back.intensity=1.8*L;
  rimL.color.copy(lightC); rimR.color.copy(lightC); rimL.intensity=rimR.intensity=2.6*L;
  front.color.set(0xfff6ea).lerp(tintC,P.tint*0.4); front.intensity=0.16*L;
  fill.intensity=0.02+0.03*L;
  const bg=tintC.clone().multiplyScalar(0.012*L+0.003); scene.background.copy(bg); scene.fog.color.copy(bg);
  scene.fog.density=0.025+P.haze*(0.015+0.045*flat);
  }
  // ---- dancers
  const pb0=beatPos(t), countInBar=Math.floor(((pb0%CPB)+CPB)%CPB);
  dancers.forEach(d=>{
    d.robeMat.color.copy(d.robeBase).lerp(tintC,P.tint*0.25); d.mats.sash.color.copy(d.robeMat.color).multiplyScalar(0.86);
    const sc=sashAt(d.i,t); if(sc) d.mats.sash.color.lerp(sc[0],sc[1]*P.sashTint);
    const {ti,pb,posLen,frac,ci,cur,prev,k,dip,bar,bf,S0,S1,kl,kt,leadSide,st,rot,cx,cz}=timing(d.i,t,oW);
    const yawQ=new THREE.Quaternion().setFromAxisAngle(UPV,rot);
    // root: shift weight between the feet, dip on the downbeat, turn
    resetPose(d);
    const root=d.bones.root;
    root.position.set(d.rest.root.x+cx/d.sc, d.rest.root.y-(dip*0.045)/d.sc, d.rest.root.z+cz/d.sc);
    root.quaternion.copy(yawQ);
    d.group.updateMatrixWorld(true);
    // a slight personal lean
    rotWorld(d.bones.spine03,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1).applyQuaternion(yawQ),TILT[d.i]*0.006));
    // legs: feet follow the step pattern, lead foot first, with a small lift
    ['L','R'].forEach(side=>{
      const s=side==='L'?1:-1, kk=(s===leadSide)?kl:kt;
      const lift=Math.sin(Math.PI*clamp((s===leadSide?bf/0.16:(bf-0.1)/0.22)))*0.04*(st>0?1:0);
      const off=new THREE.Vector3(lerp(S0[0],S1[0],kk)*st*0.5,0,lerp(S0[1],S1[1],kk)*st*0.5);
      const restLocal=d.rest['foot.'+side].clone().sub(new THREE.Vector3(d.rest.root.x,0,d.rest.root.z)).multiplyScalar(d.sc);
      restLocal.applyQuaternion(yawQ);
      const T=new THREE.Vector3(d.group.position.x,0,d.group.position.z).add(restLocal).add(off); T.y=d.rest['foot.'+side].y*d.sc+lift;
      legIK(d,side,T,yawQ);
    });
    // arms
    const qa={L:lerpArm(lerpArm(prev.L,cur.L,k),FINAL.L,oW), R:lerpArm(lerpArm(prev.R,cur.R,k),FINAL.R,oW)};
    ['L','R'].forEach(side=>{
      const s=side==='L'?1:-1, b=d.bones;
      // our "L" in the position table is the dancer's right as seen from the audience
      const qq=side==='L'?qa.R:qa.L;
      const [upD,foD,abd]=armDirs(s,qq,PERS[d.i],yawQ);
      const elev=Math.max(0,abd-80)*0.22*D;
      rotWorld(b['clavicle.'+side],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1).applyQuaternion(yawQ),s*elev));
      aim(b['upperarm01.'+side],b['lowerarm01.'+side],upD);
      aim(b['lowerarm01.'+side],b['wrist.'+side],foD);
      rotWorld(b['lowerarm02.'+side],new THREE.Quaternion().setFromAxisAngle(foD,-s*qq.palm*D));
    });
    // head
    const hb=lerp(lerp(prev.head[0],cur.head[0],k),FINAL.head[0],oW)+dip*6, ht=lerp(lerp(prev.head[1],cur.head[1],k),0,oW)+TILT[d.i];
    const xr=new THREE.Vector3(1,0,0).applyQuaternion(yawQ), zr=new THREE.Vector3(0,0,1).applyQuaternion(yawQ);
    rotWorld(d.bones.neck02,new THREE.Quaternion().setFromAxisAngle(xr,hb*0.5*D));
    rotWorld(d.bones.head,new THREE.Quaternion().setFromAxisAngle(xr,hb*0.5*D).multiply(new THREE.Quaternion().setFromAxisAngle(zr,-ht*D)));
    if(d.robeMesh){ const mi=d.robeMesh.morphTargetInfluences;
      if(mi.length>1 && P.swing>0){ const sw=skirtSwing(d.i,t,{cx,cz,rot}); mi[0]=clamp(P.skirt+sw.flare,0,1.6); mi[1]=sw.x/d.sc; mi[2]=sw.z/d.sc; }
      else { mi[0]=P.skirt; if(mi.length>1) mi[1]=mi[2]=0; } }
    updateSleeves(d);
  });
  cameraUpdate(t);
  renderer.render(scene,camera);
  return {rms,cent,flat,countInBar};
}

