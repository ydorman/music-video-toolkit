#!/usr/bin/env python3
"""Assemble a clip's preview page and renderer page from the engine + the clip's data.

Inputs:  clips/<clip>/{track.json, choreography.json, look.json}, build/<clip>/features.json, build/<clip>/actors/*
Outputs (in the project repo): build/<clip>/preview.html   (publishable artifact, < 16 MB, compressed audio)
         build/<clip>/renderer.html  (open locally in Chrome to render MP4s)

Usage (from the project repo): python3 toolkit/tools/build_pages.py clips/<clip> [--look path/to/look.json]
"""
import sys, os, json, base64, glob, subprocess, argparse, tempfile
ap=argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--look',default=None)
ap.add_argument('--preview-kbps',type=int,default=128); ap.add_argument('--renderer-kbps',type=int,default=192); args=ap.parse_args()
CLIP=os.path.abspath(args.clip); NAME=os.path.basename(CLIP.rstrip('/'))
TOOLKIT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT=os.path.dirname(os.path.dirname(CLIP))   # the project repo: <project>/clips/<clip>
B=os.path.join(PROJECT,'build',NAME); E=os.path.join(TOOLKIT,'engine'); SH=os.path.join(TOOLKIT,'shells')
J=lambda p: json.load(open(p))
track=J(os.path.join(CLIP,'track.json')); choreo=J(os.path.join(CLIP,'choreography.json'))
lookp=args.look or os.path.join(CLIP,'look.json'); look=J(lookp) if os.path.exists(lookp) else {}
feat=J(os.path.join(B,'features.json'))
track.setdefault('snippets',[]); track.setdefault('slug',NAME)
def uri(p): return 'data:image/png;base64,'+base64.b64encode(open(p,'rb').read()).decode()
people=[]
for jp in sorted(glob.glob(os.path.join(B,'actors','a*.json')),key=lambda p:int(os.path.basename(p)[1:-5])):
    m=J(jp); d=os.path.dirname(jp)
    people.append(dict(meta=m,bin=base64.b64encode(open(jp[:-5]+'.bin','rb').read()).decode(),tex={k:uri(os.path.join(d,v)) for k,v in m['textures'].items()}))
if not people: sys.exit('no actors built: run tools/build_actors.py first')
def mp3(kbps):
    out=os.path.join(tempfile.gettempdir(),f'{NAME}_{kbps}.mp3')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',os.path.join(CLIP,track['audio']),'-b:a',f'{kbps}k',out],check=True)
    return base64.b64encode(open(out,'rb').read()).decode()
eng=lambda *fs: '\n'.join(open(os.path.join(E,f)).read() for f in fs)
data=lambda: ('const TRACK='+json.dumps(track)+';\nconst CHOREO='+json.dumps(choreo)+';\nconst LOOK='+json.dumps(look)+';\nconst F='+json.dumps(feat,separators=(',',':'))+
              ';\nconst PEOPLE_DATA='+json.dumps(people,separators=(',',':'))+';\n')
sub=f"{track.get('meter','')} · pulse {track.get('pulse_bpm','')} bpm · {len(people)} actors"
# preview
js=data()+eng('core.js','stage.js','actors.js','motion.js','preview.js')
h=open(os.path.join(SH,'preview.html')).read().replace('__TITLE__',track['title']).replace('__SUBTITLE__',sub).replace('__JS__',js).replace('__AUDIO__','data:audio/mpeg;base64,'+mp3(args.preview_kbps))
open(os.path.join(B,'preview.html'),'w').write(h); print('preview.html  %.1f MB'%(len(h)/1e6))
if len(h)>16e6: print('WARNING: preview is over 16 MB, too big to publish; lower --preview-kbps')
# renderer
js=data()+'const EMBED_AUDIO="'+mp3(args.renderer_kbps)+'";\n'+eng('core.js','stage.js','actors.js','motion.js','render.js')
h=open(os.path.join(SH,'renderer.html')).read().replace('__JS__',js)
open(os.path.join(B,'renderer.html'),'w').write(h); print('renderer.html %.1f MB'%(len(h)/1e6))
