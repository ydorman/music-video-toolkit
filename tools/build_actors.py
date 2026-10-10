#!/usr/bin/env python3
"""Build the actors of a clip from clips/<clip>/actors.csv using MakeHuman (makehuman-core).

Output: build/<clip>/actors/a<N>.json (meta: skeleton, parts, per-actor cfg) + a<N>.bin (geometry) + a<N>_<kind>.png
Each actor is a MakeHuman body + hair/eyebrows/eyes, skinned to the MakeHuman default skeleton,
plus a costume generated from MakeHuman's built-in fitting helpers. Only the 'robe' costume exists so far.

Usage: python tools/build_actors.py clips/<clip>
"""
import sys, os, json, csv, argparse
import numpy as np
from PIL import Image
try:
    import mhcore
except ImportError:
    sys.exit("makehuman-core is not installed. Run: bash tools/setup.sh")
D=mhcore.data_path
ap=argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--out',default=None); args=ap.parse_args()
CLIP=os.path.abspath(args.clip); NAME=os.path.basename(CLIP.rstrip('/'))
OUT=args.out or os.path.join(os.path.dirname(os.path.dirname(CLIP)),'build',NAME,'actors'); os.makedirs(OUT,exist_ok=True)
def hx(h): h=h.strip().lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def mh_age(y): return max(0.0,(y-1)/24*0.5) if y<25 else min(1.0,0.5+(y-25)/130)   # MakeHuman: 0.5 = 25 years, 1.0 = 90
PEOPLE=[]
for r in csv.DictReader(open(os.path.join(CLIP,'actors.csv'),encoding='utf-8-sig')):
    r={k.strip():(v.strip() if isinstance(v,str) else v) for k,v in r.items() if k}
    eth={'African':float(r['african']),'Asian':float(r['asian']),'Caucasian':float(r['caucasian'])}; tot=sum(eth.values()) or 1
    costume=(r.get('costume') or 'robe').lower()
    if costume!='robe': sys.exit(f"actor {r.get('actor')}: costume '{costume}' is not implemented yet (only 'robe')")
    PEOPLE.append(dict(g=1.0 if r['gender'].lower().startswith('m') else 0.0, age=mh_age(float(r['age'])), w=float(r['weight'])/100, m=float(r['muscle'])/100, ht=0.5,
        eth={k:v/tot for k,v in eth.items()}, hair=r['hair'], brow=r['eyebrows'], skin=hx(r['skin']),
        cfg=dict(spot=r['spot'], height=float(r['height_m']), hair_tint=r['hair_tint'], robe=r['costume_color'], lean=float(r['lean_deg']),
                 reach=float(r['reach']), offset=float(r['arm_offset_deg']), lag=float(r['sync_lag']), costume=costume)))
def top4(nv, data, bone_index):
    J=np.zeros((nv,8),np.int32); W=np.zeros((nv,8),np.float32); cnt=np.zeros(nv,np.int32)
    for b,(vi,ww) in data.items():
        bi=bone_index[b]
        for v,w in zip(vi,ww):
            c=cnt[v]
            if c<8: J[v,c]=bi; W[v,c]=w; cnt[v]+=1
    o=np.argsort(-W,axis=1)[:,:4]; J4=np.take_along_axis(J,o,1); W4=np.take_along_axis(W,o,1)
    s=W4.sum(1,keepdims=True); s[s==0]=1; return J4, W4/s
def vnormals(co,faces):
    n=np.zeros_like(co)
    for a,b,c in [(0,1,2),(2,3,0)]:
        fn=np.cross(co[faces[:,b]]-co[faces[:,a]],co[faces[:,c]]-co[faces[:,a]]); 
        for k in (a,b,c): np.add.at(n,faces[:,k],fn)
    l=np.linalg.norm(n,axis=1,keepdims=True); l[l==0]=1; return n/l
def tris(q): # quads -> tris (handles degenerate quads where v3==v2? fine)
    return np.concatenate([q[:,[0,1,2]],q[:,[2,3,0]]])
