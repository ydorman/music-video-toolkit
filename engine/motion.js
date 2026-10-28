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
const lerp2=(a,b,k)=>[lerp(a[0],b[0],k),lerp(a[1],b[1],k)];
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
function legIK(d,side,target,yawQ,o={}){
  const b=d.bones, ul=b['upperleg01.'+side], ll=b['lowerleg01.'+side], ft=b['foot.'+side];
  const H=ul.getWorldPosition(new THREE.Vector3());
  const r=d.rest, sc=d.sc;
  const L1=r['lowerleg01.'+side].distanceTo(r['upperleg01.'+side])*sc, L2=r['foot.'+side].distanceTo(r['lowerleg01.'+side])*sc;
  const T=target.clone(); let dv=T.clone().sub(H); let dist=Math.min(dv.length(),(L1+L2)*0.999); const dir=dv.normalize();
  const a=(L1*L1-L2*L2+dist*dist)/(2*dist), hh=Math.sqrt(Math.max(0,L1*L1-a*a));
  const fwd=o.pole?o.pole.clone():new THREE.Vector3(0,0,1).applyQuaternion(yawQ); const pole=fwd.sub(dir.clone().multiplyScalar(fwd.dot(dir))).normalize();
  const K=H.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(hh));
  aim(ul,ll,K.clone().sub(H).normalize());
  const Kw=ll.getWorldPosition(new THREE.Vector3());
  aim(ll,ft,T.clone().sub(Kw).normalize());
  // keep the foot flat, pointing where the body points
  const toe=b['toe3-1.'+side]; let rf=r['toe3-1.'+side].clone().sub(r['foot.'+side]).normalize().applyQuaternion(yawQ);
  if(o.point) rf.lerp(o.point,o.pointW===undefined?1:o.pointW).normalize();      // pointed foot along the leg
  if(o.releve){ const h=rf.clone().setY(0).normalize(); rf=h.multiplyScalar(Math.cos(o.releve*1.05)).add(new THREE.Vector3(0,-Math.sin(o.releve*1.05),0)).normalize(); }
  aim(ft,toe,rf);
}

// ---------- timeline (choreography.json "timeline"): per actor, where they are, travel and face, section by section.
// Entries {at, to:[x,z] (travel there over "bars", default 2; the first entry places the actor), face: degrees (0 = audience)
// | actor spot | [x,z] point | "path", turn_bars (default 1)}. Feet step on the accents while moving or turning.
// Everything is a pure function of t. Actors without a timeline keep the looping step pattern and turn.
const ACC=new Set((TRACK.accents||[1]).map(a=>((a-1)%CPB+CPB)%CPB));
const TLD=CFG.map(c=>{ const L=CHOREO.timeline&&CHOREO.timeline[c.spot]; if(!L||!L.length) return null; const bar=CPB*F.beat_period;
  return L.map(e=>({T:atTime(e.at), dur:(e.bars===undefined?2:e.bars)*bar, to:e.to||null, face:e.face, turnDur:(e.turn_bars===undefined?1:e.turn_bars)*bar,
    phrase:e.phrase, phraseBlend:(e.phrase_blend===undefined?0.5:e.phrase_blend)*bar})).sort((a,b)=>a.T-b.T); });
