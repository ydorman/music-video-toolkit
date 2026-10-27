#!/usr/bin/env python3
"""Build the actors of a clip from clips/<clip>/actors.csv using MakeHuman (makehuman-core).

Output: build/<clip>/actors/a<N>.json (meta: skeleton, parts, per-actor cfg) + a<N>.bin (geometry) + a<N>_<kind>.png
Each actor is a MakeHuman body + hair/eyebrows/eyes, skinned to the MakeHuman default skeleton,
plus a costume generated from MakeHuman's built-in fitting helpers: 'robe' (clip 05), 'trousers' (straight, relaxed,
below the knee, bare chest, sash at the waist) or 'dress' (light slip dress: fitted bodice, thin straps, sash at the
natural waist, skirt grown from the hips to above the knee). The sash carries the actor's sash colour (actors.csv sash_color).
Skirts (robe, dress) carry morph targets: flare, and a swing in x/z that the engine drives from the movement.

Usage (from the project repo): python3 toolkit/tools/build_actors.py clips/<clip>
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
COSTUMES=('robe','trousers','dress')
PEOPLE=[]
for r in csv.DictReader(open(os.path.join(CLIP,'actors.csv'),encoding='utf-8-sig')):
    r={k.strip():(v.strip() if isinstance(v,str) else v) for k,v in r.items() if k}
    eth={'African':float(r['african']),'Asian':float(r['asian']),'Caucasian':float(r['caucasian'])}; tot=sum(eth.values()) or 1
    costume=(r.get('costume') or 'robe').lower()
    if costume not in COSTUMES: sys.exit(f"actor {r.get('actor')}: costume '{costume}' is not implemented (available: {', '.join(COSTUMES)})")
    PEOPLE.append(dict(g=1.0 if r['gender'].lower().startswith('m') else 0.0, age=mh_age(float(r['age'])), w=float(r['weight'])/100, m=float(r['muscle'])/100, ht=0.5,
        eth={k:v/tot for k,v in eth.items()}, hair=r['hair'], brow=r['eyebrows'], skin=hx(r['skin']),
        cfg=dict(spot=r['spot'], height=float(r['height_m']), hair_tint=r['hair_tint'], robe=r['costume_color'], lean=float(r['lean_deg']),
                 reach=float(r['reach']), offset=float(r['arm_offset_deg']), lag=float(r['sync_lag']), costume=costume, sash=(r.get('sash_color') or '').strip())))
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
    costume=P['cfg']['costume']
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
    by=lambda n: sk.getBone(n).headPos[1]; bp=lambda n: np.array(sk.getBone(n).headPos,float)
    TORSO=['spine','breast','pelvis','root']
    tq_all=m.fvert[m.getFaceMaskForGroups(['helper-tights'])]
    sq=m.fvert[m.getFaceMaskForGroups(['helper-skirt'])]
    def faces(q,bones,ylo,yhi):            # helper faces dominated by these bones that reach into [ylo,yhi] (clamp to the range for clean edges)
        y=co[q][:,:,1]; return q[has(dom,bones)[q].all(1)&(y.max(1)>=ylo)&(y.min(1)<=yhi)]
    def smooth(rc,q,verts,iters):          # smooth away body detail (chest, buttocks, waist) so the cloth bridges it
        nb=[set() for _ in range(len(co))]
        for f in q:
            for c in range(4): nb[f[c]].update((f[(c+1)%4],f[(c+3)%4]))
        for it in range(iters):
            new=rc.copy()
            for v in verts:
                ns=list(nb[v])
                if ns: new[v]=rc[v]*0.5+rc[ns].mean(0)*0.5
            rc=new
        return rc
    def skirt(rc,ring,hem,tight=(0.2,0.22,0.8),wide=(0.55,0.4,1.2)):
        """Lengthen the skirt helper to the hem and shape it, starting from the waist ellipse of the garment above (ring verts).
        Returns its verts, the waist ellipse, and morph targets: flare (to the 'wide' shape) and swing x/z (1 m at the hem)."""
        sv=np.unique(sq); top=co[sv,1].max(); bot=co[sv,1].min()
        k=(hem-top)/(bot-top); t=(top-co[sv,1])/(top-bot)
        cx,cz=co[sv,0].mean(),co[sv,2].mean()
        rc[sv,1]=top+(co[sv,1]-top)*k
        # waist ellipse taken from the garment above, so the skirt starts exactly where it ends
        ytop=rc[sv,1].max()
        nearw=ring[(np.abs(rc[ring,1]-ytop)<0.35)&(np.abs(rc[ring,0]-cx)<2.6)]
        rxT=np.abs(rc[nearw,0]-cx).max()*1.02; rzT=np.abs(rc[nearw,2]-cz).max()*1.02
        th=np.arctan2(co[sv,2]-cz,(co[sv,0]-cx)*(rzT/rxT))
        shape=lambda s: np.stack([cx+rxT*np.cos(th)*(1+s[0]*t**s[2]), rc[sv,1], cz+rzT*np.sin(th)*(1+s[1]*t**s[2])],1)
        T,Wd=shape(tight),shape(wide)
        rc[sv]=T
        flare=np.zeros_like(rc); flare[sv]=Wd-T
        swx=np.zeros_like(rc); swx[sv,0]=10*t**2; swz=np.zeros_like(rc); swz[sv,2]=10*t**2
        return sv,(cx,cz,rxT,rzT),[flare,swx,swz]
    def skirt_weights(JR,WR,sv):           # blend toward the pelvis so the hem doesn't split between the legs
        top=co[sv,1].max(); bot=co[sv,1].min(); pel=bidx['spine05']
        for v in sv:
            t=(top-co[v,1])/(top-bot); a=0.92-0.5*t
            ws=dict(zip(JR[v],WR[v]*(1-a))); ws[pel]=ws.get(pel,0)+a
            it=sorted(ws.items(),key=lambda x:-x[1])[:4]; it+= [(0,0.0)]*(4-len(it))
            JR[v]=[x for x,_ in it]; s=sum(w for _,w in it); WR[v]=[w/s for _,w in it]
    def band(ell,yw,s=1.0,K=40):           # a soft band around the waist (sash, waistband, waist seam); s scales its height
        ccx,ccz,rx,rz=ell; rx*=1.03; rz*=1.05
        rings=[(yw+0.22*s,0.97),(yw+0.06*s,1.0),(yw-0.16*s,1.0),(yw-0.3*s,0.97)]
        sp=np.array([[ccx+np.cos(k/K*2*np.pi)*rx*f, y, ccz+np.sin(k/K*2*np.pi)*rz*f] for y,f in rings for k in range(K)])
        sqd=np.array([[r*K+k,r*K+(k+1)%K,r*K+(k+1)%K+K,r*K+k+K] for r in range(len(rings)-1) for k in range(K)])
        SJ=np.zeros((len(sp),4),np.int32); SJ[:,0]=bidx['spine05']; SW=np.zeros((len(sp),4),np.float32); SW[:,0]=1
        return sp,sqd,SJ,SW
    BODY_V=np.unique(bq)
    def nearest_weights(pts):              # skin weights of the nearest body vertex (for generated cloth)
        nv=BODY_V[np.argmin(((pts[:,None,:]-co[BODY_V][None,:,:])**2).sum(2),axis=1)]; return J[nv].copy(),W[nv].copy()
    def blend_pelvis(Jv,Wv,amount):        # move part of each vertex's weight onto the pelvis (skirts: the hem doesn't split between the legs)
        pel=bidx['spine05']
        for v in range(len(Jv)):
            ws=dict(zip(Jv[v],Wv[v]*(1-amount[v]))); ws[pel]=ws.get(pel,0)+amount[v]
            it=sorted(ws.items(),key=lambda x:-x[1])[:4]; it+= [(0,0.0)]*(4-len(it))
            Jv[v]=[x for x,_ in it]; s_=sum(w for _,w in it); Wv[v]=[w/s_ for _,w in it]
    def profile(rc,verts,y,K=48,dy=0.25,c=None):  # cross-section at height y: centre (or c), and radius per angle (smoothed envelope)
        e=verts[np.abs(rc[verts,1]-y)<dy]; cx,cz=c if c is not None else (rc[e,0].mean(),rc[e,2].mean())
        ang=np.arctan2(rc[e,2]-cz,rc[e,0]-cx); r=np.hypot(rc[e,0]-cx,rc[e,2]-cz)
        bins=((ang+np.pi)/(2*np.pi)*K).astype(int)%K; R=np.full(K,np.nan)
        for k in range(K):
            if (bins==k).any(): R[k]=r[bins==k].max()
        idx=np.arange(K); ok=~np.isnan(R); R=np.interp(idx,idx[ok],R[ok],period=K)
        R=np.max([np.roll(R,k) for k in (-2,-1,0,1,2)],0)                      # envelope, so the cloth stays outside
        R=np.convolve(np.concatenate([R[-4:],R,R[:4]]),np.ones(9)/9,'valid')    # then smooth
        return cx,cz,(idx+0.5)/K*2*np.pi-np.pi,R
    def sash_fit(prof,yw,h):               # a soft sash of height h hugging a garment's cross-section (the colour carrier)
        cx,cz,th,R=prof; K=len(th)
        rings=[(yw+h/2,0.02),(yw+h*0.3,0.06),(yw-h*0.3,0.06),(yw-h/2,0.02)]
        sp=np.array([[cx+np.cos(a)*(r+o), y, cz+np.sin(a)*(r+o)] for y,o in rings for a,r in zip(th,R)])
        sqd=np.array([[r*K+k,r*K+(k+1)%K,(r+1)*K+(k+1)%K,(r+1)*K+k] for r in range(len(rings)-1) for k in range(K)])
        return (sp,sqd,*nearest_weights(sp))
    parts=[]
    def add_part(name,coords,qf,Jv,Wv,uv=None,morphs=None,mat=None):
        used=np.unique(qf); remap=-np.ones(len(coords),np.int64); remap[used]=np.arange(len(used))
        parts.append(dict(name=name,mat=mat or name,pos=tf(coords[used]).astype(np.float32),idx=remap[tris(qf)].astype(np.uint32),J=Jv[used].astype(np.uint8),W=Wv[used].astype(np.float32),uv=None if uv is None else uv[used].astype(np.float32),
                          morph=None if morphs is None else (morphs[0][used]*0.1).astype(np.float32),
                          swing=None if morphs is None else (np.concatenate([morphs[1][used],morphs[2][used]])*0.1).astype(np.float32)))
    rc=co.copy(); JR,WR=J.copy(),W.copy()
    if costume=='robe':
        # ---- built from the tights helper (torso + arms) and the skirt helper
        # visible body: head/neck, hands+forearm end, lower legs and feet (everything except what the robe hides, so no part of the face can go missing)
        vis=~has(dom,['spine','pelvis','root','clavicle','shoulder','upperarm','lowerarm01','upperleg','lowerleg','breast'])
        tq=tq_all[(~has(dom,['head','neck','jaw','wrist','finger','metacarpal','thumb','foot','toe','lowerleg','upperleg','eye']))[tq_all].all(1)]
        waist=co[np.unique(sq),1].max()-0.7
        tq=tq[(co[tq][:,:,1]>waist).all(1)]
        tv=np.unique(tq)
        # loosen the torso: smooth away body detail, then let the cloth stand off the body
        torso=tv[has(dom[tv],['spine','breast','pelvis','clavicle','root','shoulder01'])]
        rc=smooth(rc,tq,torso,10)
        rc[torso]+=N[torso]*0.38
        rest=np.setdiff1d(tv,torso); rc[rest]+=N[rest]*0.2
        # wide sleeves: push forearm verts away from the forearm axis, more toward the wrist
        for side in 'LR':
            a=bp('lowerarm01.'+side); b=bp('wrist.'+side)
            ax=(b-a); L=np.linalg.norm(ax); ax/=L
            arm=tv[np.isin(dom[tv],['lowerarm01.'+side,'lowerarm02.'+side])]
            t=np.clip(((co[arm]-a)@ax)/L,0,1)
            radial=co[arm]-a-np.outer((co[arm]-a)@ax,ax)
            rc[arm]=co[arm]+radial*(0.1+0.12*t[:,None])+N[arm]*0.12
            up=tv[np.isin(dom[tv],['upperarm01.'+side,'upperarm02.'+side])]
            rc[up]+=N[up]*0.1
        # skirt: lengthen to just above the feet (5.5 cm) and flare
        sv,ell,morphs=skirt(rc,tv,ground+0.55)
        skirt_weights(JR,WR,sv)
        garment=[('robe',rc,np.concatenate([tq,sq]),JR,WR,morphs,'robe')]
        # a soft sash at the waist where the upper robe meets the skirt
        garment.append(('sash',*band(ell,rc[sv,1].max()-0.1),None,'sash'))
    elif costume=='trousers':
        # ---- straight, relaxed trousers from the tights helper (hips + legs), ending below the knee; bare chest; a fitted sash at the waist
        waist=by('spine05')+0.6*(by('spine04')-by('spine05'))    # just below the navel
        knee,ank=by('lowerleg01.L'),by('foot.L')
        hem=ank+0.55*(knee-ank)                                   # below the knee, well above the ankle
        LEGS=TORSO+['upperleg','lowerleg']
        lq=faces(tq_all,LEGS,hem,waist); lv=np.unique(lq)
        # hide the body only where the trousers hug it (hips, thighs); the shins stay visible inside the open legs
        vis=~(has(dom,LEGS)&(co[:,1]<waist-0.3)&(co[:,1]>knee-0.3))
        rc[lv,1]=np.clip(rc[lv,1],hem,waist)
        rc=smooth(rc,lq,lv,4)
        hips=lv[has(dom[lv],TORSO+['upperleg01'])]
        rc=smooth(rc,lq,hips,10)
        rc[lv[co[lv,1]>=waist],1]=waist      # smoothing drags the top edge down; keep it on the waist line
        rc[lv]+=N[lv]*0.2                    # one even ease all over, so hips and legs read as one garment
        for side in 'LR':
            # straight legs: below the crotch each leg keeps the cross-section it has at the top of the thigh, tapering a little
            a=bp('upperleg01.'+side); b=bp('foot.'+side); ax=b-a; L=np.linalg.norm(ax); ax/=L
            u=np.array([1.0,0,0])-ax*ax[0]; u/=np.linalg.norm(u); w=np.cross(ax,u)
            leg=lv[has(dom[lv],['upperleg01.'+side,'upperleg02.'+side,'lowerleg01.'+side,'lowerleg02.'+side])]
            d=rc[leg]-a; t=(d@ax)/L; radial=d-np.outer(t*L,ax); r=np.linalg.norm(radial,axis=1)
            ang=np.arctan2(radial@w,radial@u); K=24; bins=((ang+np.pi)/(2*np.pi)*K).astype(int)%K
            ref=(t>0.28)&(t<0.36); Rref=np.full(K,np.nan)
            for k in range(K):
                sel=ref&(bins==k)
                if sel.any(): Rref[k]=r[sel].max()
            idx=np.arange(K); ok=~np.isnan(Rref); Rref=np.interp(idx,idx[ok],Rref[ok],period=K)
            Rref=np.convolve(np.concatenate([Rref[-1:],Rref,Rref[:1]]),np.ones(3)/3,'valid')
            T=Rref[bins]*(1-0.3*np.clip((t-0.32)/0.5,0,1))
            blend=np.clip((t-0.26)/0.08,0,1)
            R=np.where(t>0.26,np.maximum(r,r+(T-r)*blend),r)
            rc[leg]=a+np.outer(t*L,ax)+radial*(R/np.maximum(r,1e-6))[:,None]
        rc[lv,1]=np.clip(rc[lv,1],hem,waist)
        garment=[('trousers',rc,lq,JR,WR,None,'robe'),('sash',*sash_fit(profile(rc,lv,waist-0.12),waist-0.12,0.42),None,'sash')]
    elif costume=='dress':
        # ---- light slip dress: fitted bodice to the hips (tights helper) with thin straps, a skirt grown from the bodice's hip outline
        # (one piece, no ridge) ending above the knee, and a narrow sash at the natural waist
        ytop=by('breast.L')+0.4*(by('clavicle.L')-by('breast.L'))   # straight neckline just above the bust
        yw=by('spine03')                                           # natural waist: sash, and where the skirt starts
        hip=by('upperleg01.L'); knee=by('lowerleg01.L')
        hem=knee+0.6                                               # about 6 cm above the knee
        ybot=yw-0.3                                                # the bodice ends under the sash
        bq_=faces(tq_all,TORSO+['clavicle','shoulder'],ybot,ytop); bv=np.unique(bq_)
        vis=~(has(dom,TORSO)&(co[:,1]<ytop-1.5))       # visible down into the neckline; the thighs stay visible under the open skirt
        rc[bv,1]=np.clip(rc[bv,1],ybot,ytop)
        rc=smooth(rc,bq_,bv,2)
        # bridge the cleavage: the centre front strip of the bust gets more smoothing so the neckline doesn't dip
        mid=bv[(np.abs(co[bv,0])<0.7)&(co[bv,1]>ytop-1.6)&(co[bv,2]>co[bv,2].mean())]
        rc=smooth(rc,bq_,mid,8)
        rc[bv]+=N[bv]*0.1
        rc[bv,1]=np.clip(rc[bv,1],ybot,ytop)
        garment=[('dress',rc,bq_,JR,WR,None,'robe')]
        # skirt: rings from the waist (under the sash) to the hem; each ring clears the body below the waist (hips, seat,
        # thighs), never narrows going down, and flares a little below the hips: one piece that falls from the hips
        cx,cz,th,R0=profile(rc,bv,yw+0.05)
        hipzone=BODY_V[has(dom[BODY_V],TORSO+['upperleg'])&(np.abs(co[BODY_V,0]-cx)<2.6)]
        NR=16; ys=np.linspace(yw,hem,NR); R=R0.copy(); rings=[(yw+0.25,0.0,R0*0.97)]
        for y in ys:
            if (np.abs(co[hipzone,1]-y)<0.2).any(): R=np.maximum(R,profile(co,hipzone,y,dy=0.2,c=(cx,cz))[3]+0.12)
            th_=max(0.0,(hip-y)/(hip-hem)); rings.append((y,th_,R*(1+0.18*th_**1.2)))
        kp=np.array([[cx+np.cos(a)*r, y, cz+np.sin(a)*r] for y,_,Rr in rings for a,r in zip(th,Rr)])
        tv_=np.repeat([t for _,t,_ in rings],len(th))               # 0 above the hips .. 1 at the hem
        radial=kp-np.array([cx,0,cz]); radial[:,1]=0
        flare=radial*((0.45*tv_**1.2)/(1+0.18*tv_**1.2))[:,None]
        swx=np.zeros_like(kp); swx[:,0]=10*tv_**2; swz=np.zeros_like(kp); swz[:,2]=10*tv_**2
        K=len(th); kq=np.array([[r*K+k,r*K+(k+1)%K,(r+1)*K+(k+1)%K,(r+1)*K+k] for r in range(len(rings)-1) for k in range(K)])
        tw=np.repeat([(yw-y)/(yw-hem) for y,_,_ in rings],len(th)).clip(0,1)
        KJ,KW=nearest_weights(kp); blend_pelvis(KJ,KW,0.92-0.5*tw)
        garment.append(('skirt',kp,kq,KJ,KW,[flare,swx,swz],'robe'))
        # straps: a thin ribbon over each shoulder, from the front of the neckline to the back, resting on the body
        body_v=np.unique(bq); stp=[]; sqs=[]; ns=21; w=0.07
        for sgn in (1,-1):
            xs=sgn*0.5*(abs(bp('clavicle.L')[0])+abs(bp('shoulder01.L')[0]))
            top_e=bv[(np.abs(rc[bv,1]-ytop)<0.05)&(np.abs(rc[bv,0]-xs)<0.3)]
            zf,zb=rc[top_e,2].max(),rc[top_e,2].min(); zc=(zf+zb)/2
            near=body_v[(np.abs(co[body_v,0]-xs)<0.15)&(co[body_v,1]>ytop-0.1)&has(dom[body_v],['spine','breast','clavicle','shoulder'])]
            dz,dy=co[near,2]-zc,co[near,1]-ytop; phi=np.arctan2(dy,dz); rr=np.hypot(dz,dy)
            ths=np.linspace(0,np.pi,ns); Rs=[]
            for a in ths:
                sel=np.abs(phi-a)<0.12; Rs.append(rr[sel].max()+0.06 if sel.any() else np.nan)
            Rs=np.array(Rs); Rs[0],Rs[-1]=zf-zc,zc-zb; Rs=np.interp(ths,ths[~np.isnan(Rs)],Rs[~np.isnan(Rs)])
            Rs=np.convolve(np.pad(Rs,1,mode='edge'),[1/3]*3,'valid')
            base=len(stp)
            for a,r in zip(ths,Rs):
                y=ytop-0.08+np.sin(a)*r; z=zc+np.cos(a)*r
                stp+= [[xs-w,y,z],[xs+w,y,z]]
            sqs+= [[base+2*i,base+2*i+1,base+2*i+3,base+2*i+2] for i in range(ns-1)]
        stp=np.array(stp); sqs=np.array(sqs)
        garment.append(('straps',stp,sqs,*nearest_weights(stp),None,'robe'))
        garment.append(('sash',*sash_fit(profile(kp,np.arange(K,2*K),yw,dy=0.05,c=(cx,cz)),yw,0.32),None,'sash'))
    # ---- assemble mesh parts
    add_part('body',co,bq[vis[bq].all(1)],J,W)
    for name,coords,qf,Jv,Wv,morphs,mat in garment: add_part(name,coords,qf,Jv,Wv,morphs=morphs,mat=mat)
    # proxies with UVs (unwelded per face corner)
    texs={}
    scalp_rgb=None
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
        if kind=='hair':
            # scalp cap: hair cards are see-through between strands, so from above the scalp shows as bare skin.
            # Body faces covered by hair (hair lies along the vertex normal, above the eyes) get a hair-coloured cap.
            eye_top=hu.eyesProxy.getCoords()[:,1].max()
            head=BODY_V[has(dom[BODY_V],['head'])&(co[BODY_V,1]>eye_top+0.25)]
            d=pco[None,:,:]-co[head][:,None,:]; along=(d*N[head][:,None,:]).sum(2)
            perp=np.sqrt(np.maximum((d**2).sum(2)-along**2,0))
            covered=np.zeros(len(co),bool); covered[head[((along>-0.1)&(along<2.5)&(perp<0.35)).any(1)]]=True
            cap=bq[covered[bq].all(1)]
            if len(cap):
                px=np.asarray(Image.open(tp).convert('RGBA'),np.float64)/255; px=px[px[:,:,3]>0.5][:,:3]
                lin=lambda c: np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
                scalp_rgb=(lin(px).mean(0)*lin(np.array(hx(P['cfg']['hair_tint'])))*0.75).tolist()
                add_part('scalp',co+N*0.04,cap,J,W,mat='scalp')
    # skeleton
    bl=[dict(n=b.name,p=(bidx[b.parent.name] if b.parent else -1),h=[float(x) for x in tf(np.array([b.headPos],float))[0]]) for b in bones]
    # binary pack
    blob=bytearray(); meta=dict(bones=bl,parts=[],skin=P['skin'],cfg=P['cfg'],textures=texs,scalp=scalp_rgb,hair=P['hair'],height=float(tf(co[np.unique(bq)])[:,1].max()))
    for p in parts:
        ent=dict(name=p['name'],mat=p['mat'],nv=len(p['pos']),ni=int(p['idx'].size))
        for key,arr in [('pos',p['pos']),('morph',p.get('morph')),('swing',p.get('swing')),('J',p['J']),('W',(p['W']*255+0.5).astype(np.uint8)),('uv',p['uv']),('idx',p['idx'].astype(np.uint16) if len(p['pos'])<65536 else p['idx'])]:
            if arr is None: continue
            while len(blob)%4: blob.append(0)
            ent[key]=[len(blob),str(arr.dtype)]; blob+=arr.tobytes()
        meta['parts'].append(ent)
    open(os.path.join(OUT,f'a{pi}.bin'),'wb').write(blob); json.dump(meta,open(os.path.join(OUT,f'a{pi}.json'),'w'))
    print(pi, P['hair'], 'height %.2f'%meta['height'], [(p['name'],len(p['pos']),len(p['idx'])//3) for p in parts], len(blob)//1024,'KB')
