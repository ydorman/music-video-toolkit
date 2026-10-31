// Motion: positions, steps, turns, leg IK, start/end, and the per-frame animate(t). Positions and step pattern come from choreography.json.
// ---------- posing helpers (work in world space, independent of bone axes)
const _q=new THREE.Quaternion(), _qp=new THREE.Quaternion(), _qi=new THREE.Quaternion(), _a=new THREE.Vector3(), _b=new THREE.Vector3(), _c=new THREE.Vector3();
function rotWorld(bone,qw){ // apply world-space rotation qw to bone
  bone.parent.getWorldQuaternion(_qp); _qi.copy(_qp).invert();
  bone.quaternion.premultiply(_qp).premultiply(qw).premultiply(_qi);
  bone.updateMatrixWorld(true);
}
function aim(bone,endBone,dirW,twist=0,via=null){
  bone.getWorldPosition(_a); endBone.getWorldPosition(_b); _c.subVectors(_b,_a).normalize();
  _q.setFromUnitVectors(_c,dirW);
  if(via){ const m=_c.clone().add(dirW).add(via).normalize();   // a near half-turn has no defined twist: always swing by way of "via", so the twist never flips
    _q.setFromUnitVectors(m,dirW).multiply(new THREE.Quaternion().setFromUnitVectors(_c,m)); }
  if(twist){ const t=new THREE.Quaternion().setFromAxisAngle(dirW,twist); _q.premultiply(t); }
  rotWorld(bone,_q);
}
function resetPose(d){ Object.values(d.bones).forEach(b=>b.quaternion.identity()); d.bones.root.position.copy(d.rest.root); }

// ---------- positions: per arm [raise to side, raise forward, elbow forward, elbow in-plane, palm twist], head [bow, tilt]
const A=(abd,flex,ex,ez,palm)=>({abd,flex,ex,ez,palm});
const armOf=a=>A(...a);
const SEQ=CHOREO.positions.map(s=>({name:s.name, L:armOf(s.left), R:armOf(s.right), head:s.head}));
const STEPS=CHOREO.step_pattern;
const TUCK=A(20,15,95,0,0);   // a free arm folded in, the hand in front of the waist
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
  // the foot's direction (heel to ball): flat, pointing where the body points, unless rolled, on releve or pointed
  const toe=b['toe3-1.'+side], Lb=r['toe3-1.'+side].distanceTo(r['foot.'+side])*sc; let rf=r['toe3-1.'+side].clone().sub(r['foot.'+side]).normalize().applyQuaternion(yawQ);
  if(o.point) rf.lerp(o.point,o.pointW===undefined?1:o.pointW).normalize();      // pointed foot along the leg
  if(o.roll){ const h=rf.clone().setY(0).normalize(); rf=h.multiplyScalar(Math.cos(o.roll)).add(new THREE.Vector3(0,-Math.sin(o.roll),0)).normalize(); }   // toes down (+) / up (-)
  const T=target.clone();
  if(o.releve){ const a0=restPitch(d,side), a=lerp(a0,1.05,o.releve), h=rf.clone().setY(0).normalize(); rf=h.multiplyScalar(Math.cos(a)).add(new THREE.Vector3(0,-Math.sin(a),0)).normalize();
    T.y+=Lb*(Math.sin(a)-Math.sin(a0)); }   // up on the ball of the foot: the heel rises just as far as the ball stays down
  let dv=T.clone().sub(H); (d.ikMiss=d.ikMiss||{})[side]=Math.max(0,dv.length()-(L1+L2)*0.999);
  let dist=Math.min(dv.length(),(L1+L2)*0.999); const dir=dv.normalize();
  const a=(L1*L1-L2*L2+dist*dist)/(2*dist), hh=Math.sqrt(Math.max(0,L1*L1-a*a));
  const fwd=o.pole?o.pole.clone():new THREE.Vector3(0,0,1).applyQuaternion(yawQ); const pole=fwd.sub(dir.clone().multiplyScalar(fwd.dot(dir))).normalize();
  const K=H.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(hh));
  aim(ul,ll,K.clone().sub(H).normalize());
  const Kw=ll.getWorldPosition(new THREE.Vector3());
  aim(ll,ft,T.clone().sub(Kw).normalize());
  aim(ft,toe,rf);
  // toes: on the floor they bend flat at the ball of the foot (releve, the heel peeling off in a step); in the air they stay in line
  const tw=(1-(o.point?(o.pointW===undefined?1:o.pointW):0))*clamp((Math.asin(clamp(-rf.y,-1,1))-restPitch(d,side))/0.3)*clamp((r['toe3-1.'+side].y*sc+0.05-toe.getWorldPosition(_a).y)/0.04);
  if(tw>0){ const h=rf.clone().setY(0).normalize();
    for(let n=1;n<=5;n++){ const t1=b['toe'+n+'-1.'+side], t2=b['toe'+n+'-2.'+side]; if(!t1||!t2) continue;
      t1.getWorldPosition(_a); t2.getWorldPosition(_b); const c=_b.clone().sub(_a).normalize(); aim(t1,t2,c.lerp(h,tw).normalize()); } }
}
const _rp={};
function restPitch(d,side){   // how far the rest foot points down from heel to ball (radians)
  const k=d.i+side; if(_rp[k]===undefined){ const v=d.rest['toe3-1.'+side].clone().sub(d.rest['foot.'+side]); _rp[k]=Math.atan2(-v.y,Math.hypot(v.x,v.z)); } return _rp[k];
}
function releveRise(d,side,rl){ const a0=restPitch(d,side), Lb=d.rest['toe3-1.'+side].distanceTo(d.rest['foot.'+side])*d.sc; return Lb*(Math.sin(lerp(a0,1.05,rl))-Math.sin(a0)); }

// ---------- timeline (choreography.json "timeline"): per actor, where they are, travel and face, section by section.
// Entries {at, to:[x,z] (travel there over "bars", default 2; the first entry places the actor), face: degrees (0 = audience)
// | actor spot | [x,z] point | "path", turn_bars (default 1)}. Feet step on the accents while moving or turning.
// Everything is a pure function of t. Actors without a timeline keep the looping step pattern and turn.
const ACC=new Set((TRACK.accents||[1]).map(a=>((a-1)%CPB+CPB)%CPB));
const TLD=CFG.map(c=>{ const L=CHOREO.timeline&&CHOREO.timeline[c.spot]; if(!L||!L.length) return null; const bar=CPB*F.beat_period;
  return L.map(e=>({T:atTime(e.at), dur:(e.bars===undefined?2:e.bars)*bar, to:e.to||null, face:e.face, turnDur:(e.turn_bars===undefined?1:e.turn_bars)*bar,
    phrase:e.phrase, phraseBlend:(e.phrase_blend===undefined?0.5:e.phrase_blend)*bar})).sort((a,b)=>a.T-b.T); });
const SPOT_I={}; CFG.forEach((c,i)=>SPOT_I[c.spot]=i);
const angDiff=(a,b)=>{ let d=(b-a)%(2*Math.PI); if(d>Math.PI) d-=2*Math.PI; if(d<-Math.PI) d+=2*Math.PI; return d; };
// travel: speed up over at most 1.2 s, walk at an even pace, slow down over at most 1.2 s (a long eased glide would
// speed the walk up and down all the way)
function travelU(x,dur){ x=clamp(x); const a=Math.min(1/3,1.2/Math.max(dur,1e-3)), v=1/(1-a);
  return x<a?v*x*x/(2*a):x>1-a?1-v*(1-x)*(1-x)/(2*a):v*(x-a/2); }