for pi,P in enumerate(PEOPLE):
    h=mhcore.new_human()
    h.set_gender(P['g']).set_age(P['age']).set_weight(P['w']).set_muscle(P['m']).set_height(P['ht'])
    for k,v in P['eth'].items(): h.apply_modifier('macrodetails/'+k, v)
    h.set_skeleton(D("rigs/default.mhskel"))
    h.equip_hair(D(f"hair/{P['hair']}/{P['hair']}.mhclo")); h.equip_eyebrows(D(f"eyebrows/{P['brow']}/{P['brow']}.mhclo"))
    h.equip_eyes(D("eyes/low-poly/low-poly.mhclo"))
    hu=h.human; m=hu.meshData; sk=hu.getSkeleton(); vw=sk.getVertexWeights()
    bones=sk.getBones(); bidx={b.name:i for i,b in enumerate(bones)}
    co=m.coord.astype(np.float64).copy()
    J,W=top4(len(co),vw.data,bidx)
    dom=np.array([bones[j].name for j in J[:,0]])
    # ground and units
    body_mask=m.getFaceMaskForGroups(['body']); bq=m.fvert[body_mask]
    ground=co[np.unique(bq),1].min()
    def tf(p): p=p.copy(); p[:,1]-=ground; return p*0.1
    N=vnormals(co,m.fvert)
    def has(names,keys): return np.array([any(k in n for k in keys) for n in names])
    # ---- visible body: head/neck, hands+forearm end, lower legs and feet
    # keep everything except what the robe hides (so no part of the face can go missing)
    vis=~has(dom,['spine','pelvis','root','clavicle','shoulder','upperarm','lowerarm01','upperleg','lowerleg','breast'])
    bf=bq[vis[bq].all(1)]
    # ---- costume 'robe': built from the tights helper (torso + arms) and the skirt helper (torso + arms) and the skirt helper
    tq=m.fvert[m.getFaceMaskForGroups(['helper-tights'])]
    keep_t=~has(dom,['head','neck','jaw','wrist','finger','metacarpal','thumb','foot','toe','lowerleg','upperleg','eye'])
    tq=tq[keep_t[tq].all(1)]
    sq=m.fvert[m.getFaceMaskForGroups(['helper-skirt'])]
    sv0=np.unique(sq); waist=co[sv0,1].max()-0.7
    tq=tq[(co[tq][:,:,1]>waist).all(1)]
    rc=co.copy()
    tv=np.unique(tq); sv=np.unique(sq)
    # loosen the torso: smooth away body detail (chest, waist), then let the cloth stand off the body
    torso=tv[has(dom[tv],['spine','breast','pelvis','clavicle','root','shoulder01'])]
    nb=[set() for _ in range(len(co))]
    for f in tq:
        for c in range(4): nb[f[c]].update((f[(c+1)%4],f[(c+3)%4]))
    for it in range(10):
        new=rc.copy()
        for v in torso:
            ns=list(nb[v]);
            if ns: new[v]=rc[v]*0.5+rc[ns].mean(0)*0.5
        rc=new
    rc[torso]+=N[torso]*0.38
    rest=np.setdiff1d(tv,torso); rc[rest]+=N[rest]*0.2
    # wide sleeves: push forearm verts away from the forearm axis, more toward the wrist
    for side in 'LR':
        a=np.array(sk.getBone('lowerarm01.'+side).headPos,float); b=np.array(sk.getBone('wrist.'+side).headPos,float)
        ax=(b-a); L=np.linalg.norm(ax); ax/=L
        arm=tv[np.isin(dom[tv],['lowerarm01.'+side,'lowerarm02.'+side])]
        t=np.clip(((co[arm]-a)@ax)/L,0,1)
        radial=co[arm]-a-np.outer((co[arm]-a)@ax,ax)
        rc[arm]=co[arm]+radial*(0.1+0.12*t[:,None])+N[arm]*0.12
        up=tv[np.isin(dom[tv],['upperarm01.'+side,'upperarm02.'+side])]
        rc[up]+=N[up]*0.1
    # skirt: lengthen to just above the feet and flare
    top=co[sv,1].max(); bot=co[sv,1].min(); hem=ground+0.55  # 5.5 cm above floor
    k=(hem-top)/(bot-top); t=(top-co[sv,1])/(top-bot)
    cx,cz=co[sv,0].mean(),co[sv,2].mean()
    rc[sv,1]=top+(co[sv,1]-top)*k
    # waist ellipse taken from the upper robe, so the skirt starts exactly where the upper robe ends
    tvv=np.unique(tq); ytop=rc[sv,1].max()
    nearw=tvv[(np.abs(rc[tvv,1]-ytop)<0.35)&(np.abs(rc[tvv,0]-cx)<2.6)]
    rxT=np.abs(rc[nearw,0]-cx).max()*1.02; rzT=np.abs(rc[nearw,2]-cz).max()*1.02
    th=np.arctan2(co[sv,2]-cz,(co[sv,0]-cx)*(rzT/rxT))
    tight=np.stack([cx+rxT*np.cos(th)*(1+0.2*t**0.8), rc[sv,1], cz+rzT*np.sin(th)*(1+0.22*t**0.8)],1)
    wide=np.stack([cx+rxT*np.cos(th)*(1+0.55*t**1.2), rc[sv,1], cz+rzT*np.sin(th)*(1+0.4*t**1.2)],1)
    rc[sv]=tight
    MORPH=np.zeros_like(rc); MORPH[sv]=wide-tight
    SASH=(cx,cz,rxT,rzT)
    # skirt weights: blend toward the pelvis so the hem doesn't split between the legs
    # ---- assemble mesh parts
    parts=[]
    def add_part(name,coords,qf,Jv,Wv,uv=None,morph=None):
        used=np.unique(qf); remap=-np.ones(len(coords),np.int64); remap[used]=np.arange(len(used))
        parts.append(dict(name=name,pos=tf(coords[used]).astype(np.float32),idx=remap[tris(qf)].astype(np.uint32),J=Jv[used].astype(np.uint8),W=Wv[used].astype(np.float32),uv=None if uv is None else uv[used].astype(np.float32),morph=None if morph is None else (morph[used]*0.1).astype(np.float32)))
    add_part('body',co,bf,J,W)
    JR,WR=J.copy(),W.copy()
    pel=bidx['spine05']
    for v in sv:
        t=(top-co[v,1])/(top-bot); a=0.92-0.5*t
        ws=dict(zip(JR[v],WR[v]*(1-a))); ws[pel]=ws.get(pel,0)+a
        it=sorted(ws.items(),key=lambda x:-x[1])[:4]; it+= [(0,0.0)]*(4-len(it))
        JR[v]=[x for x,_ in it]; s=sum(w for _,w in it); WR[v]=[w/s for _,w in it]
    add_part('robe',rc,np.concatenate([tq,sq]),JR,WR,morph=MORPH)
    # a soft sash at the waist where the upper robe meets the skirt
    ccx,ccz,rx,rz=SASH; rx*=1.03; rz*=1.05
    yw=rc[sv,1].max()-0.1; K=40; rings=[(yw+0.22,0.97),(yw+0.06,1.0),(yw-0.16,1.0),(yw-0.3,0.97)]
    sp=[]; 
    for y,f in rings:
        for k in range(K): th=k/K*2*np.pi; sp.append([ccx+np.cos(th)*rx*f, y, ccz+np.sin(th)*rz*f])
    sp=np.array(sp); sqd=[]
    for r in range(len(rings)-1):
        for k in range(K): a=r*K+k; b=r*K+(k+1)%K; sqd.append([a,b,b+K,a+K])
    sqd=np.array(sqd); SJ=np.zeros((len(sp),4),np.int32); SJ[:,0]=bidx['spine05']; SW=np.zeros((len(sp),4),np.float32); SW[:,0]=1
    add_part('sash',sp,sqd,SJ,SW)
    # proxies with UVs (unwelded per face corner)
    texs={}
    for obj,kind in [(hu.hairProxy,'hair'),(hu.eyebrowsProxy,'brows'),(hu.eyesProxy,'eyes')]:
        pobj=[x for x in hu.getProxyObjects() if x.proxy is obj][0]
        pm=pobj.mesh; pco=obj.getCoords().astype(np.float64)
        pw=obj.getVertexWeights(vw); PJ,PW=top4(len(pco),pw.data,bidx)
        fv=pm.fvert; fu=pm.fuvs
        corners={}; vlist=[]; uvl=[]; qf=np.zeros_like(fv)
        for fi in range(len(fv)):
            for c in range(4):
                key=(fv[fi,c],fu[fi,c])
                if key not in corners: corners[key]=len(vlist); vlist.append(fv[fi,c]); uvl.append(pm.texco[fu[fi,c]])
                qf[fi,c]=corners[key]
        vlist=np.array(vlist); uvl=np.array(uvl)
        add_part(kind,pco[vlist],qf,PJ[vlist],PW[vlist],uvl)
        tp=pobj.material.diffuseTexture
        im=Image.open(tp).convert('RGBA'); im.thumbnail((512 if kind=='hair' else 256,)*2); fn=f'a{pi}_{kind}.png'; im.save(os.path.join(OUT,fn),optimize=True); texs[kind]=fn
    # skeleton
    bl=[dict(n=b.name,p=(bidx[b.parent.name] if b.parent else -1),h=[float(x) for x in tf(np.array([b.headPos],float))[0]]) for b in bones]
    # binary pack
    blob=bytearray(); meta=dict(bones=bl,parts=[],skin=P['skin'],cfg=P['cfg'],textures=texs,hair=P['hair'],height=float(tf(co[np.unique(bq)])[:,1].max()))
    for p in parts:
        ent=dict(name=p['name'],nv=len(p['pos']),ni=int(p['idx'].size))
        for key,arr in [('pos',p['pos']),('morph',p.get('morph')),('J',p['J']),('W',(p['W']*255+0.5).astype(np.uint8)),('uv',p['uv']),('idx',p['idx'].astype(np.uint16) if len(p['pos'])<65536 else p['idx'])]:
            if arr is None: continue
            while len(blob)%4: blob.append(0)
            ent[key]=[len(blob),str(arr.dtype)]; blob+=arr.tobytes()
        meta['parts'].append(ent)
    open(os.path.join(OUT,f'a{pi}.bin'),'wb').write(blob); json.dump(meta,open(os.path.join(OUT,f'a{pi}.json'),'w'))
    print(pi, P['hair'], 'height %.2f'%meta['height'], [(p['name'],len(p['pos']),len(p['idx'])//3) for p in parts], len(blob)//1024,'KB')
