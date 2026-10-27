// Scene: section timeline, keyframes, environment (studio | jungle) and camera director. Driven by clips/<clip>/scene.json.
// Everything here is optional: without scene.json the stage behaves exactly as before (studio backdrop, fixed camera).

// ---------- sections and time references
const SECTIONS=(()=>{ let bar=0; return (TRACK.sections||[]).map(s=>{ const o={name:s.name, bar0:bar, bars:s.bars}; bar+=s.bars; return o; }); })();
function barTime(b){ return F.beat_offset+(b*CPB+P.shift+F.bar_phase)*F.beat_period+P.offsetMs/1000; }
function atTime(at){                       // 'C', 'C+2', 'C+1.5', 12.3
  if(typeof at==='number') return at;
  const m=String(at).match(/^([^+\-]+)(?:([+\-])([\d.]+))?$/); if(!m) return 0;
  const s=SECTIONS.find(x=>x.name===m[1].trim()); if(!s) return 0;
  const off=m[2]?(m[2]==='-'?-1:1)*parseFloat(m[3]):0; return barTime(s.bar0+off);
}
function sectionAt(t){
  if(!SECTIONS.length) return null;
  let i=0; for(let k=0;k<SECTIONS.length;k++) if(t>=barTime(SECTIONS[k].bar0)) i=k;
  const s=SECTIONS[i], t0=barTime(s.bar0), t1=barTime(s.bar0+s.bars);
  return {name:s.name, index:i, t0, t1, bar:Math.floor((t-t0)/(t1-t0)*s.bars), frac:clamp((t-t0)/(t1-t0))};
}
// keyframes: each entry inherits the previous one's values; blends in over 'blend' bars (default 1)
function makeKF(list,defaults){
  const barLen=CPB*F.beat_period; let cur={...defaults};
  const ks=(list||[]).map(k=>{ cur={...cur}; for(const key in k) if(!['at','blend'].includes(key)) cur[key]=k[key];
    return {T:atTime(k.at), dur:(k.blend===undefined?1:k.blend)*barLen, v:cur}; }).sort((a,b)=>a.T-b.T);
  return t=>{
    if(!ks.length) return defaults;
    let i=-1; for(let k=0;k<ks.length;k++) if(t>=ks[k].T) i=k;
    if(i<0) return ks[0].v;
    const prev=i>0?ks[i-1].v:ks[i].v, u=ks[i].dur>0?ease(clamp((t-ks[i].T)/ks[i].dur)):1, o={};
    for(const key in ks[i].v) o[key]=(typeof ks[i].v[key]==='number')?lerp(prev[key]??ks[i].v[key],ks[i].v[key],u):ks[i].v[key];
    return o;
  };
}

// ---------- seeded random
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ---------- camera director
const CAM={shots:[], free:false};
// Shots: each entry holds until the next. "to" = where it ends (path "line" | "arc"); "cut": false + "blend" = blend in
// from the previous shot. "glide": true = fly smoothly from this pose to the next entry's pose; consecutive glide
// entries form one continuous flight (no stops at the waypoints, only at the start and end of the chain).
(function(){
  const list=(SCENE.cameras||[]).map(s=>({...s, T:atTime(s.at)})).sort((a,b)=>a.T-b.T);
  const V=a=>new THREE.Vector3(...a);
  list.forEach((s,i)=>{ s.p0=V(s.pos); s.l0=V(s.look); s.f0=s.fov||34;
    const to=s.to||{}; s.p1=to.pos?V(to.pos):s.p0.clone(); s.l1=to.look?V(to.look):s.l0.clone(); s.f1=to.fov||s.f0;
    s.T1=i+1<list.length?list[i+1].T:F.duration; s.next=s.glide&&i+1<list.length?list[i+1]:null; });
  // tangents for the glide chains (zero at the ends of a chain, Catmull-Rom style inside)
  list.forEach((s,i)=>{ const inside=i>0&&list[i-1].glide&&s.glide&&i+1<list.length;
    if(inside){ const a=list[i-1], b=list[i+1], dt=b.T-a.T;
      s.vp=b.p0.clone().sub(a.p0).divideScalar(dt); s.vl=b.l0.clone().sub(a.l0).divideScalar(dt); s.vf=(b.f0-a.f0)/dt; }
    else { s.vp=new THREE.Vector3(); s.vl=new THREE.Vector3(); s.vf=0; } });
  CAM.shots=list;
})();
function hermite(a,b,va,vb,dt,u){ const u2=u*u,u3=u2*u; return a*(2*u3-3*u2+1)+va*dt*(u3-2*u2+u)+b*(-2*u3+3*u2)+vb*dt*(u3-u2); }
function hermV(a,b,va,vb,dt,u){ return new THREE.Vector3(hermite(a.x,b.x,va.x,vb.x,dt,u),hermite(a.y,b.y,va.y,vb.y,dt,u),hermite(a.z,b.z,va.z,vb.z,dt,u)); }
function shotState(s,t){
  if(s.next){ const n=s.next, dt=Math.max(0.05,n.T-s.T), u=clamp((t-s.T)/dt);
    return {pos:hermV(s.p0,n.p0,s.vp,n.vp,dt,u), look:hermV(s.l0,n.l0,s.vl,n.vl,dt,u), fov:hermite(s.f0,n.f0,s.vf,n.vf,dt,u)}; }
  const u=ease(clamp((t-s.T)/Math.max(0.1,s.T1-s.T))*0.999+0.0005);
  const look=s.l0.clone().lerp(s.l1,u), fov=lerp(s.f0,s.f1,u); let pos;
  if(s.path==='arc'){ // interpolate around the look point: angle, radius and height
    const a0=Math.atan2(s.p0.x-s.l0.x,s.p0.z-s.l0.z), a1=Math.atan2(s.p1.x-s.l1.x,s.p1.z-s.l1.z);
    const r0=Math.hypot(s.p0.x-s.l0.x,s.p0.z-s.l0.z), r1=Math.hypot(s.p1.x-s.l1.x,s.p1.z-s.l1.z);
    let da=a1-a0; if(da>Math.PI) da-=2*Math.PI; if(da<-Math.PI) da+=2*Math.PI;
    const a=a0+da*u, r=lerp(r0,r1,u); pos=new THREE.Vector3(look.x+Math.sin(a)*r, lerp(s.p0.y,s.p1.y,u), look.z+Math.cos(a)*r);
  } else pos=s.p0.clone().lerp(s.p1,u);
  return {pos,look,fov};
}
function cameraState(t){            // pure function of t (no sway): used to render and to clear the set around the camera path
  if(!CAM.shots.length) return null;
  let i=0; for(let k=0;k<CAM.shots.length;k++) if(t>=CAM.shots[k].T) i=k;
  const s=CAM.shots[i]; let st=shotState(s,t);
  if(s.cut===false&&i>0&&!CAM.shots[i-1].glide){ const bl=(s.blend||1)*CPB*F.beat_period, k=ease(clamp((t-s.T)/bl));
    if(k<1){ const p=shotState(CAM.shots[i-1],t); st={pos:p.pos.lerp(st.pos,k), look:p.look.lerp(st.look,k), fov:lerp(p.fov,st.fov,k)}; } }
  return st;
}
function cameraUpdate(t){
  if(CAM.free||!CAM.shots.length) return;
  const st=cameraState(t);
  // a slow handheld breath, deterministic in t
  const sw=(SCENE.camera_sway===undefined?1:SCENE.camera_sway)*0.025;
  st.pos.x+=sw*Math.sin(t*0.37)+sw*0.5*Math.sin(t*0.91); st.pos.y+=sw*0.6*Math.sin(t*0.53+1);
  const aspect=camera.aspect, portrait=aspect<1;
  camera.fov=portrait? 2*Math.atan(Math.tan(st.fov*D/2)*1.9)/D : st.fov;   // portrait: wider vertical view (tune per clip later)
  camera.position.copy(st.pos); camera.lookAt(st.look); camera.updateProjectionMatrix();
}