function tlPos(i,t){
  const L=TLD[i], s0=L[0].to||SPOT_POS[CFG[i].spot]||[0,0];
  let sx=s0[0], sz=s0[1], tx=sx, tz=sz, T0=L[0].T, dur=1;
  for(let k=1;k<L.length;k++){ const e=L[k]; if(e.T>t) break; if(!e.to) continue;
    const u=travelU((e.T-T0)/dur,dur); sx=lerp(sx,tx,u); sz=lerp(sz,tz,u); tx=e.to[0]; tz=e.to[1]; T0=e.T; dur=e.dur; }
  const u=travelU((t-T0)/dur,dur); return [lerp(sx,tx,u), lerp(sz,tz,u)];
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
// ---------- motion track: body yaw and feet, simulated once forward in time at load (and again when the beat grid or the
// transition length changes), so every frame is still a pure function of t and obeys what a body can do:
// the timeline's facing is reached at a limited turn rate and acceleration (no snapping, no reversing on the spot);
// feet stay planted and step - landing on the counts - whenever the body has moved or turned away from them; a leg in a
// gesture (from the phrase) is free in the air and lands where the body is when it comes down.
const MDT=1/60, TURN_MAX=150*D, TURN_ACC=320*D, STEP_ERR=0.09, LIFT=0.05;
const OFFSTAGE=1.3;
const HAND_C=0.07, PALM=0.017;   // holding hands: grip centre from the wrist joint, half a hand's thickness
const KNEE_R=0.055, ANKLE_R=0.065, HIP_MIN=0.12, ELBOW_R=0.045, WRIST_R=0.035;   // floor work: joint heights when resting on the floor
let MOT=null, MOT_KEY='';
const _rotXZ=(x,z,a)=>[x*Math.cos(a)+z*Math.sin(a), -x*Math.sin(a)+z*Math.cos(a)];
// ---------- holds (choreography.json "holds"): partners holding hands. Each entry {at, bars (default 1), pair: [a, b],
// hands: "near" (default: each the hand nearer the other) | "both" (facing, two hands) | [a's hand, b's hand] ("left" /
// "right", the dancer's own), height: "low" | "chest" | "high" (raised over b's head), turn: degrees b turns under the
// raised hands (a walking turn), blend (bars to take hold and let go, default 0.25)}. Both arms reach for one shared
// point, so the hands stay joined whatever the bodies do; personal space keeps the pair within reach.
const HOLDS=(CHOREO.holds||[]).map(h=>{ const ia=SPOT_I[h.pair[0]], ib=SPOT_I[h.pair[1]]; if(ia===undefined||ib===undefined||!TLD[ia]||!TLD[ib]) return null;
  const bar=CPB*F.beat_period, T0=atTime(h.at), T1=T0+(h.bars===undefined?1:h.bars)*bar, bl=Math.min((h.blend===undefined?0.25:h.blend)*bar,(T1-T0)/3);
  const height=h.height||'low', maxD=height==='high'?0.64:h.hands==='both'?0.72:0.66, minD=height==='high'?0.55:h.hands==='both'?0.6:0.52;   // a turn under the hands needs room for her shoulders to sweep round
  let hands;
  if(Array.isArray(h.hands)) hands=[h.hands.map(x=>x[0].toUpperCase())];
  else if(h.hands==='both') hands=[['R','L'],['L','R']];
  else hands=null;   // "near": chosen from how the pair stands over the whole hold (holdHands)
  return {ia,ib,T0,T1,bl,height,maxD,minD,hands,turn:(h.turn||0)*D};
}).filter(Boolean);
HOLDS.forEach(h=>HOLDS.forEach(g=>{ if(g!==h && g.ia===h.ia && g.ib===h.ib && Math.abs(g.T0-h.T1)<0.05){ h.next=g; g.prev=h; } }));   // one hold straight into the next: the grip carries over
const holdW=(h,t)=>{ const a=h.prev?h.T0-h.bl/2:h.T0, b=h.next?h.T1+h.bl/2:h.T1; if(t<=a||t>=b) return 0;
  return Math.min(ease(clamp((t-a)/h.bl)),ease(clamp((b-t)/h.bl))); };   // joined holds cross-fade over the change
function holdSpin(i,t){ let s=0; HOLDS.forEach(h=>{ if(h.ib===i&&h.turn&&t>h.T0) s+=h.turn*ease(clamp((t-h.T0-h.bl)/Math.max(1e-3,h.T1-h.T0-2*h.bl))); }); return s; }
function holdHands(h){   // "near": the hands on the sides facing each other, by majority over the hold (bone L = own left = body +x)
  if(h.hands) return h.hands;
  const near=(m,q)=>((q.px-m.px)*Math.cos(m.yaw)-(q.pz-m.pz)*Math.sin(m.yaw))>0?'L':'R', votes={};
  for(let t=h.T0+h.bl; t<=h.T1-h.bl+1e-6; t+=0.2){ const a=motionAt(h.ia,t), b=motionAt(h.ib,t), k=near(a,b)+near(b,a); votes[k]=(votes[k]||0)+1; }
  const k=Object.keys(votes).sort((x,y)=>votes[y]-votes[x])[0]||'RL'; return h.hands=[[k[0],k[1]]];
}
function holdTargets(t){   // {dancer index + bone side: {T: where the wrist goes, w: weight, j: partner, f: fingers, n: palm}} for every hand held at t (bodies already posed)
  const out={}, put=(k,e)=>{ const o=out[k]; e.parts=[{w:e.w,mate:e.mate,bodies:e.bodies}]; if(!o){ out[k]=e; return; } const u=e.w/(o.w+e.w);   // a hand in two joined holds moves from one grip to the next
    out[k]={T:o.T.lerp(e.T,u),w:Math.min(1,o.w+e.w),j:e.j,f:o.f.clone().lerp(e.f,u).normalize(),n:o.n.clone().lerp(e.n,u).normalize(),parts:[...o.parts,...e.parts],moved:true}; };
  HOLDS.forEach(h=>{ const w=holdW(h,t); if(w<=0) return;
    holdHands(h).forEach(([sa,sb])=>{ const A=dancers[h.ia].bones['upperarm01.'+sa].getWorldPosition(new THREE.Vector3()), B=dancers[h.ib].bones['upperarm01.'+sb].getWorldPosition(new THREE.Vector3());   // the posed shoulders
      const arm=(i,sd)=>{ const r=dancers[i].rest; return (r['lowerarm01.'+sd].distanceTo(r['upperarm01.'+sd])+r['wrist.'+sd].distanceTo(r['lowerarm01.'+sd]))*dancers[i].sc*0.95; };
      let H=A.clone().lerp(B,0.5);
      if(h.height==='high'){ const N=dancers[h.ib].bones.neck02.getWorldPosition(new THREE.Vector3()); H=N.clone().lerp(A,0.3); }   // a turn under the hands: hers stay over her head while she turns beneath them
      const ok=(S,L)=>{ const hz=Math.hypot(S.x-H.x,S.z-H.z); return Math.sqrt(Math.max(0,L*L-hz*hz)); };   // how far up or down each arm can still reach
      const v=Math.min(ok(A,arm(h.ia,sa)),ok(B,arm(h.ib,sb)));
      H.y=h.height==='high'?Math.max(A.y,B.y)+Math.min(0.42,Math.max(0,v-Math.abs(A.y-B.y))):(A.y+B.y)/2-Math.min(h.height==='chest'?0.02:0.5,v);   // chest: palms together in front of the chest; low: arms hanging
      const bodies=[...postedCaps(dancers[h.ia]),...postedCaps(dancers[h.ib])]; for(let it=0;it<3;it++) pushOut(H,bodies,0.06);   // the joined hands stay clear of both bodies
      // the grip: palm against palm, fingers down (low) or up (chest, high). Facing each other the palms face along the
      // line between them; side by side they face front and back (an arm hanging at the side turns its palm back, never out)
      // the same hand each (right to right, passing face to face) low down is a handshake: fingers toward the partner,
      // palms to the side
      const u=dancers[h.ib].bones.neck02.getWorldPosition(new THREE.Vector3()).sub(dancers[h.ia].bones.neck02.getWorldPosition(new THREE.Vector3())).setY(0).normalize(), ya=motionAt(h.ia,t).yaw, fa=new THREE.Vector3(Math.sin(ya),0,Math.cos(ya));
      let fA, fB, n;
      if(h.height==='low' && sa===sb){ fA=u.clone(); fB=u.clone().negate(); n=new THREE.Vector3(Math.cos(ya),0,-Math.sin(ya)).multiplyScalar(sa==='R'?1:-1); n.addScaledVector(u,-n.dot(u)).normalize(); }
      else { fA=new THREE.Vector3(0,h.height==='low'?-1:1,0); fB=fA.clone();
        const pp=new THREE.Vector3(-u.z,0,u.x); if(pp.dot(fa)>0) pp.negate();
        const fc=ease(clamp((Math.abs(fa.dot(u))-0.3)/0.5)); n=pp.multiplyScalar(1-fc).addScaledVector(u,fc).normalize(); }   // a's palm faces n, b's faces -n
      put(h.ia+sa,{T:H.clone().addScaledVector(fA,-HAND_C).addScaledVector(n,-PALM),w,j:h.ib,f:fA,n:n.clone(),bodies,mate:h.ib+sb});
      put(h.ib+sb,{T:H.clone().addScaledVector(fB,-HAND_C).addScaledVector(n,PALM),w,j:h.ia,f:fB,n:n.clone().negate(),bodies,mate:h.ia+sa}); }); });
  const D={};   // ...and on the way the joined hands stay clear of both bodies: each pushed as its grips are, weighted as it holds them
  Object.keys(out).forEach(k=>{ const a=out[k]; if(!a.moved && !(out[a.mate]&&out[a.mate].moved)) return; let ws=0; const d=new THREE.Vector3();
    a.parts.forEach(p=>{ const b=out[p.mate]; if(!b) return; const M=a.T.clone().lerp(b.T,0.5), M2=M.clone(); for(let it=0;it<3;it++) pushOut(M2,p.bodies,0.06); d.addScaledVector(M2.sub(M),p.w); ws+=p.w; });
    if(ws>0) D[k]=d.multiplyScalar(1/ws); });
  Object.keys(D).forEach(k=>out[k].T.add(D[k]));
  return out;
}
// personal space: bodies never pass through each other. Where two dancers would come closer than their bodies and
// poses allow (a torso leaning toward the other, a leg gesture reaching toward them), their timeline positions are
// pushed apart - smoothly, starting before it is needed - and everything else (feet, turns) follows the pushed path.
const SEP_DT=1/30, BODY_R=0.17;
let SEP=null;
const _yq=new THREE.Quaternion(), _Y=new THREE.Vector3(0,1,0);
function armReach(z,yaw,dx,dz,i){   // how far the arms reach toward (dx,dz): shoulder, upper arm, forearm and hand, plus the arm's thickness
  _yq.setFromAxisAngle(_Y,yaw); let e=0;
  [1,-1].forEach(s=>{ const [up,fo]=armDirs(s,armOf(s===1?z.R:z.L),PERS[i],_yq);   // bone L (s=1) takes the pose's R entry, as in animate()
    const x=0.18*s*Math.cos(yaw)+up.x*0.29+fo.x*0.4, zz=-0.18*s*Math.sin(yaw)+up.z*0.29+fo.z*0.4;
    e=Math.max(e,x*dx+zz*dz+0.05); });
  return e;
}
function reachToward(z,yaw,dx,dz,walk,i){   // metres the body reaches from its centre toward the unit direction (dx,dz)
  if(!z) return BODY_R; const arms=i===undefined?0:armReach(z,yaw,dx,dz,i);
  if(walk) return Math.max(BODY_R+0.05,arms);   // walking drops leg gestures and straightens up (the arms still reach)
  const f=[Math.sin(yaw),Math.cos(yaw)], df=f[0]*dx+f[1]*dz, ds=Math.abs(f[1]*dx-f[0]*dz), lean=clamp((z.torso[0]+z.pitch)/90,-1,1)*Math.PI/2;
  let e=BODY_R+(lean>0?Math.max(0,df)*0.55*Math.sin(lean):Math.max(0,-df)*0.4*Math.sin(-lean));
  [z.legL,z.legR].forEach(g=>{ if(g[1]<10) return; const h=0.9*Math.sin(Math.min(g[1],90)*D)*(1-0.42*g[2]), c=Math.cos(g[0]*D)*df+Math.abs(Math.sin(g[0]*D))*ds;
    e=Math.max(e,0.06+h*Math.max(0,c)); });
  return Math.max(e,arms);
}
function separation(){
  const IDX=CFG.map((c,i)=>i).filter(i=>TLD[i]), t0=-2, n=Math.ceil((F.duration+8)/SEP_DT)+1, C={};
  IDX.forEach(i=>C[i]=[new Float32Array(n),new Float32Array(n)]);
  for(let k=0;k<n;k++){ const t=t0+k*SEP_DT, P={}, Z={}, Y={};
    const Wk={}; IDX.forEach(i=>{ P[i]=tlPos(i,t); Z[i]=poseAt(i,t); Y[i]=tlYaw(i,t)+phraseSpin(i,t)+holdSpin(i,t);
      const a=tlPos(i,t-0.4), b=tlPos(i,t+0.4); Wk[i]=Math.hypot(b[0]-a[0],b[1]-a[1])/0.8>0.12; });
    for(let a=0;a<IDX.length;a++) for(let b=a+1;b<IDX.length;b++){ const i=IDX[a], j=IDX[b];
      let dx=P[j][0]-P[i][0], dz=P[j][1]-P[i][1], d=Math.hypot(dx,dz); if(d>2.5) continue; if(d<1e-4){ dx=1; dz=0; d=1e-4; }
      const ux=dx/d, uz=dz/d; let need=reachToward(Z[i],Y[i],ux,uz,Wk[i],i)+reachToward(Z[j],Y[j],-ux,-uz,Wk[j],j)+0.05;
      HOLDS.forEach(h=>{ if(((h.ia===i&&h.ib===j)||(h.ia===j&&h.ib===i)) && holdW(h,t)>0) need=clamp(need,h.minD,h.maxD-0.08); });   // holding hands: never pushed out of reach, never so close the shoulders collide
      if(d<need){ const p=(need-d)/2; C[i][0][k]-=ux*p; C[i][1][k]-=uz*p; C[j][0][k]+=ux*p; C[j][1][k]+=uz*p; }
      HOLDS.forEach(h=>{ if(!((h.ia===i&&h.ib===j)||(h.ia===j&&h.ib===i))) return; const w=holdW(h,t);   // holding hands: within reach
        if(w>0 && d>h.maxD){ const p=(d-h.maxD)/2*w; C[i][0][k]+=ux*p; C[i][1][k]+=uz*p; C[j][0][k]-=ux*p; C[j][1][k]-=uz*p; } }); } }
  const R=Math.round(1.0/SEP_DT), dil=a=>{ const o=new Float32Array(n);   // widest push within +-1 s, then averaged over it: never less than needed
    for(let k=0;k<n;k++){ let m=0; for(let j=Math.max(0,k-R);j<=Math.min(n-1,k+R);j++) if(Math.abs(a[j])>Math.abs(m)) m=a[j]; o[k]=m; } return o; };
  const box=a=>{ const o=new Float32Array(n); let s=0; for(let k=-R;k<n;k++){ if(k+R<n) s+=a[k+R]; if(k-R-1>=0) s-=a[k-R-1]; if(k>=0) o[k]=s/(2*R+1); } return o; };
  IDX.forEach(i=>{ C[i]=C[i].map(a=>box(box(dil(dil(a))))); });
  return {t0,C};
}
function sepPos(i,t){   // the timeline position, pushed apart from the others
  const p=tlPos(i,t); if(!SEP) SEP=separation(); const c=SEP.C[i]; if(!c) return p;
  const q=clamp((t-SEP.t0)/SEP_DT,0,c[0].length-1.001), k=Math.floor(q), u=q-k;
  return [p[0]+c[0][k]+(c[0][k+1]-c[0][k])*u, p[1]+c[1][k]+(c[1][k+1]-c[1][k])*u];
}
function motionTrack(i){
  const d=dancers[i], L=TLD[i], t0=Math.min(0,L[0].T)-2, n=Math.ceil((F.duration+6-t0)/MDT)+1;
  const off=['L','R'].map(s=>{ const v=d.rest['foot.'+s].clone().sub(new THREE.Vector3(d.rest.root.x,0,d.rest.root.z)).multiplyScalar(d.sc); return [v.x,v.z]; });
  const A=()=>new Float32Array(n), M={t0,n,px:A(),pz:A(),yaw:A(),mv:A(),x:[A(),A()],z:[A(),A()],lift:[A(),A()],ph:[A(),A()],sx:A(),sz:A()};
  // body: position from the timeline, facing turned toward the active "face" at a human rate
  let y=null, w=0, fk=0; const mvRaw=A();
  for(let k=0;k<n;k++){ const t=t0+k*MDT, p=sepPos(i,t); M.px[k]=p[0]; M.pz[k]=p[1];
    while(fk+1<L.length && L[fk+1].T<=t){ fk++; } let e=fk; while(e>0 && L[e].face===undefined) e--;
    const tgt=faceTarget(i,L[e].face,t,p);
    if(y===null) y=tgt===null?0:tgt;
    else { let wd=0;
      if(tgt!==null){ let dl=angDiff(y,tgt); if(Math.abs(dl)>2.6 && w*dl<0) dl-=Math.sign(dl)*2*Math.PI;   // keep turning the way it was going
        wd=clamp(dl/Math.max(0.25,L[e].turnDur/3),-TURN_MAX,TURN_MAX); }
      w+=clamp(wd-w,-TURN_ACC*MDT,TURN_ACC*MDT); y+=w*MDT; }
    M.yaw[k]=y+phraseSpin(i,t)+holdSpin(i,t);   // a turn under the hands is a walking turn: the feet step round
    if(k>0) mvRaw[k]=(Math.hypot(p[0]-M.px[k-1],p[1]-M.pz[k-1])/MDT>0.04 || Math.abs(w)>0.3 || Math.abs(holdSpin(i,t+0.05)-holdSpin(i,t-0.05))>0.03)?1:0; }   // a turn under the hands walks
  const R=Math.round(0.8/MDT); let acc=0;      // walking weight: travel or turning, smoothed over +-0.8 s
  for(let k=-R;k<n;k++){ if(k+R<n) acc+=mvRaw[k+R]; if(k-R-1>=0) acc-=mvRaw[k-R-1]; if(k>=0) M.mv[k]=acc/(2*R+1); }
  // feet
  const PZK=[]; for(let k=0;k<n;k++) PZK.push(poseAt(i,t0+k*MDT));
  const wide=k=>PZK[k]?PZK[k].wide:0, kneel=k=>PZK[k]&&(PZK[k].kneelL[0]>0||PZK[k].kneelR[0]>0);
  const ds=(si,k)=>{ k=clamp(k,0,n-1); const r=_rotXZ(off[si][0]+Math.sign(off[si][0])*wide(k),off[si][1],M.yaw[k]); return [M.px[k]+r[0], M.pz[k]+r[1]]; };   // a wide stance steps out
  const pivot=k=>{ const a=clamp(k-12,0,n-1), b=clamp(k+12,0,n-1), z=PZK[k];
    return kneel(k) || (M.mv[k]<0.5 && Math.abs(phraseSpin(i,t0+b*MDT)-phraseSpin(i,t0+a*MDT))>0.15) ||   // a turn while walking is a turning walk
       (z&&z.releve*(1-clamp(M.mv[k]*2))>0.3); };   // as animate(): walking comes down off releve, so it never blocks a step
  const gw=k=>{ const z=PZK[k]; if(!z) return [0,0]; const m=1-clamp(M.mv[k]*2); return [clamp(z.legR[1]*m/20), clamp(z.legL[1]*m/20)]; };   // bone L = audience right
  const F2=[0,1].map(si=>{ const p=ds(si,0); return {x:p[0],z:p[1],yaw:M.yaw[0],sw:null,last:-9}; });
  const G=[]; for(let k=0;k<n;k++) G.push(gw(k));
  const gAhead=(si,k,m)=>{ let x=0; for(let j=k;j<=Math.min(n-1,k+m);j+=3) x=Math.max(x,G[j][si]); return x; };
  for(let k=0;k<n;k++){ const t=t0+k*MDT, g=G[k];
    F2.forEach((f,si)=>{ if(f.sw){ const u=(t-f.sw.t0)/(f.sw.t1-f.sw.t0);
        if(u>=1){ f.x=f.sw.tx; f.z=f.sw.tz; f.yaw=M.yaw[k]; f.sw=null; f.last=t; } }
      if(g[si]>0.9 && !f.sw){ const p=ds(si,k); f.x=p[0]; f.z=p[1]; f.yaw=M.yaw[k]; } });
    if(!F2[0].sw && !F2[1].sw && !pivot(k)){ let best=-1, be=M.mv[k]>0.5?0.05:STEP_ERR;   // walking: step early and often (short strides)
      F2.forEach((f,si)=>{ const o=1-si; if(g[si]>0.9 || gAhead(o,k,Math.round(1.1/MDT))>0.02 || t-F2[o].last<0.12 || t-f.last<0.2) return;   // weight onto a foot before lifting the other; a foot that just landed stays
        const p=ds(si,k+Math.round(0.4/MDT)), err=Math.hypot(p[0]-f.x,p[1]-f.z)+0.12*Math.abs(angDiff(f.yaw,M.yaw[k]))-(f.last>F2[o].last?0.2:0);   // feet alternate
        if(err>be){ be=err; best=si; } });
      const kk=Math.min(n-1,k+12), fast=Math.hypot(M.px[kk]-M.px[k],M.pz[kk]-M.pz[k])/(12*MDT)>0.3; let t1=0;
      if(best>=0){
        // every step lands on a count: walking takes one step per count (about 0.55 s, a natural cadence), starting
        // just early enough for a 0.3-0.5 s swing; stepping in place while dancing lands on the next count
        const walk=fast||M.mv[k]>0.5;
        t1=pulseTime(Math.ceil(beatPos(t+(walk?0.3:0.4))-1e-6)); if(t1-t>0.95) t1=t+0.6;
        if(walk && t1-t>0.5) best=-1; }
      if(best>=0){ const f=F2[best], walk=fast||M.mv[k]>0.5;
        const p=ds(best,Math.round((t1+(walk?0.1:0.25)-t0)/MDT)), dx=p[0]-f.x, dz=p[1]-f.z, dl=Math.hypot(dx,dz), SM=walk?0.62:0.55, c=dl>SM?SM/dl:1;   // a stride is at most 55 cm (62 walking)
        f.sw={t0:t,t1,fx:f.x,fz:f.z,tx:f.x+dx*c,tz:f.z+dz*c,lift:LIFT+0.07*clamp(dl*c/0.6)}; } }
    F2.forEach((f,si)=>{ let x=f.x, z=f.z, l=0;
      let ph=0; if(f.sw){ const u=clamp((t-f.sw.t0)/(f.sw.t1-f.sw.t0)), e=(1-Math.cos(Math.PI*u))/2; x=lerp(f.sw.fx,f.sw.tx,e); z=lerp(f.sw.fz,f.sw.tz,e); l=Math.sin(Math.PI*u)*f.sw.lift; ph=u; }   // a longer stride lifts the foot higher (the knee bends through the swing)
      M.x[si][k]=x; M.z[si][k]=z; M.lift[si][k]=l; M.ph[si][k]=ph; }); }
  // hip sway: over the standing foot while the other swings (at most 4 cm), smoothed twice over +-0.15 s like a real gait
  const rx=A(), rz=A(); for(let k=0;k<n;k++){ let x=0,z=0; [0,1].forEach(si=>{ const o=1-si, w=0.15*clamp(M.lift[si][k]/LIFT)**2;
      x+=(M.x[o][k]-M.px[k])*w; z+=(M.z[o][k]-M.pz[k])*w; }); const l=Math.hypot(x,z), c=l>0.04?0.04/l:1; rx[k]=x*c; rz[k]=z*c; }
  const box=(a,b)=>{ const R=Math.round(0.15/MDT); let s=0; for(let k=-R;k<n;k++){ if(k+R<n) s+=a[k+R]; if(k-R-1>=0) s-=a[k-R-1]; if(k>=0) b[k]=s/(2*R+1); } };
  const tx=A(), tz=A(); box(rx,tx); box(rz,tz); box(tx,M.sx); box(tz,M.sz);
  // skirt: the hem hangs from the hips like a pendulum (about 1.1 Hz, damped so it settles in a swing or so without
  // overshooting): it trails the hips when they move and falls back to hang straight when they stop. It flares out only
  // while the body turns (centrifugal, with the square of the turning speed) and drops again under gravity after.
  const SW=2*Math.PI*1.1, SZ=0.8, FW=2*Math.PI*1.4, FZ=0.9; M.hx=A(); M.hz=A(); M.fl=A();
  let hx=M.px[0], hz=M.pz[0], vx=0, vz=0, fl=0, fv=0;
  for(let k=0;k<n;k++){ const y=M.yaw[k], ix=M.px[k]+M.sx[k], iz=M.pz[k]+M.sz[k];
    vx+=(SW*SW*(ix-hx)-2*SZ*SW*vx)*MDT; vz+=(SW*SW*(iz-hz)-2*SZ*SW*vz)*MDT; hx+=vx*MDT; hz+=vz*MDT;
    const w=k>0?Math.abs(angDiff(M.yaw[k-1],y))/MDT:0, ft=0.9*clamp((w/(2*Math.PI*1.2))**2);
    fv+=(FW*FW*(ft-fl)-2*FZ*FW*fv)*MDT; fl+=fv*MDT;
    M.hx[k]=hx-ix; M.hz[k]=hz-iz; M.fl[k]=Math.max(0,fl); }
  return M;
}
function motionAt(i,t){
  const key=[P.offsetMs,P.shift,P.sharp].join();
  if(!MOT || key!==MOT_KEY){ MOT_KEY=key; SEP=null; MOT=CFG.map((c,j)=>TLD[j]?motionTrack(j):null); }
  const M=MOT[i], q=clamp((t-M.t0)/MDT,0,M.n-1.001), k=Math.floor(q), u=q-k, at=a=>a[k]+(a[k+1]-a[k])*u;
  return {px:at(M.px),pz:at(M.pz),yaw:at(M.yaw),mv:at(M.mv),x:M.x.map(at),z:M.z.map(at),lift:M.lift.map(at),ph:M.ph.map(a=>a[k+(u>0.5?1:0)]),sx:at(M.sx),sz:at(M.sz),hx:at(M.hx),hz:at(M.hz),fl:at(M.fl)};
}
function tlFeet(d,t){   // world foot targets {L:[x,y,z], R:[...]} and the walking weight, from the motion track
  const m=motionAt(d.i,t), fy=s=>d.rest['foot.'+s].y*d.sc;
  return {L:[m.x[0],fy('L')+m.lift[0],m.z[0]], R:[m.x[1],fy('R')+m.lift[1],m.z[1]], liftL:m.lift[0], liftR:m.lift[1], phL:m.ph[0], phR:m.ph[1], moving:m.mv, sway:[m.sx,m.sz]};
}

// ---------- phrases: timeline entries {"phrase": name} start a phrase (choreography.json "phrases": {name: {bars, keys:
// [{at: count 1.., pose}]}}), aligned to the bar where the entry starts, looping; each pose arrives on its count (the move
// takes the preview's transition share of the gap before it). Changing phrase blends over "phrase_blend" bars (0.5).
const POSE_SRC=Object.assign({},POSE_LIB,CHOREO.poses||{}), _poseCache={};
const ZERO_POSE={L:[8,5,5,0,0],R:[8,5,5,0,0],head:[0,0],torso:[0,0,0],plie:0,releve:0,legL:[0,0,0],legR:[0,0,0],turn:0,pitch:0,wide:0,kneelL:[0,0,0],kneelR:[0,0,0]};
function poseSpec(name){
  if(_poseCache[name]) return _poseCache[name];
  let p;
  if(!POSE_SRC[name] && /_L$/.test(name) && POSE_SRC[name.slice(0,-2)+'_R']){ const m=poseSpec(name.slice(0,-2)+'_R');
    p={L:[...m.R],R:[...m.L],head:[m.head[0],-m.head[1]],torso:[m.torso[0],-m.torso[1],-m.torso[2]],plie:m.plie,releve:m.releve,legL:[...m.legR],legR:[...m.legL],turn:-m.turn,
      pitch:m.pitch,wide:m.wide,kneelL:[...m.kneelR],kneelR:[...m.kneelL]}; }
  else { const src=POSE_SRC[name]||{}; const b=src.base?poseSpec(src.base):ZERO_POSE;
    p=JSON.parse(JSON.stringify(b)); p.turn=0;
    if(src.arms){ p.L=[...src.arms]; p.R=[...src.arms]; } if(src.left) p.L=[...src.left]; if(src.right) p.R=[...src.right];
    ['head','torso'].forEach(k=>{ if(src[k]) p[k]=[...src[k]]; }); ['plie','releve','turn','pitch','wide'].forEach(k=>{ if(src[k]!==undefined) p[k]=src[k]; });
    if(src.kneel){ p.kneelL=src.kneel.left?[1,...src.kneel.left]:[0,0,0]; p.kneelR=src.kneel.right?[1,...src.kneel.right]:[0,0,0]; }
    if(src.leg){ if(src.leg.left) p.legL=[...src.leg.left]; if(src.leg.right) p.legR=[...src.leg.right]; } }
  return _poseCache[name]=p;
}
const mixPose=(a,b,u)=>{ const o={}; for(const k in a) o[k]=Array.isArray(a[k])?a[k].map((v,j)=>lerp(v,b[k][j],u)):lerp(a[k],b[k],u);
  const on=g=>g[1]>5, sw=(on(a.legL)&&!on(b.legL)&&on(b.legR)&&!on(a.legR)) || (on(a.legR)&&!on(b.legR)&&on(b.legL)&&!on(a.legL));
  if(sw) ['legL','legR'].forEach(k=>{ const w=on(a[k])?clamp(2*u):clamp(2*u-1); o[k]=a[k].map((v,j)=>lerp(v,b[k][j],w)); });   // a leg gesture changing sides: down first, then up
  ['legL','legR'].forEach(k=>{ const x=a[k], y=b[k]; if(Math.abs(x[2]-y[2])<0.05) return; const w=o[k]===undefined?u:null;   // a knee unfolds once the leg is round, folds early
    const uu=x[2]>y[2]?u*u:1-(1-u)*(1-u); o[k]=[o[k][0],o[k][1],lerp(x[2],y[2],uu)]; });
  ['kneelL','kneelR'].forEach(k=>{ const x=a[k], y=b[k]; if(!x[0]&&y[0]) o[k]=[lerp(0,1,u),y[1],y[2]]; else if(x[0]&&!y[0]) o[k]=[lerp(1,0,u),x[1],x[2]]; });   // a knee goes down or comes up where it kneels
  return o; };
const PHRASES=CHOREO.phrases||{};
const PH=CFG.map((c,i)=>TLD[i]?TLD[i].filter(e=>e.phrase&&PHRASES[e.phrase]).map(e=>{ const ph=PHRASES[e.phrase], len=(ph.bars||1)*CPB;
  const keys=ph.keys.map(k=>({a:k.at-1, pose:poseSpec(k.pose), dur:k.dur})).sort((x,y)=>x.a-y.a);
  return {T:e.T, q0:Math.floor(beatPos(e.T)/CPB+1e-6)*CPB, len, keys, once:!!ph.once, total:keys.reduce((s,k)=>s+k.pose.turn,0)*D, blend:e.phraseBlend}; }):[]);
function phraseEval(ph,t){
  const q=beatPos(t)-ph.q0, cyc=Math.floor(q/ph.len), r=q-cyc*ph.len, K=ph.keys, n=K.length;
  if(ph.once && (cyc>0 || r>=K[n-1].a)){ let spin=0; for(let m=0;m<n;m++) spin+=K[m].pose.turn*D; return {pose:K[n-1].pose, spin}; }   // played once: hold the last pose
  let j=n-1; for(let m=0;m<n;m++) if(K[m].a<=r) j=m; else break;      // last key reached (wraps to the previous cycle's last)
  const A=K[j], Bi=(j+1)%n, B=K[Bi], a=(A.a<=r)?A.a:A.a-ph.len, b=(Bi>j&&A.a<=r)?B.a:B.a+(A.a<=r?ph.len:0);
  const span=Math.max(1e-3,b-a), mv=Math.min(span,B.dur!==undefined?B.dur:Math.max(Math.max(0.05,P.sharp)*span,B.pose.turn?2.5:1.6)), ul=clamp((r-(b-mv))/mv), u=ease(ul), us=ease(clamp((ul-0.35)/0.65));
  let spin=cyc*ph.total; for(let m=0;m<n;m++) if(K[m].a<=r) spin+=K[m].pose.turn*D;
  return {pose:mixPose(A.pose,B.pose,u), spin:spin+B.pose.turn*D*us};   // the turn itself comes once the legs are set
}
function phraseIndex(i,t){ const L=PH[i]; let k=-1; for(let j=0;j<L.length;j++){ if(L[j].T<=t) k=j; else break; } return k; }
function poseAt(i,t){                   // the actor's pose at t (blended across a phrase change), or null without phrases
  const L=PH[i], k=phraseIndex(i,t); if(k<0) return L.length?phraseEval(L[0],L[0].T).pose:null;
  const cur=phraseEval(L[k],t).pose; if(k===0) return cur;
  const u=clamp((t-L[k].T)/Math.max(1e-3,L[k].blend)); return u>=1?cur:mixPose(phraseEval(L[k-1],t).pose,cur,ease(u));
}
function phraseSpin(i,t){               // phrase turning, except while holding hands (a turn under the hands is the hold's own)
  let s=phraseSpin0(i,t); HOLDS.forEach(h=>{ if((h.ia===i||h.ib===i) && t>h.T0) s-=phraseSpin0(i,Math.min(t,h.T1))-phraseSpin0(i,h.T0); }); return s;
}
function phraseSpin0(i,t){               // total turning from phrases, continuous across phrase changes
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
  if(TLD[i]){ const p=sepPos(i,ti), sp=SPOT_POS[CFG[i].spot]||[0,0]; cx=p[0]-sp[0]; cz=p[1]-sp[1]; rot=motionAt(i,ti).yaw; }
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
const SASH_OWN=CFG.map(c=>c.sash?new THREE.Color(c.sash):null);
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

// another dancer's body as capsules (lower body, torso leaning with the pose, head), from the track and pose alone, so
// every dancer can avoid every other in the same frame whatever the order they are posed in
function bodyCaps(d,t){
  const i=d.i, ti=t-LAG[i]*P.loose, m=motionAt(i,ti), z=poseAt(i,ti); if(z&&z.pitch>30) return [];
  const r=d.rest, hipY=r.spine05.y*d.sc, topY=r.neck02.y*d.sc, f=new THREE.Vector3(Math.sin(m.yaw),0,Math.cos(m.yaw));
  const lean=z?clamp((z.torso[0]+z.pitch)/90,-1,1)*Math.PI/2:0, drop=z?z.plie*0.11:0;
  const o=new THREE.Vector3(r.spine05.x-r.root.x,0,r.spine05.z-r.root.z).multiplyScalar(d.sc).applyAxisAngle(UPV,m.yaw);   // the pelvis as the skeleton places it
  const hip=new THREE.Vector3(m.px+m.sx+r.root.x*d.sc+o.x,hipY-drop,m.pz+m.sz+r.root.z*d.sc+o.z), top=hip.clone().add(new THREE.Vector3(0,(topY-hipY)*Math.cos(lean),0)).addScaledVector(f,(topY-hipY)*Math.sin(lean));
  const head=top.clone().add(top.clone().sub(hip).normalize().multiplyScalar(0.16));
  return [{a:new THREE.Vector3(hip.x,0.35,hip.z),b:hip,r:0.15},{a:hip,b:top,r:0.15},{a:head,b:head,r:0.12}];
}
const _hinge={};
function elbowHinge(d,side){   // the elbow's hinge axis in the upper arm's own frame (the rest pose has the elbow slightly bent)
  const k=d.i+side; if(!_hinge[k]){ const r=d.rest; _hinge[k]=r['lowerarm01.'+side].clone().sub(r['upperarm01.'+side]).cross(r['wrist.'+side].clone().sub(r['lowerarm01.'+side])).normalize(); }
  return _hinge[k].clone();
}
function slerpDir(a,b,w){   // turn unit vector a (in place) toward b by fraction w of the angle between them
  const ang=a.angleTo(b); if(ang<1e-4||w<=0) return a; if(w>=1) return a.copy(b);
  let ax=a.clone().cross(b); if(ax.lengthSq()<1e-10){ ax=new THREE.Vector3(0,1,0).cross(a); if(ax.lengthSq()<1e-10) ax.set(1,0,0); }
  return a.applyAxisAngle(ax.normalize(),ang*w);
}
function palmFrame(d,side){   // the hand's finger direction and palm normal (bone L = own left; the thumb is on the palm side)
  const P=n=>d.bones[n+'.'+side].getWorldPosition(new THREE.Vector3()), W=P('wrist'), f=P('finger3-1').sub(W).normalize();
  const n=f.clone().cross(P('finger2-1').sub(P('finger5-1')).normalize()).multiplyScalar(side==='L'?1:-1); n.addScaledVector(f,-n.dot(f)).normalize();
  return {f,n};
}
function gripHand(d,side,foD,ht){   // a held hand: the forearm turns the palm toward the partner's palm, the wrist bends the fingers up or down
  const w=ht.w, b=d.bones;
  let pf=palmFrame(d,side); const pn=pf.n.clone().addScaledVector(foD,-pf.n.dot(foD)), tn=ht.n.clone().addScaledVector(foD,-ht.n.dot(foD));
  if(pn.lengthSq()>1e-6 && tn.lengthSq()>1e-6){ pn.normalize(); tn.normalize();
    const phi=clamp(Math.atan2(pn.clone().cross(tn).dot(foD),pn.dot(tn)),-1.6,1.6);   // the forearm turns at most about 90 degrees either way
    rotWorld(b['lowerarm02.'+side],new THREE.Quaternion().setFromAxisAngle(foD,phi*w)); pf=palmFrame(d,side); }
  let fd=ht.f.clone(); const ang=fd.angleTo(foD), MAXB=70*D; if(ang>MAXB) fd=foD.clone().lerp(fd,MAXB/ang).normalize();   // the wrist bends at most 70 degrees
  const nd=ht.n.clone().addScaledVector(fd,-ht.n.dot(fd)); if(nd.lengthSq()<1e-6) return; nd.normalize();
  const basis=(f,n)=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f,n,f.clone().cross(n)));
  const q=basis(fd,nd).multiply(basis(pf.f,pf.n).invert());
  const ang2=2*Math.acos(Math.min(1,Math.abs(q.w))), MAXW=80*D;   // a wrist turns only so far: past that the palms meet at an angle
  rotWorld(b['wrist.'+side],new THREE.Quaternion().slerp(q,w*Math.min(1,MAXW/Math.max(ang2,1e-6))));
}
function postedCaps(d){   // a dancer's body as posed this frame: legs, torso, head
  const b=d.bones, P=n=>b[n].getWorldPosition(new THREE.Vector3()), hip=P('spine05'), knees=P('lowerleg01.L').add(P('lowerleg01.R')).multiplyScalar(0.5), head=P('head'); head.y+=0.09;
  return [{a:knees,b:hip,r:0.14},{a:hip,b:P('neck02'),r:0.15},{a:head,b:head,r:0.12}];
}
const _ab=new THREE.Vector3(), _pc=new THREE.Vector3();
function pushOut(p,caps,pad,ref){   // move point p (in place) out of the capsules, plus pad (the limb's own thickness); with ref (the
  // limb's root, outside the body) a point deep inside goes back out on the root's side, never through to the far side
  caps.forEach(c=>{ _ab.subVectors(c.b,c.a); const L=_ab.lengthSq(), u=L>1e-8?clamp(_pc.subVectors(p,c.a).dot(_ab)/L):0;
    const C=c.a.clone().addScaledVector(_ab,u); _pc.subVectors(p,C); const l=_pc.length(), r=c.r+pad;
    if(l<r){ if(ref){ const q=ref.clone().sub(C); if(L>1e-8) q.addScaledVector(_ab,-q.dot(_ab)/L); if(q.lengthSq()>1e-8) _pc.multiplyScalar(1/Math.max(r,1e-4)).addScaledVector(q.normalize(),1-l/r); }
      if(_pc.lengthSq()<1e-8) _pc.set(0,1,0); p.copy(C).addScaledVector(_pc.normalize(),r); } });
  return p;
}
const feet_y=(d,side)=>d.rest['foot.'+side].y*d.sc;
function floorDir(S,dir,len,minY,fb){   // bend dir (in place) up so a segment of len from S ends no lower than minY; returns the end
  if(S.y+dir.y*len<minY){ const y=clamp((minY-S.y)/len,-1,1), h=Math.sqrt(1-y*y); let hx=dir.x, hz=dir.z, l=Math.hypot(hx,hz);
    if(l<1e-4){ hx=fb.x; hz=fb.z; l=Math.hypot(hx,hz); } dir.set(hx/l*h,y,hz/l*h); }
  return S.clone().addScaledVector(dir,len);
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
  const FIN=[];   // two passes: every body first, then arms (held hands need both partners' real shoulders)
  dancers.forEach(d=>{
    d.robeMat.color.copy(d.robeBase).lerp(tintC,P.tint*0.25); d.mats.sash.color.copy(d.robeMat.color).multiplyScalar(0.86);
    const sc=sashAt(d.i,t); if(sc) d.mats.sash.color.lerp(sc[0],sc[1]*P.sashTint);
    const {ti,pb,posLen,frac,ci,cur,prev,k,dip,bar,bf,S0,S1,kl,kt,leadSide,st,rot,cx,cz}=timing(d.i,t,oW);
    const yawQ=new THREE.Quaternion().setFromAxisAngle(UPV,rot);
    const feet=TLD[d.i]?tlFeet(d,ti):null;
    if(feet && ENV.ell){ const m=motionAt(d.i,ti); d.group.visible=ENV.ell(m.px,m.pz)<OFFSTAGE; }   // off stage: hidden in the forest
    // pose from the actor's phrase (null: the looping positions); walking softens plie/releve and drops leg gestures
    const PZ=feet?poseAt(d.i,ti):null, ow=1-oW, wk=feet?clamp(feet.moving*2):0;
    const pl=PZ?PZ.plie*(1-0.7*wk)*ow:0, rl=PZ?PZ.releve*(1-wk)*ow:0;
    const gest=side=>{ if(!PZ) return [0,0,0]; const g=side==='L'?PZ.legR:PZ.legL; return [g[0],g[1]*(1-wk)*ow,g[2]]; };   // bone L = audience right
    // root: shift weight between the feet (or over the standing leg), dip on the downbeat, plie/releve, turn
    resetPose(d);
    const root=d.bones.root;
    let shx=0, shz=0;
    if(feet){ const rx=d.group.position.x+d.rest.root.x*d.sc+cx, rz=d.group.position.z+d.rest.root.z*d.sc+cz;
      shx=feet.sway[0]; shz=feet.sway[1];   // gait sway (from the track), and over the standing leg for a gesture
      [['L','R'],['R','L']].forEach(([g,sup])=>{ const w=ease(clamp(gest(g)[1]/45))*0.55;
        if(w>0){ shx+=(feet[sup][0]-rx-shx)*w; shz+=(feet[sup][2]-rz-shz)*w; } }); }
    const bob=feet?0.018*wk*(1-Math.max(Math.sin(Math.PI*feet.phL),Math.sin(Math.PI*feet.phR))):0;   // walking: the pelvis rides highest over the standing leg
    root.position.set(d.rest.root.x+(cx+shx)/d.sc, d.rest.root.y-(dip*0.045+pl*0.11-(rl>0?releveRise(d,"L",rl):0)+bob)/d.sc, d.rest.root.z+(cz+shz)/d.sc);
    root.quaternion.copy(yawQ);
    d.group.updateMatrixWorld(true);
    if(feet){ let drop=0;
      ['L','R'].forEach(side=>{ const gw=clamp(gest(side)[1]/20); if(gw>=1) return; const r=d.rest;
        const Lm=(r['lowerleg01.'+side].distanceTo(r['upperleg01.'+side])+r['foot.'+side].distanceTo(r['lowerleg01.'+side]))*d.sc*0.985;
        const hip=d.bones['upperleg01.'+side].getWorldPosition(new THREE.Vector3()), T=feet[side], ty=T[1]+(rl>0?releveRise(d,side,rl):0);
        const h=Math.hypot(hip.x-T[0],hip.z-T[2]), v=hip.y-ty, v2=Math.sqrt(Math.max(0,Lm*Lm-h*h));
        drop=Math.max(drop,(v-v2)*(1-gw)); });
      if(drop>0){ root.position.y-=Math.min(drop,0.3)/d.sc; d.group.updateMatrixWorld(true); } }
    // floor work: the whole body pitched forward at the pelvis, and kneeling legs - the knee down on a spot of its own (metres
    // forward of where the dancer stands), the shin along the floor behind it, the pelvis where the kneeling thighs put it
    // (thigh angle from vertical: positive sits back toward the heels, negative lies forward of the knee)
    const pitch=PZ?PZ.pitch*ow*D:0, KN={L:PZ?PZ.kneelR:[0,0,0], R:PZ?PZ.kneelL:[0,0,0]}, KW=Math.max(KN.L[0],KN.R[0])*ow, KP={};   // bone L = audience right
    const fwd=new THREE.Vector3(0,0,1).applyQuaternion(yawQ);
    if(pitch){ root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch)); d.group.updateMatrixWorld(true); }
    if(feet && KW>0){ const m=motionAt(d.i,ti), hipW=s=>d.bones['upperleg01.'+s].getWorldPosition(new THREE.Vector3());
      const mid=hipW('L').add(hipW('R')).multiplyScalar(0.5), tgt=new THREE.Vector3(); let ws=0;
      ['L','R'].forEach(side=>{ const [w,kf,th]=KN[side]; if(w<=0) return; const r=d.rest;
        const L1=r['lowerleg01.'+side].distanceTo(r['upperleg01.'+side])*d.sc, lat=(r['upperleg01.'+side].x-r.root.x)*d.sc;
        const K=new THREE.Vector3(lat,0,kf).applyQuaternion(yawQ).add(new THREE.Vector3(m.px,KNEE_R,m.pz));
        const H=Math.max(HIP_MIN,KNEE_R+L1*Math.cos(th*D)), hz=Math.sqrt(Math.max(0,L1*L1-(H-KNEE_R)**2))*Math.sign(th);
        const hip=K.clone().addScaledVector(fwd,-hz); hip.y=H;
        KP[side]={K,w:w*ow}; tgt.addScaledVector(hip.sub(hipW(side)).add(mid),w); ws+=w; });
      tgt.multiplyScalar(1/ws).sub(mid).multiplyScalar(KW);
      root.position.add(tgt.multiplyScalar(1/d.sc)); d.group.updateMatrixWorld(true); }
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
        const G=hip.clone().addScaledVector(v,len); G.y=Math.max(G.y,T.y+0.04*clamp(gh/10)+0.12*Math.max(0,-v.y)*gw);   // a low gesture hovers: the pointed toe clears the floor
        G.y+=Math.sin(Math.PI*gw)*0.05;   // the foot leaves and meets the floor in a small arc instead of brushing along it
        T.lerp(G,gw); o.point=v; o.pointW=gw*clamp((T.y-feet_y(d,side))/0.1);   // the foot flattens as it nears the floor, so the pointed toe never drags
        const kp=ease(clamp((gd-20)/90))*clamp((gh-15)/30); o.pole=new THREE.Vector3(0,0,1).applyQuaternion(yawQ).multiplyScalar(1-kp).add(UPV.clone().multiplyScalar(kp)).normalize();   // knee turns up for back gestures
      }
      if(feet && gw<0.5 && !KP[side]){ const u=feet['ph'+side];   // a walking step: heel peels off first (toes down), the heel meets the floor first (toes up)
        if(u>0&&u<1){ const r=0.6*Math.sin(Math.PI*u)*(1-1.6*u); o.roll=r; T.y+=Math.max(0,0.14*d.sc/1.8*Math.sin(r)); } }
      if(rl>0 && gw<1 && !KP[side]){ o.releve=rl*(1-gw); }   // legIK raises the heel
      if(KP[side]){ const {K,w}=KP[side], r=d.rest, L2=r['foot.'+side].distanceTo(r['lowerleg01.'+side])*d.sc;   // kneeling: shin back along the floor
        const hip=d.bones['upperleg01.'+side].getWorldPosition(new THREE.Vector3()), FK=K.clone().addScaledVector(fwd,-L2); FK.y=ANKLE_R;
        T.lerp(FK,w); T.y+=Math.sin(Math.PI*w)*0.14;      // the foot travels through the air as the knee goes down or comes up
        o.pole=(o.pole||fwd.clone()).lerp(K.clone().sub(hip).normalize(),w).normalize(); o.point=fwd.clone().negate(); o.pointW=w; }
      legIK(d,side,T,yawQ,o);
    });
    FIN.push(()=>{
    const me=root.getWorldPosition(new THREE.Vector3()), near=[]; RC.forEach((c,j)=>{ if(j!==d.i && c.length && Math.hypot(c[1].a.x-me.x,c[1].a.z-me.z)<1.6) near.push(...c); });   // the other bodies as posed this frame
    // arms
    const qa=PZ?{L:lerpArm(armOf(PZ.L),FINAL.L,oW), R:lerpArm(armOf(PZ.R),FINAL.R,oW)}
              :{L:lerpArm(lerpArm(prev.L,cur.L,k),FINAL.L,oW), R:lerpArm(lerpArm(prev.R,cur.R,k),FINAL.R,oW)};
    HOLDS.forEach(h=>{ if(h.ib!==d.i || !h.turn) return; const w=holdW(h,t); if(w<=0) return;   // turning under the hands: the free arm comes in to the waist, clear of the partner
      const held=holdHands(h).map(x=>x[1]); ['L','R'].forEach(sd=>{ if(held.includes(sd)) return; const key=sd==='L'?'R':'L'; qa[key]=lerpArm(qa[key],TUCK,w); }); });
    ['L','R'].forEach(side=>{
      const s=side==='L'?1:-1, b=d.bones;
      // our "L" in the position table is the dancer's right as seen from the audience
      const qq=side==='L'?qa.R:qa.L;
      const [upD,foD,abd]=armDirs(s,qq,PERS[d.i],yawQ);
      const elev=Math.max(0,abd-80)*0.22*D;
      rotWorld(b['clavicle.'+side],new THREE.Quaternion().setFromAxisAngle(zr,s*elev));
      const r=d.rest, S=b['upperarm01.'+side].getWorldPosition(new THREE.Vector3());   // an arm reaching into the floor rests on it
      const Lu=r['lowerarm01.'+side].distanceTo(r['upperarm01.'+side])*d.sc, Lf=r['wrist.'+side].distanceTo(r['lowerarm01.'+side])*d.sc;
      let El=floorDir(S,upD,Lu,ELBOW_R,fwd); floorDir(El,foD,Lf,WRIST_R,fwd);
      const ht=HT[d.i+side];
      if(ht){ const dv=ht.T.clone().sub(S), dist=Math.min(dv.length(),(Lu+Lf)*0.999), dir=dv.normalize();   // holding a hand: two-bone reach to the grip, elbow down and out
        const a=(Lu*Lu-Lf*Lf+dist*dist)/(2*dist), hh=Math.sqrt(Math.max(0,Lu*Lu-a*a));
        const pole=new THREE.Vector3(0,-1,0).addScaledVector(xr,s*0.7).addScaledVector(fwd,-0.2); pole.addScaledVector(dir,-pole.dot(dir));
        const out=xr.clone().multiplyScalar(s); out.addScaledVector(dir,-out.dot(dir)); pole.addScaledVector(out,3*Math.max(0,0.6-pole.length())).normalize();   // reaching up over the head the elbow points out to the side
        // the elbow goes round the circle of places that keep the hand in the grip: as near the natural one (down and out)
        // as it can while staying out of the other bodies - a weighted average over the circle, so it never jumps
        const C=S.clone().addScaledVector(dir,a), p1=dir.clone().cross(pole), V=new THREE.Vector3();
        for(let k=0;k<16;k++){ const th=k*Math.PI/8, e=pole.clone().multiplyScalar(Math.cos(th)).addScaledVector(p1,Math.sin(th));
          let pen=0; if(near.length){ const Ek=C.clone().addScaledVector(e,hh), Mk=Ek.clone().lerp(ht.T,0.5);
            pen=pushOut(Ek.clone(),near,0.05).distanceTo(Ek)+pushOut(Mk.clone(),near,0.045).distanceTo(Mk); }
          V.addScaledVector(e,Math.exp(-(0.5*(1-Math.cos(th))+12*pen)/0.15)); }
        const E=V.lengthSq()>1e-12?C.addScaledVector(V.normalize(),hh):C.addScaledVector(pole,hh);
        slerpDir(upD,E.clone().sub(S).normalize(),ht.w); slerpDir(foD,ht.T.clone().sub(E).normalize(),ht.w);   // at an even angular pace, never whipping through the middle
        El=S.clone().addScaledVector(upD,Lu); }
      const av=ht?clamp((1-ht.w)/0.2):1;   // a fully held arm has already bent round the bodies
      if(near.length && av>0){   // an arm meeting another body rests on it instead of passing through (also while taking hold or letting go)
        const u0=upD.clone(), f0=foD.clone();
        for(let it=0;it<3;it++){ const E2=pushOut(El.clone(),near,0.05,S); upD.copy(E2.sub(S)).normalize(); El=S.clone().addScaledVector(upD,Lu); }
        for(let it=0;it<3;it++){ const M=El.clone().addScaledVector(foD,Lf*0.5), W=El.clone().addScaledVector(foD,Lf);
          pushOut(M,near,0.045,El); pushOut(W,near,0.06,El); foD.copy(W.sub(El).normalize().add(M.sub(El).normalize())).normalize(); }
        if(av<1){ const ua=upD.clone(), fa=foD.clone(); slerpDir(upD.copy(u0),ua,av); slerpDir(foD.copy(f0),fa,av); } }
      aim(b['upperarm01.'+side],b['lowerarm01.'+side],upD,0,fwd);
      if(ht){ const hb=clamp((upD.angleTo(foD)-10*D)/(25*D))*ht.w; if(hb>0){   // a held arm: the elbow is a hinge, so the upper arm's whole orientation follows from
          // the arm's direction and the plane it bends in - the same shape always gives the same arm, however the body turned to get there
          const r=d.rest, u0=r['lowerarm01.'+side].clone().sub(r['upperarm01.'+side]).normalize(), h0=elbowHinge(d,side), hd=upD.clone().cross(foD).normalize();
          const fr=(x,h)=>{ const y=h.clone().addScaledVector(x,-h.dot(x)).normalize(); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,x.clone().cross(y))); };
          const Qt=fr(upD,hd).multiply(fr(u0,h0).invert()), Qc=b['upperarm01.'+side].getWorldQuaternion(new THREE.Quaternion());
          rotWorld(b['upperarm01.'+side],new THREE.Quaternion().slerp(Qt.multiply(Qc.invert()),hb)); } }
      aim(b['lowerarm01.'+side],b['wrist.'+side],foD);
      rotWorld(b['lowerarm02.'+side],new THREE.Quaternion().setFromAxisAngle(foD,-s*qq.palm*D));
      if(ht) gripHand(d,side,foD,ht);
    });
    // head
    const h0=PZ?PZ.head:lerp2(prev.head,cur.head,k);
    const hb=lerp(h0[0],FINAL.head[0],oW)+dip*6, ht=lerp(h0[1],0,oW)+TILT[d.i];
    rotWorld(d.bones.neck02,new THREE.Quaternion().setFromAxisAngle(xr,hb*0.5*D));
    rotWorld(d.bones.head,new THREE.Quaternion().setFromAxisAngle(xr,hb*0.5*D).multiply(new THREE.Quaternion().setFromAxisAngle(zr,-ht*D)));
    if(d.robeMesh){ const mi=d.robeMesh.morphTargetInfluences;
      if(mi.length>1 && P.swing>0 && feet){ const m=motionAt(d.i,ti), c=Math.cos(-rot), sn=Math.sin(-rot), g=P.swing;   // the hem's pendulum, into the body's own frame
        let x=(c*m.hx+sn*m.hz)*g, z=(-sn*m.hx+c*m.hz)*g; const L=Math.hypot(x,z); if(L>0.12){ x*=0.12/L; z*=0.12/L; }
        // the knees: a knee reaching forward or out (a walking step, a gesture) carries the hem with it, so no leg pokes through
        let kx=0, kz=0, kf=0; const pv=d.bones.root.getWorldPosition(new THREE.Vector3());
        ['L','R'].forEach(sd=>{ const K=d.bones['lowerleg01.'+sd].getWorldPosition(new THREE.Vector3()).sub(pv), bx=c*K.x+sn*K.z, bz=-sn*K.x+c*K.z, l=Math.hypot(bx,bz), ex=Math.max(0,l-0.1);
          if(ex>0){ kx+=bx/l*ex*0.6; kz+=bz/l*ex*0.6; kf=Math.max(kf,ex*1.2); } });   // just enough to keep the knee covered
        x+=kx; z+=kz; const L2=Math.hypot(x,z); if(L2>0.2){ x*=0.2/L2; z*=0.2/L2; }
        mi[0]=clamp(P.skirt+P.swing*m.fl+kf,0,1.6); mi[1]=x/d.sc; mi[2]=z/d.sc; }
      else if(mi.length>1 && P.swing>0){ const sw=skirtSwing(d.i,t,{cx,cz,rot}); mi[0]=clamp(P.skirt+sw.flare,0,1.6); mi[1]=sw.x/d.sc; mi[2]=sw.z/d.sc; }
      else { mi[0]=P.skirt; if(mi.length>1) mi[1]=mi[2]=0; } }
    updateSleeves(d);
    });
  });
  const HT=HOLDS.length?holdTargets(t):{}, RC=dancers.map(d=>TLD[d.i]&&d.group.visible?postedCaps(d):[]);
  FIN.forEach(f=>f());
  cameraUpdate(t);
  renderer.render(scene,camera);
  return {rms,cent,flat,countInBar};
}

