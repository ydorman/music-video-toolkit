// ---------- hanging sleeves: the top rests on the arm, the rest falls with gravity
const SL_N=14, SL_M=13;
function makeSleeve(mat){
  const pos=new Float32Array(SL_N*SL_M*3), idx=[];
  for(let i=0;i<SL_N-1;i++) for(let j=0;j<SL_M-1;j++){ const a=i*SL_M+j,b=a+1,c=a+SL_M,d=c+1; idx.push(a,c,b, b,c,d); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setIndex(idx);
  const m=new THREE.Mesh(g,mat); m.castShadow=true; m.receiveShadow=true; m.frustumCulled=false; scene.add(m); return m;
}
const _sA=new THREE.Vector3(),_sB=new THREE.Vector3(),_sC=new THREE.Vector3(),_ax=new THREE.Vector3(),_dn=new THREE.Vector3(),_sd=new THREE.Vector3(),_pp=new THREE.Vector3(),_G=new THREE.Vector3(0,-1,0);
function updateSleeves(d){
  if(!d.sleeves.length) return;   // only the robe has hanging sleeves
  ['L','R'].forEach((side,si)=>{
    const b=d.bones, sc=d.sc, mesh=d.sleeves[si];
    b['upperarm01.'+side].getWorldPosition(_sA); b['lowerarm01.'+side].getWorldPosition(_sB); b['wrist.'+side].getWorldPosition(_sC);
    const pos=mesh.geometry.attributes.position.array; let prevDn=null;
    for(let i=0;i<SL_N;i++){
      const u=0.3+0.73*i/(SL_N-1);                 // from mid upper arm to just past the wrist
      let r, seg;
      if(u<0.42){ const k=u/0.42; _pp.copy(_sA).lerp(_sB,k); _ax.subVectors(_sB,_sA).normalize(); r=0.066-0.004*k; }
      else { const k=(u-0.42)/0.58; _pp.copy(_sB).lerp(_sC,k); _ax.subVectors(_sC,_sB).normalize(); r=0.062-0.01*k; }
      r*=sc;
      _dn.copy(_G).addScaledVector(_ax,-_G.dot(_ax)); const horiz=_dn.length();
      if(horiz<1e-3) _dn.set(0,0,1).addScaledVector(_ax,-_ax.z); _dn.normalize();
      _sd.crossVectors(_ax,_dn).normalize();
      const full=P.sleeve*Math.pow(clamp((u-0.3)/0.73),1.4)*0.2*sc*horiz;
      for(let j=0;j<SL_M;j++){
        const ph=(-115+230*j/(SL_M-1))*D, c=Math.cos(ph), s=Math.sin(ph);
        const hang=full*Math.pow(Math.max(0,c),1.3);
        const o=(i*SL_M+j)*3;
        pos[o]  =_pp.x+_sd.x*r*s+_dn.x*(r*c+hang);
        pos[o+1]=_pp.y+_sd.y*r*s+_dn.y*(r*c+hang);
        pos[o+2]=_pp.z+_sd.z*r*s+_dn.z*(r*c+hang);
      }
    }
    mesh.geometry.attributes.position.needsUpdate=true; mesh.geometry.computeVertexNormals();
  });
}

// ---------- people (made with MakeHuman, embedded below)
// everything per actor comes from actors.csv (embedded in each person's data as cfg); spots come from choreography.json
const SPOT_POS=CHOREO.formations.wide;
const CFG=PEOPLE_DATA.map(p=>p.meta.cfg);
const LAG=CFG.map(c=>c.lag), PERS=CFG.map(c=>[c.reach,c.offset]), TILT=CFG.map(c=>c.lean);
function b64(s){ const bin=atob(s), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u.buffer; }
const texLoader=new THREE.TextureLoader();
function loadTex(uri){ const t=texLoader.load(uri); t.encoding=THREE.sRGBEncoding; t.flipY=false; return t; }

function buildPerson(data,i){
  const meta=data.meta, buf=b64(data.bin);
  const group=new THREE.Group();
  const bones=meta.bones.map(b=>{ const bn=new THREE.Bone(); bn.name=b.n; return bn; });
  meta.bones.forEach((b,k)=>{ if(b.p>=0){ bones[b.p].add(bones[k]); const ph=meta.bones[b.p].h; bones[k].position.set(b.h[0]-ph[0],b.h[1]-ph[1],b.h[2]-ph[2]); } else bones[k].position.set(...b.h); });
  group.add(bones[0]);
  group.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(bones);
  const byName={}; bones.forEach(b=>byName[b.name]=b);
  const mats={
    body:new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...meta.skin).convertSRGBToLinear(), roughness:0.6}),
    robe:new THREE.MeshStandardMaterial({color:meta.cfg.robe, roughness:0.85, side:THREE.DoubleSide}),
    sash:new THREE.MeshStandardMaterial({color:meta.cfg.robe, roughness:0.9, side:THREE.DoubleSide}),
    hair:new THREE.MeshStandardMaterial({map:loadTex(data.tex.hair), color:new THREE.Color(meta.cfg.hair_tint), alphaTest:0.3, side:THREE.DoubleSide, roughness:0.8}),
    brows:new THREE.MeshStandardMaterial({map:loadTex(data.tex.brows), alphaTest:0.4, transparent:false, roughness:0.9}),
    eyes:new THREE.MeshStandardMaterial({map:loadTex(data.tex.eyes), color:0x8a8a8a, roughness:0.45}),
    // a hair-coloured cap on the scalp (linear rgb from the build), so the head doesn't look bald between hair strands
    scalp:new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...(meta.scalp||[0.05,0.04,0.03])), roughness:0.85}),
  };
  const meshes=[];
  meta.parts.forEach(p=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buf,p.pos[0],p.nv*3),3));
    const j8=new Uint8Array(buf,p.J[0],p.nv*4); g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(Uint16Array.from(j8),4));
    g.setAttribute('skinWeight',new THREE.BufferAttribute(new Uint8Array(buf,p.W[0],p.nv*4),4,true));
    // skirt morph targets: [0] flare, [1] [2] swing in x/z (1 m at the hem; older builds have no swing)
    if(p.morph){ g.morphAttributes.position=[new THREE.BufferAttribute(new Float32Array(buf,p.morph[0],p.nv*3),3)]; g.morphTargetsRelative=true;
      if(p.swing) [0,1].forEach(k=>g.morphAttributes.position.push(new THREE.BufferAttribute(new Float32Array(buf,p.swing[0]+k*p.nv*12,p.nv*3),3))); }
    if(p.uv) g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(buf,p.uv[0],p.nv*2),2));
    const idx=p.idx[1]==='uint16'?new Uint16Array(buf,p.idx[0],p.ni):new Uint32Array(buf,p.idx[0],p.ni);
    g.setIndex(new THREE.BufferAttribute(idx,1));
    g.computeVertexNormals();
    const m=new THREE.SkinnedMesh(g,mats[p.mat||p.name]); m.castShadow=true; m.receiveShadow=true; m.frustumCulled=false;
    if(p.morph){ m.updateMorphTargets(); m.morphTargetInfluences[0]=P.skirt; }
    group.add(m); m.bind(skeleton); meshes.push(m);
  });
  const rest={}; meta.bones.forEach(b=>rest[b.n]=new THREE.Vector3(...b.h));
  const robe=(meta.cfg.costume||'robe')==='robe';
  return {group,bones:byName,skeleton,mats,rest,meta,robeMesh:meshes.find((x,k)=>meta.parts[k].morph),sleeves:robe?['L','R'].map(()=>makeSleeve(mats.robe)):[]};
}

const dancers=[];
PEOPLE_DATA.forEach((data,k)=>{
  const i=dancers.length; const d=buildPerson(data,i); const c=data.meta.cfg;
  const sc=c.height/data.meta.height; d.group.scale.setScalar(sc);
  const sp=SPOT_POS[c.spot]||[0,0]; d.group.position.set(sp[0],0,sp[1]); scene.add(d.group); d.i=i; d.sc=sc;
  d.prevC=new THREE.Vector2(); d.robeMat=d.mats.robe; d.robeBase=new THREE.Color(c.robe); dancers.push(d);
});