const angDiff=(a,b)=>{ let d=(b-a)%(2*Math.PI); if(d>Math.PI) d-=2*Math.PI; if(d<-Math.PI) d+=2*Math.PI; return d; };
function tlPos(i,t){
  const L=TLD[i], s0=L[0].to||SPOT_POS[CFG[i].spot]||[0,0];
  let sx=s0[0], sz=s0[1], tx=sx, tz=sz, T0=L[0].T, dur=1;
  for(let k=1;k<L.length;k++){ const e=L[k]; if(e.T>t) break; if(!e.to) continue;
    const u=ease(clamp((e.T-T0)/dur)); sx=lerp(sx,tx,u); sz=lerp(sz,tz,u); tx=e.to[0]; tz=e.to[1]; T0=e.T; dur=e.dur; }
  const u=ease(clamp((t-T0)/dur)); return [lerp(sx,tx,u), lerp(sz,tz,u)];
}
function faceTarget(i,f,t,p){
  if(f===undefined||f===null) return null;
  if(typeof f==='number') return f*D;
  let q=null;
  if(f==='path'){ const a=tlPos(i,t), b=tlPos(i,t+0.4); if(Math.hypot(b[0]-a[0],b[1]-a[1])<0.01) return null; q=[p[0]+b[0]-a[0], p[1]+b[1]-a[1]]; }
  else if(Array.isArray(f)) q=f;
  else { const j=SPOT_I[f]; if(j===undefined) return null; q=TLD[j]?tlPos(j,t):(SPOT_POS[f]||[0,0]); }
  return Math.atan2(q[0]-p[0], q[1]-p[1]);
}
function tlYaw(i,t){
  const L=TLD[i]; let k=0; for(let j=0;j<L.length;j++){ if(L[j].T<=t) k=j; else break; }
  while(k>0 && L[k].face===undefined) k--;
  const e=L[k], tgt=faceTarget(i,e.face,t,tlPos(i,t));
  if(k===0) return tgt===null?0:tgt;
  const start=tlYaw(i,e.T-1e-3); if(tgt===null) return start;
  return start+angDiff(start,tgt)*ease(clamp((t-e.T)/e.turnDur));
}
const pulseTime=n=>F.beat_offset+P.offsetMs/1000+(n+P.shift+F.bar_phase)*F.beat_period;
function tlFeet(d,t){   // world foot targets {L:[x,y,z], R:[...]}: planted, stepping on the accents while the actor moves or turns
  const i=d.i, L=TLD[i]; let k=-1; for(let j=1;j<L.length;j++){ if(L[j].T>t) break; if(L[j].to||L[j].face!==undefined) k=j; }   // phrase-only entries don't step
  const stance=(side,tt)=>{ const p=tlPos(i,tt), q=new THREE.Quaternion().setFromAxisAngle(UPV,yawAt(i,tt));
    const r=d.rest['foot.'+side].clone().sub(new THREE.Vector3(d.rest.root.x,0,d.rest.root.z)).multiplyScalar(d.sc).applyQuaternion(q);
    return [p[0]+r.x, p[1]+r.z]; };
  const out={}, fy=s=>d.rest['foot.'+s].y*d.sc;
  out.moving=0;
  if(k<0){ ['L','R'].forEach(s=>{ const f=stance(s,t); out[s]=[f[0],fy(s),f[1]]; }); return out; }
  const e=L[k], Tend=e.T+Math.max(e.to?e.dur:0, e.face!==undefined?e.turnDur:0);
  const lands=[]; let after=0;
  for(let n=Math.ceil(beatPos(e.T)+1e-6); after<2 && lands.length<200; n++){ const tt=pulseTime(n); if(!ACC.has(((n%CPB)+CPB)%CPB)) continue;
    lands.push(tt); if(tt>Tend) after++; }
  ['L','R'].forEach((s,si)=>{
    const mine=lands.filter((_,j)=>j%2===si);
    let from=stance(s,e.T), lift=0, j=0;
    const land=j=>stance(s,mine[j]+0.4*(mine[j]-(j>0?mine[j-1]:e.T)));   // the foot reaches ahead, where the body will be
    while(j<mine.length && mine[j]<=t){ from=land(j); j++; }
    let f=from;
    if(j<mine.length){ const tn=mine[j], prev=j>0?mine[j-1]:e.T, sw=Math.min(0.6*(tn-prev),0.8), u=clamp((t-(tn-sw))/sw);
      if(u>0){ const to=land(j), k2=ease(u); f=[lerp(from[0],to[0],k2), lerp(from[1],to[1],k2)]; lift=Math.sin(Math.PI*u)*0.05; } }
    out[s]=[f[0],fy(s)+lift,f[1]]; });
  // walking weight: 1 from the first step to the last landing (eased in and out over half a second)
  if(lands.length>2){ const a=lands[0]-0.6, z=lands[lands.length-1]; out.moving=clamp((t-a)/0.5)*clamp((z-t)/0.5); }
  return out;
}

