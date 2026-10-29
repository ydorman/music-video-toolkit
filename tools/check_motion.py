"""Physical-plausibility check of a built clip: samples every dancer at a fixed rate over the whole clip (no rendering)
and reports what no real dancer could do. Usage: check_motion.py <build dir> [--fps 30] [--t0 s] [--t1 s] [--json out]

  airborne   nothing on the ground (feet, knees, hips, chest, hands all above the floor) - nobody jumps in these clips
  sink       part of the body pushed into the floor (floor work)
  skate      a foot standing on the ground (heel down) slides along it
  overreach  a leg asked to reach further than it is long (the foot comes off its target)
  spin       the body turns faster than 720 deg/s (two turns a second, a fast pirouette)
  snap       the turning direction reverses abruptly (turning left, then right a moment later)
  limb       a bone swings faster than a limb can move
  speed      the body travels faster than a lyrical walk / accelerates impossibly
  crowd      two dancers closer than their bodies allow
"""
import asyncio, json, math, os, sys, argparse
from playwright.async_api import async_playwright

ap=argparse.ArgumentParser(); ap.add_argument('build'); ap.add_argument('--fps',type=float,default=30)
ap.add_argument('--t0',type=float,default=None); ap.add_argument('--t1',type=float,default=None); ap.add_argument('--json',default=None)
ap.add_argument('--quiet',action='store_true')
A=ap.parse_args()
VENDOR=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'vendor','js')

SAMPLE="""(([t0,t1,fps])=>{
  renderer.render=()=>{};                   // geometry only
  const BONES=['upperarm01.L','upperarm01.R','lowerarm01.L','lowerarm01.R','upperleg01.L','upperleg01.R','lowerleg01.L','lowerleg01.R','spine02','head'];
  const v=new THREE.Vector3(), q=new THREE.Quaternion(), out=[];
  const end=t1===null?F.duration:t1, start=t0===null?0:t0;
  for(let n=0, t=start; t<=end; n++, t=start+n/fps){
    __renderAt(t); const fr={t, d:[]};
    dancers.forEach(d=>{ const r=d.rest, s=d.sc, o={};
      const lift=side=>{ const a=d.bones['foot.'+side].getWorldPosition(v).y-r['foot.'+side].y*s;
        const tt=d.bones['toe3-1.'+side].getWorldPosition(v).y-r['toe3-1.'+side].y*s; return Math.min(a,tt); };
      const pos=b=>{ d.bones[b].getWorldPosition(v); return [v.x,v.y,v.z]; };
      o.lift=[lift('L'),lift('R')]; o.heel=['L','R'].map(sd=>d.bones['foot.'+sd].getWorldPosition(v).y-r['foot.'+sd].y*s); o.foot=[pos('foot.L'),pos('foot.R')]; o.toe=[pos('toe3-1.L'),pos('toe3-1.R')];
      o.root=pos('spine05');
      // lowest points of the rest of the body (joint height minus roughly the flesh around it), for floor work
      o.body=[['lowerleg01.L',0.055],['lowerleg01.R',0.055],['spine05',0.1],['spine02',0.11],['head',0.08],['wrist.L',0.035],['wrist.R',0.035],['lowerarm01.L',0.045],['lowerarm01.R',0.045]]
        .map(([b,r])=>d.bones[b].getWorldPosition(v).y-r);
      const tm=timing(d.i,t,outroW(t)); o.yaw=tm.rot;
      o.q=BONES.map(b=>{ d.bones[b].getWorldQuaternion(q); return [q.x,q.y,q.z,q.w]; });
      o.reach=['L','R'].map(sd=>(d.ikMiss||{})[sd]||0);   // how far the IK target was out of the leg's reach (m)
      o.spot=CFG[d.i].spot; fr.d.push(o); });
    out.push(fr); }
  const S=SECTIONS.map(x=>[x.name, atTime(x.name)]);
  return {frames:out, sections:S};
})"""

async def sample():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':640,'height':360})
        await pg.route('https://cdn.jsdelivr.net/**',lambda r: r.fulfill(path=os.path.join(VENDOR,'three/build/three.min.js'),content_type='application/javascript'))
        await pg.route(lambda u:'fonts.g' in u,lambda r:r.abort())
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.join(os.path.abspath(A.build),'preview.html')); await pg.wait_for_timeout(2500)
        res=await pg.evaluate(SAMPLE,[A.t0,A.t1,A.fps]); await b.close()
        if errs: print('page errors:',errs[:3])
        return res

