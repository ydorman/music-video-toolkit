"""Surface contact check of a built clip: skins every dancer's real body and clothing meshes (the vertices the renderer
draws, skirt morphs included) at a fixed rate and reports wherever two dancers' surfaces meet or pass into each other -
hand through hand, head into a chest, a leg through a leg, a skirt through a body. Unlike check_motion's capsules this
sees the whole body. Usage: check_contact.py <build dir> [--fps 10] [--t0 s] [--t1 s] [--gap 0.015] [--json out]

Each episode names the two dancers, the body parts that meet (hand, forearm, upper arm, head, torso, leg, foot,
clothing) and how many surface points touch (a graze is a few, a body through a body is hundreds).
"""
import asyncio, json, os, argparse
from collections import Counter
from playwright.async_api import async_playwright

ap=argparse.ArgumentParser(); ap.add_argument('build'); ap.add_argument('--fps',type=float,default=10)
ap.add_argument('--t0',type=float,default=None); ap.add_argument('--t1',type=float,default=None)
ap.add_argument('--gap',type=float,default=0.015,help='surfaces closer than this (m) count as touching')
ap.add_argument('--json',default=None); ap.add_argument('--quiet',action='store_true')
A=ap.parse_args()
VENDOR=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','vendor','js')

SAMPLE="""(([t0,t1,fps,gap])=>{
  renderer.render=()=>{};
  const GC=(a,k,c)=>c===0?a.getX(k):c===1?a.getY(k):c===2?a.getZ(k):a.getW(k);   // (older three has no getComponent)
  const REG=n=>/wrist|finger|metacarpal/.test(n)?'hand':/lowerarm/.test(n)?'forearm':/upperarm|shoulder|clavicle/.test(n)?'upper arm':
    /upperleg|lowerleg|pelvis/.test(n)?'leg':/foot|toe/.test(n)?'foot':/spine|breast|root/.test(n)?'torso':'head';
  // per dancer: its body and clothing meshes, every 2nd body vertex, every clothing vertex
  const S=dancers.map(d=>d.group.children.filter(m=>m.isSkinnedMesh&&(m.material===d.mats.body||m.material===d.mats.robe)).map(m=>{
    const g=m.geometry, cloth=m.material!==d.mats.body, step=cloth?1:2, n=g.attributes.position.count, idx=[];
    for(let k=0;k<n;k+=step) idx.push(k);
    const si=g.attributes.skinIndex, sw=g.attributes.skinWeight, reg=idx.map(k=>{ let b=0,w=-1; for(let c=0;c<4;c++){ const x=GC(sw,k,c); if(x>w){ w=x; b=GC(si,k,c); } }
      return cloth?(m.morphTargetInfluences?'skirt':'clothing'):REG(m.skeleton.bones[b].name); });
    return {m,idx,reg}; }));
  const v=new THREE.Vector3(), acc=new THREE.Vector3(), tmp=new THREE.Vector3(), BM=[];
  function points(i){ const d=dancers[i], P=[], R=[];
    S[i].forEach(({m,idx,reg})=>{ const g=m.geometry, pos=g.attributes.position, si=g.attributes.skinIndex, sw=g.attributes.skinWeight;
      const mp=g.morphAttributes.position, inf=m.morphTargetInfluences, sk=m.skeleton;
      for(let k=0;k<sk.bones.length;k++){ BM[k]=(BM[k]||new THREE.Matrix4()).multiplyMatrices(sk.bones[k].matrixWorld,sk.boneInverses[k]).multiply(m.bindMatrix); }
      const W=new THREE.Matrix4().multiplyMatrices(m.matrixWorld,m.bindMatrixInverse);
      idx.forEach((k,j)=>{ v.fromBufferAttribute(pos,k);
        if(mp&&inf) for(let q=0;q<mp.length;q++) if(inf[q]) v.addScaledVector(tmp.fromBufferAttribute(mp[q],k),inf[q]);
        acc.set(0,0,0); let ws=0; for(let c=0;c<4;c++){ const w=GC(sw,k,c); if(w>0){ acc.addScaledVector(tmp.copy(v).applyMatrix4(BM[GC(si,k,c)]),w); ws+=w; } } acc.multiplyScalar(1/ws);
        acc.applyMatrix4(W); P.push(acc.x,acc.y,acc.z); R.push(reg[j]); }); });
    return {P,R}; }
  const out=[], C=0.03, key=(x,y,z)=>x*73856093^y*19349663^z*83492791;
  const end=t1===null?F.duration:t1, start=t0===null?0:t0;
  for(let n=0,t=start;t<=end;n++,t=start+n/fps){
    __renderAt(t); scene.updateMatrixWorld(true);
    const vis=dancers.map(d=>d.group.visible), root=dancers.map(d=>d.bones.spine05.getWorldPosition(new THREE.Vector3())), pts={};
    for(let a=0;a<dancers.length;a++) for(let b=a+1;b<dancers.length;b++){
      if(!vis[a]||!vis[b]||Math.hypot(root[a].x-root[b].x,root[a].z-root[b].z)>2.4) continue;
      const A=pts[a]||(pts[a]=points(a)), B=pts[b]||(pts[b]=points(b)), H=new Map();
      for(let j=0;j<B.P.length;j+=3){ const h=key(Math.floor(B.P[j]/C),Math.floor(B.P[j+1]/C),Math.floor(B.P[j+2]/C)); let L=H.get(h); if(!L) H.set(h,L=[]); L.push(j); }
      const hits={}; let cnt=0;
      for(let j=0;j<A.P.length;j+=3){ const x=A.P[j],y=A.P[j+1],z=A.P[j+2], cx=Math.floor(x/C),cy=Math.floor(y/C),cz=Math.floor(z/C); let best=null, bd=gap*gap;
        for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++){ const L=H.get(key(cx+dx,cy+dy,cz+dz)); if(!L) continue;
          for(const q of L){ const ex=B.P[q]-x, ey=B.P[q+1]-y, ez=B.P[q+2]-z, dd=ex*ex+ey*ey+ez*ez; if(dd<bd){ bd=dd; best=q; } } }
        if(best!==null){ cnt++; const p=A.R[j/3]+' / '+B.R[best/3]; hits[p]=(hits[p]||0)+1; } }
      if(cnt) out.push({t, a:CFG[a].spot, b:CFG[b].spot, n:cnt, parts:hits}); } }
  return {hits:out, sections:SECTIONS.map(x=>[x.name, atTime(x.name)])};
})"""