// ---------- phrases: timeline entries {"phrase": name} start a phrase (choreography.json "phrases": {name: {bars, keys:
// [{at: count 1.., pose}]}}), aligned to the bar where the entry starts, looping; each pose arrives on its count (the move
// takes the preview's transition share of the gap before it). Changing phrase blends over "phrase_blend" bars (0.5).
const POSE_SRC=Object.assign({},POSE_LIB,CHOREO.poses||{}), _poseCache={};
const ZERO_POSE={L:[8,5,5,0,0],R:[8,5,5,0,0],head:[0,0],torso:[0,0,0],plie:0,releve:0,legL:[0,0,0],legR:[0,0,0],turn:0};
function poseSpec(name){
  if(_poseCache[name]) return _poseCache[name];
  let p;
  if(!POSE_SRC[name] && /_L$/.test(name) && POSE_SRC[name.slice(0,-2)+'_R']){ const m=poseSpec(name.slice(0,-2)+'_R');
    p={L:[...m.R],R:[...m.L],head:[m.head[0],-m.head[1]],torso:[m.torso[0],-m.torso[1],-m.torso[2]],plie:m.plie,releve:m.releve,legL:[...m.legR],legR:[...m.legL],turn:-m.turn}; }
  else { const src=POSE_SRC[name]||{}; const b=src.base?poseSpec(src.base):ZERO_POSE;
    p=JSON.parse(JSON.stringify(b)); p.turn=0;
    if(src.arms){ p.L=[...src.arms]; p.R=[...src.arms]; } if(src.left) p.L=[...src.left]; if(src.right) p.R=[...src.right];
    ['head','torso'].forEach(k=>{ if(src[k]) p[k]=[...src[k]]; }); ['plie','releve','turn'].forEach(k=>{ if(src[k]!==undefined) p[k]=src[k]; });
    if(src.leg){ if(src.leg.left) p.legL=[...src.leg.left]; if(src.leg.right) p.legR=[...src.leg.right]; } }
  return _poseCache[name]=p;
}
const mixPose=(a,b,u)=>{ const o={}; for(const k in a) o[k]=Array.isArray(a[k])?a[k].map((v,j)=>lerp(v,b[k][j],u)):lerp(a[k],b[k],u); return o; };
const PHRASES=CHOREO.phrases||{};
const PH=CFG.map((c,i)=>TLD[i]?TLD[i].filter(e=>e.phrase&&PHRASES[e.phrase]).map(e=>{ const ph=PHRASES[e.phrase], len=(ph.bars||1)*CPB;
  const keys=ph.keys.map(k=>({a:k.at-1, pose:poseSpec(k.pose)})).sort((x,y)=>x.a-y.a);
  return {T:e.T, q0:Math.floor(beatPos(e.T)/CPB+1e-6)*CPB, len, keys, total:keys.reduce((s,k)=>s+k.pose.turn,0)*D, blend:e.phraseBlend}; }):[]);
