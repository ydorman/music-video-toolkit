#!/usr/bin/env python3
"""Headless check of a built clip (needs playwright + chromium; used in Claude's container, no GPU needed).

Renders a few preview frames to build/<clip>/smoke/*.png and reports page errors.
With --render, also renders a 1-second MP4 through the renderer page (VP9/Opus in headless Chromium;
real Chrome produces H.264/AAC).

Usage: python <toolkit>/tools/smoke_test.py clips/<clip> [--times 2 30 90] [--render 80] [--stills]
"""
import asyncio, os, sys, argparse
from playwright.async_api import async_playwright
ap=argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--times',nargs='*',type=float,default=[2,30,90])
ap.add_argument('--render',type=float,default=None)
ap.add_argument('--stills',action='store_true',help='also save the frames as JPGs in clips/<clip>/stills/ (reference for future sessions)')
args=ap.parse_args()
CLIP=os.path.abspath(args.clip); NAME=os.path.basename(CLIP.rstrip('/')); PROJECT=os.path.dirname(os.path.dirname(CLIP))
TOOLKIT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B=os.path.join(PROJECT,'build',NAME); V=os.path.join(TOOLKIT,'vendor','js'); os.makedirs(os.path.join(B,'smoke'),exist_ok=True)
FONTS=lambda u:'fonts.g' in u   # web fonts are not reachable from the container; don't wait for them
GL=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
async def route(r):
    u=r.request.url
    await r.fulfill(path=os.path.join(V,'three/build/three.min.js') if 'three' in u else os.path.join(V,'mp4-muxer/build/mp4-muxer.js'),content_type='application/javascript')
async def main():
    errs=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(args=GL)
        pg=await b.new_page(viewport={'width':1280,'height':1000}); pg.on('pageerror',lambda e:errs.append(str(e))); pg.set_default_timeout(120000)
        await pg.route('https://cdn.jsdelivr.net/**',route); await pg.route(FONTS,lambda r:r.abort())
        await pg.goto('file://'+os.path.join(B,'preview.html')); await pg.wait_for_timeout(3000)
        for t in args.times:
            await pg.evaluate(f"window.__renderAt({t})"); await pg.locator('#stage canvas').screenshot(path=os.path.join(B,'smoke',f'preview_{t:g}.png'))
            if args.stills:
                from PIL import Image
                os.makedirs(os.path.join(CLIP,'stills'),exist_ok=True)
                Image.open(os.path.join(B,'smoke',f'preview_{t:g}.png')).convert('RGB').save(os.path.join(CLIP,'stills',f't{int(round(t)):03d}s.jpg'),quality=88)
        if args.render is not None:
            ctx=await b.new_context(accept_downloads=True,viewport={'width':1200,'height':1000}); rp=await ctx.new_page(); rp.on('pageerror',lambda e:errs.append(str(e)))
            await rp.route('https://cdn.jsdelivr.net/**',route); await rp.route(FONTS,lambda r:r.abort())
            await rp.goto('file://'+os.path.join(B,'renderer.html')); await rp.wait_for_timeout(3000)
            m,s=divmod(args.render,60); m2,s2=divmod(args.render+1,60)
            await rp.select_option('#what','custom'); await rp.fill('#t0',f'{int(m)}:{s:04.1f}'); await rp.fill('#t1',f'{int(m2)}:{s2:04.1f}')
            async with rp.expect_download(timeout=900000) as dl: await rp.click('#go')
            d=await dl.value; await d.save_as(os.path.join(B,'smoke','render_test.mp4')); print('renderer:',await rp.inner_text('#status'))
        await b.close()
    print('page errors:',errs or 'none'); sys.exit(1 if errs else 0)
asyncio.run(main())