def qang(a,b):
    d=abs(sum(x*y for x,y in zip(a,b))); return 2*math.acos(min(1,d))

def check(res):
    F=res['frames']; dt=1/A.fps; issues=[]
    secs=[s for s in res['sections'] if s[1] is not None]
    def sec(t):
        n='?'
        for name,st in secs:
            if st<=t: n=name
        return n
    N=len(F[0]['d'])
    for i in range(N):
        spot=F[0]['d'][i]['spot']
        def add(kind,t,val,msg): issues.append({'kind':kind,'spot':spot,'t':round(t,2),'section':sec(t),'value':round(val,3),'msg':msg})
        for k in range(1,len(F)-1):
            a,b,c=F[k-1]['d'][i],F[k]['d'][i],F[k+1]['d'][i]; t=F[k]['t']
            low=min(min(b['lift']),min(b['body']))
            if low>0.025: add('airborne',t,low,f'nothing on the ground (lowest point {low*100:.0f} cm up)')
            sink=min(b['body'])
            if sink<-0.04: add('sink',t,sink,f'body {-sink*100:.0f} cm into the floor')
            for s in (0,1):
                if b['heel'][s]<0.012 and a['heel'][s]<0.012:   # heel down = weight on it (a pointed toe brushing the floor is a tendu)
                    sl=math.hypot(b['foot'][s][0]-a['foot'][s][0],b['foot'][s][2]-a['foot'][s][2])/dt
                    if sl>0.25: add('skate',t,sl,f'{"LR"[s]} foot slides {sl:.2f} m/s while on the ground')
                if b['reach'][s]>0.015: add('overreach',t,b['reach'][s],f'{"LR"[s]} foot {b["reach"][s]*100:.0f} cm short of where it should be (leg too short)')
            w=(b['yaw']-a['yaw'])/dt; w2=(c['yaw']-b['yaw'])/dt
            if abs(w)>math.radians(720): add('spin',t,math.degrees(w),f'turning {abs(math.degrees(w)):.0f} deg/s')
            if abs(w-w2)/dt>math.radians(3000): add('snap',t,math.degrees(w2-w)/dt,f'turn rate changes {math.degrees(abs(w2-w)):.0f} deg/s within one frame')
            v1=[(b['root'][j]-a['root'][j])/dt for j in (0,2)]; v2=[(c['root'][j]-b['root'][j])/dt for j in (0,2)]
            sp=math.hypot(*v1)
            if sp>1.6: add('speed',t,sp,f'body travels {sp:.2f} m/s')
            acc=math.hypot(v2[0]-v1[0],v2[1]-v1[1])/dt
            if acc>6: add('speed',t,acc,f'body accelerates {acc:.1f} m/s2')
            for j,(qa,qb) in enumerate(zip(a['q'],b['q'])):
                om=math.degrees(qang(qa,qb))/dt
                if om>540: add('limb',t,om,f'bone {j} swings {om:.0f} deg/s')
            for j in range(i+1,N):
                o=F[k]['d'][j]; dd=math.hypot(b['root'][0]-o['root'][0],b['root'][2]-o['root'][2])
                if dd<0.5: add('crowd',t,dd,f'{dd:.2f} m from {o["spot"]}')
    return issues

def runs(issues):  # merge consecutive frames of the same kind into episodes
    out=[]; key=lambda x:(x['spot'],x['kind'])
    for x in sorted(issues,key=lambda x:(x['spot'],x['kind'],x['t'])):
        if out and key(out[-1])==key(x) and x['t']-out[-1]['t1']<=0.25:
            e=out[-1]; e['t1']=x['t']; e['n']+=1
            if abs(x['value'])>abs(e['value']): e['value']=x['value']; e['msg']=x['msg']
        else: out.append(dict(x,t1=x['t'],n=1))
    return out

res=asyncio.run(sample()); ep=runs(check(res))
if A.json: json.dump(ep,open(A.json,'w'),indent=1)
from collections import Counter
print(f'{len(res["frames"])} frames x {len(res["frames"][0]["d"])} dancers; {len(ep)} episodes:', dict(Counter(e['kind'] for e in ep)))
if not A.quiet:
    for e in sorted(ep,key=lambda e:e['t']): print(f"{e['t']:7.2f}-{e['t1']:7.2f} {e['section']:5s} {e['spot']:3s} {e['kind']:9s} {e['msg']}")