function phraseEval(ph,t){
  const q=beatPos(t)-ph.q0, cyc=Math.floor(q/ph.len), r=q-cyc*ph.len, K=ph.keys, n=K.length;
  let j=n-1; for(let m=0;m<n;m++) if(K[m].a<=r) j=m; else break;      // last key reached (wraps to the previous cycle's last)
  const A=K[j], Bi=(j+1)%n, B=K[Bi], a=(A.a<=r)?A.a:A.a-ph.len, b=(Bi>j&&A.a<=r)?B.a:B.a+(A.a<=r?ph.len:0);
  const span=Math.max(1e-3,b-a), sh=Math.max(0.05,P.sharp), u=ease(clamp((r-(b-sh*span))/(sh*span)));
  let spin=cyc*ph.total; for(let m=0;m<n;m++) if(K[m].a<=r) spin+=K[m].pose.turn*D;
  return {pose:mixPose(A.pose,B.pose,u), spin:spin+B.pose.turn*D*u};
}
function phraseIndex(i,t){ const L=PH[i]; let k=-1; for(let j=0;j<L.length;j++){ if(L[j].T<=t) k=j; else break; } return k; }
function poseAt(i,t){                   // the actor's pose at t (blended across a phrase change), or null without phrases
  const L=PH[i], k=phraseIndex(i,t); if(k<0) return null;
  const cur=phraseEval(L[k],t).pose; if(k===0) return cur;
  const u=clamp((t-L[k].T)/Math.max(1e-3,L[k].blend)); return u>=1?cur:mixPose(phraseEval(L[k-1],t).pose,cur,ease(u));
}
function phraseSpin(i,t){               // total turning from phrases, continuous across phrase changes
  const L=PH[i], k=phraseIndex(i,t); if(k<0) return 0;
  let s=0; for(let j=0;j<k;j++) s+=phraseEval(L[j],L[j+1].T).spin-phraseEval(L[j],L[j].T).spin;
  return s+phraseEval(L[k],t).spin-phraseEval(L[k],L[k].T).spin;
}
const yawAt=(i,t)=>tlYaw(i,t)+phraseSpin(i,t);

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
  if(!TLD[i] && P.turnPos && ci===P.turnPos-1 && slotEnd<=P.outStart){ rot=2*Math.PI*ease(clamp((frac-0.04)/0.85)); }
  let cx=lerp(S0[0],S1[0],kb)*st*0.5, cz=lerp(S0[1],S1[1],kb)*st*0.5;
  if(TLD[i]){ const p=tlPos(i,ti), sp=SPOT_POS[CFG[i].spot]||[0,0]; cx=p[0]-sp[0]; cz=p[1]-sp[1]; rot=yawAt(i,ti); }
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
    const feet=TLD[d.i]?tlFeet(d,ti):null;
    // pose from the actor's phrase (null: the looping positions); walking softens plie/releve and drops leg gestures
    const PZ=feet?poseAt(d.i,ti):null, ow=1-oW, wk=feet?feet.moving:0;
    const pl=PZ?PZ.plie*(1-0.7*wk)*ow:0, rl=PZ?PZ.releve*(1-0.7*wk)*ow:0;
    const gest=side=>{ if(!PZ) return [0,0,0]; const g=side==='L'?PZ.legR:PZ.legL; return [g[0],g[1]*(1-wk)*ow,g[2]]; };   // bone L = audience right
    // root: shift weight between the feet (or over the standing leg), dip on the downbeat, plie/releve, turn
    resetPose(d);
    const root=d.bones.root;
    let shx=0, shz=0;
    if(feet){ const hL=gest('L')[1], hR=gest('R')[1], w=clamp(Math.max(hL,hR)/25)*0.55;
      if(w>0){ const sup=feet[hL>hR?'R':'L'], rx=d.group.position.x+d.rest.root.x*d.sc+cx, rz=d.group.position.z+d.rest.root.z*d.sc+cz;
        shx=(sup[0]-rx)*w; shz=(sup[2]-rz)*w; } }
    root.position.set(d.rest.root.x+(cx+shx)/d.sc, d.rest.root.y-(dip*0.045+pl*0.11-rl*0.06)/d.sc, d.rest.root.z+(cz+shz)/d.sc);
    root.quaternion.copy(yawQ);
    d.group.updateMatrixWorld(true);
    const xr=new THREE.Vector3(1,0,0).applyQuaternion(yawQ), zr=new THREE.Vector3(0,0,1).applyQuaternion(yawQ);
    // a slight personal lean
    rotWorld(d.bones.spine03,new THREE.Quaternion().setFromAxisAngle(zr,TILT[d.i]*0.006));
    // torso: bend forward, to the side (toward the audience's right), twist; spread over three spine bones
    if(PZ){ const [tf,ts,tw]=PZ.torso.map(v=>v*ow*D/3);
      ['spine04','spine03','spine02'].forEach(bn=>rotWorld(d.bones[bn],new THREE.Quaternion().setFromAxisAngle(xr,tf).multiply(new THREE.Quaternion().setFromAxisAngle(zr,-ts)).multiply(new THREE.Quaternion().setFromAxisAngle(UPV,tw)))); }
    // legs: feet follow the timeline steps (or the step pattern); a gesture leg reaches out by IK with a pointed foot
    ['L','R'].forEach(side=>{
      const s=side==='L'?1:-1, kk=(s===leadSide)?kl:kt;
      const lift=Math.sin(Math.PI*clamp((s===leadSide?bf/0.16:(bf-0.1)/0.22)))*0.04*(st>0?1:0);
      const off=new THREE.Vector3(lerp(S0[0],S1[0],kk)*st*0.5,0,lerp(S0[1],S1[1],kk)*st*0.5);
      const restLocal=d.rest['foot.'+side].clone().sub(new THREE.Vector3(d.rest.root.x,0,d.rest.root.z)).multiplyScalar(d.sc);
      restLocal.applyQuaternion(yawQ);
      const T=new THREE.Vector3(d.group.position.x,0,d.group.position.z).add(restLocal).add(off); T.y=d.rest['foot.'+side].y*d.sc+lift;
      if(feet) T.set(...feet[side]);
      const o={}, [gd,gh,gk]=gest(side), gw=clamp(gh/20);
      if(gw>0){
        const hip=d.bones['upperleg01.'+side].getWorldPosition(new THREE.Vector3()), r=d.rest;
        const len=(r['lowerleg01.'+side].distanceTo(r['upperleg01.'+side])+r['foot.'+side].distanceTo(r['lowerleg01.'+side]))*d.sc*(1-0.42*gk);
        const out=new THREE.Vector3(s,0,0).applyQuaternion(yawQ), fw=new THREE.Vector3(0,0,1).applyQuaternion(yawQ);
        const hz=fw.multiplyScalar(Math.cos(gd*D)).add(out.multiplyScalar(Math.sin(gd*D)));
        const v=new THREE.Vector3(0,-Math.cos(gh*D),0).add(hz.multiplyScalar(Math.sin(gh*D))).normalize();
        const G=hip.clone().addScaledVector(v,len); G.y=Math.max(G.y,T.y);
        T.lerp(G,gw); o.point=v; o.pointW=gw; o.pole=gd>110?UPV.clone():new THREE.Vector3(0,0,1).applyQuaternion(yawQ);
      } else if(rl>0){ T.y+=rl*0.06; o.releve=rl; }
      legIK(d,side,T,yawQ,o);
    });
    // arms
    const qa=PZ?{L:lerpArm(armOf(PZ.L),FINAL.L,oW), R:lerpArm(armOf(PZ.R),FINAL.R,oW)}
              :{L:lerpArm(lerpArm(prev.L,cur.L,k),FINAL.L,oW), R:lerpArm(lerpArm(prev.R,cur.R,k),FINAL.R,oW)};
    ['L','R'].forEach(side=>{
      const s=side==='L'?1:-1, b=d.bones;
      // our "L" in the position table is the dancer's right as seen from the audience
      const qq=side==='L'?qa.R:qa.L;
      const [upD,foD,abd]=armDirs(s,qq,PERS[d.i],yawQ);
      const elev=Math.max(0,abd-80)*0.22*D;
      rotWorld(b['clavicle.'+side],new THREE.Quaternion().setFromAxisAngle(zr,s*elev));
      aim(b['upperarm01.'+side],b['lowerarm01.'+side],upD);
      aim(b['lowerarm01.'+side],b['wrist.'+side],foD);
      rotWorld(b['lowerarm02.'+side],new THREE.Quaternion().setFromAxisAngle(foD,-s*qq.palm*D));
    });
    // head
    const h0=PZ?PZ.head:lerp2(prev.head,cur.head,k);
    const hb=lerp(h0[0],FINAL.head[0],oW)+dip*6, ht=lerp(h0[1],0,oW)+TILT[d.i];
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