async def sample():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':640,'height':360})
        await pg.route('https://cdn.jsdelivr.net/**',lambda r: r.fulfill(path=os.path.join(VENDOR,'three/build/three.min.js'),content_type='application/javascript'))
        await pg.route(lambda u:'fonts.g' in u,lambda r:r.abort())
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.join(os.path.abspath(A.build),'preview.html')); await pg.wait_for_timeout(2500)
        res=await pg.evaluate(SAMPLE,[A.t0,A.t1,A.fps,A.gap]); await b.close()
        if errs: print('page errors:',errs[:3])
        return res

def episodes(res):   # consecutive frames of the same pair merge into one episode
    secs=[s for s in res['sections'] if s[1] is not None]
    sec=lambda t: ([n for n,st in secs if st<=t] or ['?'])[-1]
    out=[]; gapt=1.5/A.fps
    for h in sorted(res['hits'],key=lambda h:(h['a'],h['b'],h['t'])):
        e=out[-1] if out else None
        if e and (e['a'],e['b'])==(h['a'],h['b']) and h['t']-e['t1']<=gapt:
            e['t1']=h['t']; e['frames']+=1; e['n']=max(e['n'],h['n']); e['parts'].update(h['parts'])
        else: out.append({'a':h['a'],'b':h['b'],'t':h['t'],'t1':h['t'],'frames':1,'n':h['n'],'parts':Counter(h['parts']),'section':sec(h['t'])})
    for e in out: e['parts']=dict(e['parts'])
    return out

res=asyncio.run(sample()); ep=episodes(res)
if A.json: json.dump(ep,open(A.json,'w'),indent=1)
print(f'{len(ep)} contact episodes (surfaces within {A.gap*100:.1f} cm), {sum(e["frames"] for e in ep)} frames at {A.fps:g} fps')
if not A.quiet:
    for e in sorted(ep,key=lambda e:e['t']):
        top=', '.join(f'{k} {v}' for k,v in sorted(e['parts'].items(),key=lambda kv:-kv[1])[:3])
        print(f"{e['t']:7.2f}-{e['t1']:7.2f} {e['section']:5s} {e['a']}-{e['b']}  up to {e['n']:4d} points  ({top})")