// ---------- environment
// Environments: 'studio' (default: the backdrop of clip 05) or an outdoor preset. An outdoor scene is generic (ground,
// sky, fog, sun with dappled light, shafts, mist, particles, light keyframes, palette); a preset adds its content
// (the forest for 'jungle') and its defaults. scene.json 'settings' and 'palette' override the preset.
const ENV={update:null};
const ENV_PRESETS={
  jungle:{ settings:{forest:true, seed:7, clearing_m:[5.5,4.2], clearing_center:[0,-0.6], trunks:90, understory:1, canopy:1,
                     canopy_height_m:15, vines:30, fog:0.03, sun_azimuth_deg:-25, sun_elevation_deg:52, ground:'forest floor', particles:'fireflies'},
           palette:{night:'#1f2a52', dawn:'#d09068', day:'#eee6c6', haze:'#30402c', cool:'#9fb4e0', warm:'#ffb062'} }
};
if(SCENE.environment&&SCENE.environment!=='studio') (function buildOutdoor(){
  const PRE=ENV_PRESETS[SCENE.environment]||ENV_PRESETS.jungle;
  const J={...PRE.settings, ...(SCENE.jungle||{}), ...(SCENE.settings||{})};
  const PAL={...PRE.palette, ...(SCENE.palette||{})};
  const R=rng(J.seed), rr=(a,b)=>a+(b-a)*R(), pick=a=>a[Math.floor(R()*a.length)];
  const CX=J.clearing_center[0], CZ=J.clearing_center[1], RX=J.clearing_m[0], RZ=J.clearing_m[1];
  const ell=(x,z)=>Math.hypot((x-CX)/RX,(z-CZ)/RZ);         // 1 = edge of the clearing
  camera.far=300; camera.updateProjectionMatrix();
  backdrop.visible=false; floor.visible=false;
  // keep the whole camera path clear: a corridor along the flight plus the view 3.5 m ahead of the lens
  const keep=[], pathPts=[]; let prevP=null, maxR=0;
  for(let t=0,n=0;t<=F.duration;t+=0.4,n++){ const st=cameraState(t); if(!st) break; const p=st.pos; pathPts.push(p);
    maxR=Math.max(maxR,Math.hypot(p.x-CX,p.z-CZ));
    if(prevP&&prevP.distanceTo(p)<3) keep.push([prevP.x,prevP.y,prevP.z,p.x,p.y,p.z]);
    if(n%4===0){ const d=st.look.clone().sub(p).normalize(); keep.push([p.x,p.y,p.z,p.x+d.x*3.5,p.y+d.y*3.5,p.z+d.z*3.5]); }
    prevP=p; }
  function blocked(x,y,z,r){ const rr2=(r+1.0)*(r+1.0);
    for(const k of keep){ const abx=k[3]-k[0],aby=k[4]-k[1],abz=k[5]-k[2], L=abx*abx+aby*aby+abz*abz||1e-9;
      let u=((x-k[0])*abx+(y-k[1])*aby+(z-k[2])*abz)/L; u=u<0?0:u>1?1:u;
      const dx=x-k[0]-abx*u, dy=y-k[1]-aby*u, dz=z-k[2]-abz*u; if(dx*dx+dy*dy+dz*dz<rr2) return true; }
    return false; }
  const blockedCol=(x,z,h,r)=>{ for(let y=0.4;y<=h;y+=1.0) if(blocked(x,y,z,r)) return true; return false; };
  const tex=(c,rep)=>{ const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; t.anisotropy=4; if(rep){ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rep,rep);} return t; };
  const canvas=(w,h)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c,c.getContext('2d')]; };

  const FOREST=J.forest?(function growForest(){
  // ---- leaf atlas: 2x2 cells (broad, split, palm, fern); base at the bottom of each cell
  const [lc,lx]=canvas(1024,1024);
  function cell(i,fn){ lx.save(); lx.translate((i%2)*512,Math.floor(i/2)*512); fn(lx); lx.restore(); }
  const leafGrad=(c,a,b)=>{ const g=c.createLinearGradient(0,512,0,0); g.addColorStop(0,a); g.addColorStop(1,b); return g; };
  cell(0,c=>{ // broad banana/heliconia leaf with parallel veins and a few tears
    c.beginPath(); c.moveTo(256,508); c.bezierCurveTo(70,400,80,90,256,6); c.bezierCurveTo(432,90,442,400,256,508); c.fillStyle=leafGrad(c,'#3d6b2a','#6f9a3a'); c.fill();
    c.globalCompositeOperation='source-atop'; c.strokeStyle='rgba(20,40,10,0.35)'; c.lineWidth=1.4;
    for(let y=30;y<500;y+=9){ c.beginPath(); c.moveTo(256,y); c.quadraticCurveTo(200,y-14,90,y-40); c.moveTo(256,y); c.quadraticCurveTo(312,y-14,422,y-40); c.stroke(); }
    c.strokeStyle='rgba(225,235,170,0.55)'; c.lineWidth=6; c.beginPath(); c.moveTo(256,508); c.lineTo(256,10); c.stroke();
    c.globalCompositeOperation='destination-out'; c.lineWidth=3;
    for(let k=0;k<6;k++){ const y=80+k*70+rr(-20,20), s=R()<0.5?-1:1; c.beginPath(); c.moveTo(256+s*190,y-40); c.lineTo(256+s*6,y); c.stroke(); }
  });
  cell(1,c=>{ // split philodendron leaf (heart shape with slits and holes)
    c.beginPath(); c.moveTo(256,470); c.bezierCurveTo(20,430,10,120,256,30); c.bezierCurveTo(502,120,492,430,256,470); c.fillStyle=leafGrad(c,'#2f5a22','#5f8a34'); c.fill();
    c.globalCompositeOperation='destination-out'; c.lineWidth=13; c.lineCap='round';
    for(let k=0;k<7;k++){ const ang=(-70+k*23)*D, L=rr(150,215); [1,-1].forEach(s=>{ c.beginPath(); c.moveTo(256+s*Math.sin(ang)*235,250-Math.cos(ang)*190); c.lineTo(256+s*Math.sin(ang)*(235-L*0.75),250-Math.cos(ang)*(190-L*0.6)); c.stroke(); }); }
    for(let k=0;k<5;k++){ c.beginPath(); c.ellipse(256+rr(-90,90),rr(150,380),rr(6,14),rr(10,22),0,0,7); c.fill(); }
    c.globalCompositeOperation='source-atop'; c.strokeStyle='rgba(210,225,150,0.5)'; c.lineWidth=5; c.beginPath(); c.moveTo(256,470); c.lineTo(256,40); c.stroke();
  });
  cell(2,c=>{ // palm frond: rachis + narrow leaflets
    c.strokeStyle='#4a6a28'; c.lineWidth=7; c.beginPath(); c.moveTo(256,512); c.quadraticCurveTo(262,250,256,4); c.stroke();
    for(let y=500;y>20;y-=11){ const k=1-y/512, L=170*Math.sin(Math.PI*clamp(0.08+(1-k)*0.92))+20;
      [1,-1].forEach(s=>{ c.fillStyle=`rgb(${60+rr(-10,10)},${100+rr(-15,15)},${40+rr(-8,8)})`;
        c.beginPath(); c.moveTo(256,y); c.quadraticCurveTo(256+s*L*0.5,y-L*0.42,256+s*L,y-L*0.55); c.quadraticCurveTo(256+s*L*0.5,y-L*0.3,256,y-6); c.fill(); }); }
  });
  cell(3,c=>{ // fern frond
    c.strokeStyle='#3e5e22'; c.lineWidth=4; c.beginPath(); c.moveTo(256,512); c.lineTo(256,8); c.stroke();
    for(let y=500;y>12;y-=14){ const k=y/512, L=150*Math.pow(k,0.7)+12;
      [1,-1].forEach(s=>{ c.fillStyle=`rgb(${70+rr(-12,12)},${115+rr(-15,15)},${45+rr(-10,10)})`;
        for(let j=0;j<L;j+=9){ c.beginPath(); c.ellipse(256+s*(j+6),y-j*0.35,5.5*(1-j/L)+2,4,s*0.4,0,7); c.fill(); } }); }
  });
  const leafTex=tex(lc); leafTex.flipY=true;
  // leaf geometry: length along +z (base at origin), slightly folded at the midrib, tip droops down
  function leafGeo(cellIdx,droop,fold){
    const N=8, pos=[], uv=[], idx=[], u0=(cellIdx%2)*0.5, v0=1-(Math.floor(cellIdx/2)+1)*0.5;
    for(let i=0;i<=N;i++){ const v=i/N; for(let j=0;j<3;j++){ const u=j/2;
      pos.push((u-0.5)*1.0, -droop*v*v+(j===1?fold:0)*Math.sin(Math.PI*v), v*1.0);
      uv.push(u0+u*0.5, v0+v*0.5); } }
    for(let i=0;i<N;i++) for(let j=0;j<2;j++){ const a=i*3+j,b=a+1,c=a+3,d=c+1; idx.push(a,b,c, b,d,c); }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const leafMat=new THREE.MeshStandardMaterial({map:leafTex, alphaTest:0.45, side:THREE.DoubleSide, roughness:0.75, metalness:0, emissive:0x000000, emissiveMap:leafTex});
  const leafSets=[]; // {mesh, list}
  const LEAF_GEOS=[leafGeo(0,0.28,0.05), leafGeo(1,0.18,0.04), leafGeo(2,0.32,0.03), leafGeo(3,0.22,0.02)];
  const ASPECT=[0.42,0.85,0.7,0.5];     // width/length per cell
  const leaves=[[],[],[],[]], litter=[[],[],[],[]];
  const _m=new THREE.Matrix4(), _q=new THREE.Quaternion(), _e=new THREE.Euler(), _s=new THREE.Vector3(), _p=new THREE.Vector3();
  function addLeaf(type,x,y,z,yaw,elev,len,roll,shade){
    (y<0.05?litter:leaves)[type].push([x,y,z,yaw,elev,len,roll||0,shade===undefined?rr(0.7,1.1):shade]);
  }
  function clump(type,x,z,size,n,elevA,elevB,y0){
    for(let k=0;k<n;k++) addLeaf(type,x+rr(-0.1,0.1),(y0||0)+rr(0,0.15)*size,z+rr(-0.1,0.1),(k/n)*Math.PI*2+rr(-0.3,0.3),rr(elevA,elevB)*D,size*rr(0.7,1.15),rr(-0.3,0.3));
  }
  // understory: dense ring around the clearing, thinning outward, avoiding camera paths
  const nU=Math.round(420*J.understory);
  for(let k=0;k<nU;k++){
    const a=R()*Math.PI*2, e=1.05+Math.pow(R(),1.8)*4.5, x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e;
    const type=pick([0,0,1,1,2,3,3]), size=type===0?rr(1.4,2.8):type===1?rr(0.7,1.3):type===2?rr(1.8,3.2):rr(0.8,1.5);
    if(blocked(x,size*0.5,z,size*0.7)) continue;
    clump(type,x,z,size,Math.round(rr(5,11)),type===3?15:25,type===2?55:72);
  }
  // a few low plants scattered inside the clearing's edge (never near the dancers)
  for(let k=0;k<60;k++){ const a=R()*Math.PI*2, e=rr(0.78,1.0), x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e; if(blocked(x,0.3,z,0.5)) continue; clump(3,x,z,rr(0.5,0.9),7,10,40); }
  // trunks: tapered, slightly curved, with bark texture
  const [bc,bx]=canvas(256,512); bx.fillStyle='#3a2e24'; bx.fillRect(0,0,256,512);
  for(let k=0;k<900;k++){ bx.fillStyle=`rgba(${rr(10,90)|0},${rr(10,70)|0},${rr(5,50)|0},${rr(0.15,0.5)})`; bx.fillRect(rr(0,256),rr(0,512),rr(1,4),rr(10,80)); }
  for(let k=0;k<120;k++){ bx.fillStyle=`rgba(${rr(60,110)|0},${rr(90,130)|0},${rr(40,60)|0},${rr(0.2,0.5)})`; bx.beginPath(); bx.ellipse(rr(0,256),rr(0,512),rr(4,22),rr(6,30),0,0,7); bx.fill(); }
  const barkTex=tex(bc); barkTex.wrapS=barkTex.wrapT=THREE.RepeatWrapping;
  const tPos=[], tUv=[], tIdx=[]; const trunks=[];
  function trunk(x,z,h,r,lean,dir){
    const SEG=10, RAD=9, base=tPos.length/3;
    const bend=rr(-0.4,0.4);
    for(let i=0;i<=SEG;i++){ const v=i/SEG, rad=r*(1-0.55*v)*(1+0.6*Math.exp(-v*14)); // flared base
      const cx=x+Math.cos(dir)*lean*v*h+bend*Math.sin(v*Math.PI), cz=z+Math.sin(dir)*lean*v*h;
      for(let j=0;j<=RAD;j++){ const a=j/RAD*Math.PI*2, rj=rad*(1+0.12*Math.sin(a*3+x));
        tPos.push(cx+Math.cos(a)*rj, v*h, cz+Math.sin(a)*rj); tUv.push(j/RAD*Math.max(1,Math.round(r*6)), v*h/3); } }
    for(let i=0;i<SEG;i++) for(let j=0;j<RAD;j++){ const a=base+i*(RAD+1)+j, b=a+1, c=a+RAD+1, d=c+1; tIdx.push(a,c,b, b,c,d); }
    trunks.push({x:x+Math.cos(dir)*lean*h, z:z+Math.sin(dir)*lean*h, h, r, bx:x, bz:z});
  }
  for(let k=0,n=0;k<J.trunks*4&&n<J.trunks;k++){
    const a=R()*Math.PI*2, e=1.25+Math.pow(R(),1.3)*6, x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e;
    if(blockedCol(x,z,J.canopy_height_m*1.35,0.8)) continue; if(trunks.some(t=>Math.hypot(t.bx-x,t.bz-z)<1.6)) continue;
    const big=R()<0.25; trunk(x,z,J.canopy_height_m*rr(0.75,1.35),big?rr(0.45,0.8):rr(0.12,0.35),rr(0,0.08),R()*7); n++;
  }
  // canopy: leaf clusters at trunk tops and mid-height epiphytes; a roof with a gap over the clearing
  trunks.forEach(t=>{
    const n=Math.round(rr(26,46)*J.canopy);
    for(let k=0;k<n;k++){ const a=R()*7, r=rr(0.3,3.2); addLeaf(pick([0,0,2,2,1]),t.x+Math.cos(a)*r,t.h+rr(-1.5,1.2),t.z+Math.sin(a)*r,R()*7,rr(-30,40)*D,rr(1.6,3.2)); }
    if(R()<0.6){ const y=rr(2.5,t.h*0.6); clump(pick([3,1]),t.bx,t.bz,rr(0.6,1.1),8,10,50,y); }
  });
  for(let k=0;k<Math.round(260*J.canopy);k++){
    const a=R()*7, e=0.75+Math.pow(R(),0.8)*7, x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e, y=J.canopy_height_m*rr(0.85,1.3);
    for(let j=0;j<14;j++) addLeaf(pick([0,2,1]),x+rr(-2,2),y+rr(-1,1),z+rr(-2,2),R()*7,rr(-35,30)*D,rr(1.8,3.4));
  }
  // mid layer (2-9 m): small palms with frond crowns, broad-leaved saplings, epiphytes on the big trunks
  const mid=Math.round(55*J.understory);
  for(let k=0;k<mid;k++){
    const a=R()*7, e=1.1+Math.pow(R(),1.2)*4, x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e, h=rr(2.2,6.5);
    if(blockedCol(x,z,h+0.5,1.2)) continue;
    trunk(x,z,h,rr(0.05,0.1),rr(0,0.12),R()*7); trunks.pop();
    const palm=R()<0.6, n=palm?Math.round(rr(9,15)):Math.round(rr(5,9));
    for(let j=0;j<n;j++) addLeaf(palm?2:pick([0,1]),x,h+rr(-0.4,0.1),z,j/n*7+rr(-0.2,0.2),rr(-15,40)*D,palm?rr(1.8,3.2):rr(1.0,1.9));
  }
  trunks.filter(t=>t.r>0.3).forEach(t=>{ const n=Math.round(rr(2,5));
    for(let j=0;j<n;j++){ const y=rr(2.5,Math.min(11,t.h*0.7)), a=R()*7, ox=t.bx+Math.cos(a)*t.r, oz=t.bz+Math.sin(a)*t.r;
      for(let q=0;q<10;q++) addLeaf(pick([1,3,3,0]),ox,y+rr(-0.3,0.3),oz,a+rr(-1.3,1.3),rr(-70,35)*D,rr(0.7,1.6)); } });
  const vinePts=[];
  for(let k=0;k<J.vines&&trunks.length>1;k++){
    const a=pick(trunks), b=R()<0.6?pick(trunks):null, ya=a.h*rr(0.55,0.95);
    let pts;
    if(b&&b!==a&&Math.hypot(a.x-b.x,a.z-b.z)<9){ const yb=b.h*rr(0.5,0.9), sag=rr(2,5);
      pts=[0,0.25,0.5,0.75,1].map(u=>new THREE.Vector3(lerp(a.x,b.x,u),lerp(ya,yb,u)-sag*Math.sin(Math.PI*u),lerp(a.z,b.z,u))); }
    else { const l=rr(4,ya-1); pts=[0,0.33,0.66,1].map(u=>new THREE.Vector3(a.x+0.4*Math.sin(u*3+k),ya-l*u,a.z+0.4*Math.cos(u*2+k))); }
    if(pts.some(p=>blocked(p.x,p.y,p.z,0.3))) continue;
    const curve=new THREE.CatmullRomCurve3(pts); vinePts.push([curve,rr(0.025,0.06)]);
    const L=curve.getLength(); for(let u=0;u<L;u+=rr(0.25,0.5)){ const p=curve.getPointAt(u/L); addLeaf(pick([1,3]),p.x,p.y,p.z,R()*7,rr(-80,10)*D,rr(0.3,0.6)); }
  }
  // leaf litter on the ground
  for(let k=0;k<1400;k++){ const a=R()*7, e=Math.sqrt(R())*2.2, x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e; addLeaf(pick([0,1,3]),x,0.01,z,R()*7,0,rr(0.15,0.4),0,rr(0.12,0.26)); }
  const tg=new THREE.BufferGeometry(); tg.setAttribute('position',new THREE.Float32BufferAttribute(tPos,3)); tg.setAttribute('uv',new THREE.Float32BufferAttribute(tUv,2)); tg.setIndex(tIdx); tg.computeVertexNormals();
  const trunkMat=new THREE.MeshStandardMaterial({map:barkTex, color:0x9a8a7a, roughness:0.95});
  const trunkMesh=new THREE.Mesh(tg,trunkMat); trunkMesh.receiveShadow=true; scene.add(trunkMesh);
  const litterMat=new THREE.MeshStandardMaterial({map:leafTex, alphaTest:0.45, side:THREE.DoubleSide, roughness:0.9});
  const leafMeshes=[...leaves.map((l,i)=>[l,i,leafMat]),...litter.map((l,i)=>[l,i,litterMat])].map(([list,type,mat])=>{
    const m=new THREE.InstancedMesh(LEAF_GEOS[type],mat,list.length); const col=new THREE.Color();
    list.forEach((L,i)=>{ const [x,y,z,yaw,elev,len,roll,shade]=L;
      _q.setFromEuler(_e.set(-elev,yaw,roll,'YXZ')); _s.set(len*ASPECT[type],y<0.05?len*0.06:len,len); _m.compose(_p.set(x,y,z),_q,_s); m.setMatrixAt(i,_m);
      const ground=y<0.05; col.setHSL(ground?rr(0.06,0.1):rr(0.2,0.3),ground?0.45:rr(0.35,0.6),shade*(ground?0.5:0.55)); m.setColorAt(i,col); });
    m.receiveShadow=(mat===litterMat); m.castShadow=false; scene.add(m); return m;
  });
  // vines: hanging lianas between trunks or straight down
  const vineMat=new THREE.MeshStandardMaterial({color:0x2d2a1c, roughness:0.9});
  vinePts.forEach(([c,r])=>scene.add(new THREE.Mesh(new THREE.TubeGeometry(c,24,r,5,false),vineMat)));
  return {leafMat};
  })():null;
  // ground: dark soil and moss
  const [gc,gx]=canvas(1024,1024); gx.fillStyle='#2a2318'; gx.fillRect(0,0,1024,1024);
  for(let k=0;k<5000;k++){ const m=R()<0.35; gx.fillStyle=m?`rgba(${rr(40,70)|0},${rr(60,90)|0},${rr(25,40)|0},${rr(0.1,0.35)})`:`rgba(${rr(20,60)|0},${rr(15,45)|0},${rr(8,30)|0},${rr(0.15,0.4)})`;
    gx.beginPath(); gx.ellipse(rr(0,1024),rr(0,1024),rr(2,30),rr(2,20),R()*3,0,7); gx.fill(); }
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardMaterial({map:tex(gc,22), color:0xaaa090, roughness:0.92}));
  ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  // distant forest: rings of painted silhouettes that sink into the haze
  const [sc,sx]=canvas(2048,512);
  for(let k=0;k<70;k++){ const x=rr(0,2048), w=rr(6,26); sx.fillStyle='#fff'; sx.fillRect(x,rr(0,120),w,512); }
  for(let k=0;k<420;k++){ sx.fillStyle='#fff'; sx.beginPath(); sx.ellipse(rr(0,2048),rr(0,260)+(R()<0.3?rr(150,330):0),rr(20,90),rr(14,50),R()*3,0,7); sx.fill(); }
  const silTex=tex(sc); silTex.wrapS=THREE.RepeatWrapping;
  const RB=Math.max(30,maxR+8), rings=[[RB,26,0x14180f],[RB*1.33,34,0x1a1f15],[RB*1.73,44,0x20261b]].map(([r,h,c],i)=>{
    const t=silTex.clone(); t.needsUpdate=true; t.repeat.set(3+i,1); t.offset.x=i*0.37;
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,48,1,true),new THREE.MeshBasicMaterial({map:t, alphaTest:0.5, color:c, side:THREE.DoubleSide}));
    m.position.set(CX,h/2-0.5,CZ); scene.add(m); return m; });
  // sky dome with a sun glow
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{top:{value:new THREE.Color()}, hor:{value:new THREE.Color()}, sunC:{value:new THREE.Color()}, sunDir:{value:new THREE.Vector3(0,0.5,-1)}},
    vertexShader:'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:'uniform vec3 top,hor,sunC,sunDir; varying vec3 vD; void main(){ float h=clamp(vD.y,0.0,1.0); vec3 c=mix(hor,top,pow(h,0.6)); float s=max(dot(normalize(vD),normalize(sunDir)),0.0); c+=sunC*(pow(s,40.0)*1.5+pow(s,4.0)*0.35); gl_FragColor=vec4(c,1.0); }'});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(Math.max(120,RB*2.2),32,16),skyMat); scene.add(sky);
  // light shafts: billboards around their axis, additive
  const shaftMat=()=>new THREE.ShaderMaterial({transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, fog:false, side:THREE.DoubleSide,
    uniforms:{col:{value:new THREE.Color()}, op:{value:0}, time:{value:0}, seed:{value:R()*10}},
    vertexShader:'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:'uniform vec3 col; uniform float op,time,seed; varying vec2 vU; void main(){ float x=abs(vU.x*2.0-1.0); float a=pow(1.0-x,2.2)*smoothstep(0.0,0.22,vU.y)*smoothstep(1.0,0.55,vU.y); a*=0.65+0.35*sin(vU.x*23.0+seed*5.0+time*0.25)*sin(vU.x*9.0-seed+time*0.17); gl_FragColor=vec4(col*a*op,1.0); }'});
  const NSH=6, shafts=[];
  for(let k=0;k<NSH;k++){ const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),shaftMat()); m.matrixAutoUpdate=false; m.frustumCulled=false; scene.add(m);
    shafts.push({m, ox:rr(-1,1), oz:rr(-1,1), w:rr(1.2,3.0), ph:R()*7}); }
  // mist: soft sprites around the clearing and in the depth (never on the dancers)
  const [mc,mx]=canvas(256,128); { const g=mx.createRadialGradient(128,64,4,128,64,120); g.addColorStop(0,'rgba(255,255,255,0.55)'); g.addColorStop(1,'rgba(255,255,255,0)'); mx.fillStyle=g; mx.save(); mx.scale(1,0.5); mx.fillRect(0,0,256,256); mx.restore(); }
  const mistTex=tex(mc), mists=[];
  for(let k=0;k<44;k++){ const a=R()*7, e=rr(0.9,4.5), x=CX+Math.cos(a)*RX*e, z=CZ+Math.sin(a)*RZ*e;
    if(Math.hypot(x,z)<3.2) continue;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:mistTex, transparent:true, depthWrite:false, opacity:0}));
    s.position.set(x,rr(0.3,1.8),z); s.scale.set(rr(5,11),rr(1.6,3.2),1); scene.add(s); mists.push({s, x, z, ph:R()*7, sp:rr(0.04,0.12)}); }
  // fireflies (night) and dust motes (in the sun)
  function points(n,area,size,color){
    const pos=new Float32Array(n*3), ph=new Float32Array(n);
    for(let k=0;k<n;k++){ const a=R()*7, e=Math.sqrt(R())*area; pos[k*3]=CX+Math.cos(a)*RX*e; pos[k*3+1]=rr(0.15,3.6); pos[k*3+2]=CZ+Math.sin(a)*RZ*e; ph[k]=R();
      if(k%3===0&&pathPts.length){ const q=pick(pathPts); if(Math.hypot(q.x-CX,q.z-CZ)>RX){ pos[k*3]=q.x+rr(-4,4); pos[k*3+1]=rr(0.3,Math.max(1,q.y+2)); pos[k*3+2]=q.z+rr(-4,4); } } }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('ph',new THREE.BufferAttribute(ph,1));
    const m=new THREE.ShaderMaterial({transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      uniforms:{col:{value:new THREE.Color(color)}, op:{value:0}, time:{value:0}, size:{value:size}, spark:{value:0}, epoch:{value:0}, px:{value:1}},
      vertexShader:`attribute float ph; uniform float time,size,spark,epoch,px; varying float vA;
        float h(float x){ return fract(sin(x)*43758.5453); }
        void main(){ vec3 p=position; float t=time*0.25+ph*40.0; p+=vec3(sin(t*0.7)*0.35,sin(t*0.9+ph*7.0)*0.18,cos(t*0.6)*0.35);
          float fl=0.5+0.5*sin(time*(1.5+ph*2.5)+ph*30.0); fl=pow(fl,3.0);
          float sp=step(0.72,h(ph*91.7+epoch))*spark;
          vA=clamp(fl*0.8+sp*1.4,0.0,1.6);
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_PointSize=size*px*(1.0+sp*0.8)/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader:`uniform vec3 col; uniform float op; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); a*=a; gl_FragColor=vec4(col*a*vA*op,1.0); }`});
    const p=new THREE.Points(g,m); p.frustumCulled=false; scene.add(p); return m;
  }
  const flies=points(220,1.6,60,0xd8f070), dust=points(500,0.9,14,0xfff1d0);
  // the sun: a shadowed spot from high in the canopy gap, with a dappled-leaf pattern projected through it
  const [dc,dx]=canvas(512,512); dx.fillStyle='#fff'; dx.fillRect(0,0,512,512); dx.filter='blur(5px)';
  for(let k=0;k<160;k++){ dx.fillStyle=`rgba(0,0,0,${rr(0.55,0.95)})`; dx.beginPath(); dx.ellipse(rr(0,512),rr(0,512),rr(12,55),rr(6,26),R()*3,0,7); dx.fill(); }
  dx.filter='none'; const gobo=tex(dc);
  back.map=gobo; back.angle=0.42; back.penumbra=0.8; back.decay=0; back.distance=0;
  back.shadow.camera.near=4; back.shadow.camera.far=60; back.shadow.mapSize.set(2048,2048);
  rimL.position.set(-7,4.5,-7); rimR.position.set(7,4.5,-7);
  fill.groundColor.set(0x1a1610);

  // ---------- per frame
  const lightKeys=(SCENE.light||[]).map(k=>{ const o={...k}; if(o.fireflies!==undefined&&o.particles===undefined){ o.particles=o.fireflies; } delete o.fireflies; return o; });
  const KF=makeKF(lightKeys,{day:0.5,sun:0.5,shafts:0.5,sweep:0.5,spread:1,particles:0,mist:0.5,cool:0,warm:0,elevation:J.sun_elevation_deg,azimuth:J.sun_azimuth_deg});
  const C_=h=>new THREE.Color(h), NIGHT=C_(PAL.night), DAWN=C_(PAL.dawn), DAY=C_(PAL.day), DAMP=C_(PAL.haze), COOL=C_(PAL.cool), WARM=C_(PAL.warm);
  const _c=new THREE.Color(), _d=new THREE.Vector3(), _x=new THREE.Vector3(), _y=new THREE.Vector3(), _z=new THREE.Vector3(), _cp=new THREE.Vector3();
  let centS=null, lastTT=null;
  ENV.update=(t,a)=>{
    const k=KF(t), JP={daylight:P.sDay, shafts:P.sShafts, sweep:P.sSweep, leafGlow:P.sGlow, mist:P.sMist, particles:P.sParticles, warmth:P.sWarm};
    // slow the brightness so the sweep reads as a sweep, not a flicker (stateless: a short window average)
    let cs=0; for(let i=-6;i<=6;i++) cs+=feat('cent',Math.max(0,t+i*0.08)); cs/=13;
    const day=clamp(k.day*JP.daylight,0,1.2);
    const sky=day<0.5?NIGHT.clone().lerp(DAWN,day/0.5):DAWN.clone().lerp(DAY,clamp((day-0.5)/0.5));
    sky.lerp(COOL,k.cool*0.8).lerp(WARM,k.warm*0.35);
    const sunC=sky.clone().lerp(a.tintC,P.tint*0.5).lerp(WARM,JP.warmth*0.3);
    const L=a.L;                                    // loudness-driven level incl. fade in/out
    // sun direction swings with the timbre (the filter sweeps), around the keyed azimuth
    const az=(k.azimuth+k.sweep*JP.sweep*(cs-0.5)*70+4*Math.sin(t*0.05))*D, el=k.elevation*D;
    _d.set(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));   // toward the sun
    back.position.set(CX,0,CZ).addScaledVector(_d,30); back.target.position.set(CX+0.25*Math.sin(t*0.4),0,CZ+0.2*Math.cos(t*0.33));
    back.color.copy(sunC); back.intensity=3.6*k.sun*L*(0.55+0.7*cs);
    rimL.color.copy(sky); rimR.color.copy(sky).lerp(sunC,0.5); rimL.intensity=rimR.intensity=(0.55+1.5*day)*L;
    front.color.copy(sky).lerp(new THREE.Color(0xffffff),0.3); front.intensity=(0.03+0.07*day)*L;
    fill.color.copy(sky); fill.intensity=(0.04+0.2*day)*L; fill.groundColor.setRGB(0.1,0.085,0.06).multiplyScalar(L);
    // sky, fog, distant forest
    const lv=(0.06+0.9*day)*L;
    skyMat.uniforms.top.value.copy(sky).multiplyScalar(0.35*lv); skyMat.uniforms.hor.value.copy(sky).multiplyScalar(0.8*lv);
    skyMat.uniforms.sunC.value.copy(sunC).multiplyScalar(k.sun*L*(0.4+0.6*cs)); skyMat.uniforms.sunDir.value.copy(_d);
    const fogC=sky.clone().lerp(DAMP,0.45).multiplyScalar(0.035+0.3*lv); scene.background.copy(fogC); scene.fog.color.copy(fogC);
    scene.fog.density=J.fog*(0.7+0.6*k.mist*JP.mist)+P.haze*0.02*a.flat;
    rings.forEach((m,i)=>m.material.color.copy(sky).multiplyScalar((0.04+0.03*i)*(0.2+lv)));
    // leaves glow when backlit
    if(FOREST) FOREST.leafMat.emissive.copy(sunC).multiplyScalar(JP.leafGlow*(0.04+0.45*day*k.sun)*L*(0.6+0.6*cs));
    // shafts
    camera.getWorldPosition(_cp);
    shafts.forEach((s,i)=>{
      const vis=clamp(k.shafts*NSH-i,0,1)*JP.shafts, sp=k.spread;
      const p0=new THREE.Vector3(CX+s.ox*RX*0.6*sp+0.3*Math.sin(t*0.07+s.ph), 0, CZ+s.oz*RZ*0.5*sp);
      const len=(J.canopy_height_m+4)/Math.max(0.3,_d.y), w=s.w*(0.6+0.4*sp);
      _y.copy(_d); const mid=p0.clone().addScaledVector(_y,len*0.5);
      _z.subVectors(_cp,mid); _x.crossVectors(_y,_z).normalize(); _z.crossVectors(_x,_y).normalize();
      s.m.matrix.makeBasis(_x.multiplyScalar(w),_y.clone().multiplyScalar(len),_z).setPosition(mid);
      s.m.material.uniforms.col.value.copy(sunC); s.m.material.uniforms.time.value=t;
      s.m.material.uniforms.op.value=vis*k.sun*L*(0.2+0.5*cs)*(0.75+0.25*Math.sin(t*0.11+s.ph*3));
      s.m.visible=vis>0.001;
    });
    // mist drifts slowly; thicker with the section's mist and noisier sound
    mists.forEach(m=>{ m.s.position.x=m.x+Math.sin(t*m.sp+m.ph)*1.2; m.s.position.z=m.z+Math.cos(t*m.sp*0.8+m.ph)*0.6;
      m.s.material.color.copy(sky).lerp(sunC,0.3); m.s.material.opacity=clamp(k.mist*JP.mist*(0.15+0.2*a.flat)*(0.15+0.85*lv)*1.6); });
    // fireflies sparkle on the xylophone onsets; dust shows in the sun
    const px=renderer.getSize(new THREE.Vector2()).y/1080*renderer.getPixelRatio()*1.6;
    [flies,dust].forEach(m=>{ m.uniforms.time.value=t; m.uniforms.px.value=px; });
    flies.uniforms.op.value=k.particles*JP.particles*a.fin*(1-a.oL)*1.2; flies.uniforms.spark.value=clamp(a.onset*1.4-0.2); flies.uniforms.epoch.value=Math.floor(t*6);
    dust.uniforms.op.value=k.sun*day*0.35*L; dust.uniforms.spark.value=0; dust.uniforms.col.value.copy(sunC).lerp(new THREE.Color(0xffffff),0.5);
  };
})();
