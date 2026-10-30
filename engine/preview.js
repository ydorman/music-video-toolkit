// ---------- transport
const playBtn=document.getElementById('play'), scrub=document.getElementById('scrub'), timeEl=document.getElementById('time');
let dragging=false;
playBtn.onclick=()=>{ if(au.paused) au.play(); else au.pause(); };
au.onplay=()=>playBtn.textContent='Pause'; au.onpause=()=>playBtn.textContent='Play';
// frame by frame: pause, then step 1/30 s (the frame rate check_motion samples at); shift steps a second
const FRAME=1/30;
function step(n){ au.pause(); const t=Math.round((au.currentTime||0)/FRAME+n)*FRAME; au.currentTime=clamp(t,0,F.duration); }
document.getElementById('stepBack').onclick=e=>step(e.shiftKey?-30:-1);
document.getElementById('stepFwd').onclick=e=>step(e.shiftKey?30:1);
document.addEventListener('keydown',e=>{ if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&document.activeElement!==scrub) return;
  const k=e.key; if(k===','||k==='ArrowLeft'){ e.preventDefault(); step(e.shiftKey?-30:-1); } else if(k==='.'||k==='ArrowRight'){ e.preventDefault(); step(e.shiftKey?30:1); }
  else if(k===' '&&document.activeElement.tagName!=='BUTTON'){ e.preventDefault(); playBtn.onclick(); } });
scrub.addEventListener('input',()=>{dragging=true; au.currentTime=+scrub.value;});
scrub.addEventListener('change',()=>{dragging=false;});
const setBar=(id,v)=>{document.getElementById('b'+id).style.width=(v*100)+'%'; document.getElementById('m'+id).textContent=v.toFixed(2);};
function fmtTime(t){ const a=t, m=Math.floor(a/60), s=a-m*60; return m+':'+(s<10?'0':'')+s.toFixed(1); }
let frozen=false;
// ---------- sections: readout and jump buttons
const secBox=document.getElementById('sections'), secEl=document.getElementById('mS');
SECTIONS.forEach(sc=>{ const b=document.createElement('button'); b.textContent=sc.name; b.onclick=()=>{ au.currentTime=Math.max(0,barTime(sc.bar0)-0.05); }; secBox.appendChild(b); });
if(!SECTIONS.length) document.getElementById('secRow').style.display='none';
// ---------- camera: director (scene.json shots) or free (drag to orbit, shift-drag to pan, wheel to zoom)
const camSel=document.getElementById('camMode'), freeT=new THREE.Vector3(0,1,-0.4);
if(!CAM.shots.length){ camSel.value='free'; }
function setFree(on){ CAM.free=on; document.getElementById('camHelp').style.display=on?'inline':'none';
  if(on){ const dir=new THREE.Vector3(); camera.getWorldDirection(dir); freeT.copy(camera.position).addScaledVector(dir,Math.max(2,camera.position.distanceTo(new THREE.Vector3(0,1,-0.4)))); } }
camSel.onchange=()=>setFree(camSel.value==='free');
let drag=null;
stage.addEventListener('pointerdown',e=>{ if(!CAM.free) return; drag={x:e.clientX,y:e.clientY,pan:e.shiftKey}; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointerup',()=>drag=null);
stage.addEventListener('pointermove',e=>{ if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
  const off=camera.position.clone().sub(freeT);
  if(drag.pan){ const r=new THREE.Vector3().crossVectors(camera.up,off).normalize(), k=off.length()*0.0015; const m=r.multiplyScalar(-dx*k).add(new THREE.Vector3(0,dy*k,0)); camera.position.add(m); freeT.add(m); }
  else { const sp=new THREE.Spherical().setFromVector3(off); sp.theta-=dx*0.005; sp.phi=clamp(sp.phi-dy*0.005,0.15,Math.PI/2+0.25); camera.position.copy(freeT).add(new THREE.Vector3().setFromSpherical(sp)); camera.position.y=Math.max(0.15,camera.position.y); }
  camera.lookAt(freeT); if(frozen) animate(au.currentTime||0); });
stage.addEventListener('wheel',e=>{ if(!CAM.free) return; e.preventDefault(); const off=camera.position.clone().sub(freeT).multiplyScalar(Math.exp(e.deltaY*0.001)); camera.position.copy(freeT).add(off); camera.lookAt(freeT); },{passive:false});
document.getElementById('copyShot').onclick=async()=>{
  const r=v=>+v.toFixed(2), t=au.currentTime||0, sc=sectionAt(t);
  // where we are: section + bars into it (nearest quarter bar); seconds before the first section
  let at=+t.toFixed(2);
  if(sc&&t>=sc.t0){ const bars=Math.round((t-sc.t0)/(CPB*F.beat_period)*4)/4; at=bars>0?sc.name+'+'+bars:sc.name; }
  const shot={at, t:+t.toFixed(2), pos:camera.position.toArray().map(r), look:(CAM.free?freeT:(()=>{const d=new THREE.Vector3(); camera.getWorldDirection(d); return camera.position.clone().addScaledVector(d,5);})()).toArray().map(r), fov:r(camera.fov)};
  cfgEl.value=JSON.stringify(shot); cfgEl.style.display='block';
  try{ await navigator.clipboard.writeText(cfgEl.value); document.getElementById('copied').textContent='Camera shot copied. Paste it into the chat with where it should go.'; }
  catch(e){ cfgEl.select(); document.getElementById('copied').textContent='Select the text below and copy it.'; }
};
scrub.max=F.duration;
function loop(){
  if(frozen){ requestAnimationFrame(loop); return; }
  const t=au.currentTime||0;
  const f=animate(t);
  if(!dragging) scrub.value=t;
  timeEl.textContent=au.paused?fmtTime(t)+'  ('+t.toFixed(2)+' s, frame '+Math.round(t/FRAME)+')':fmtTime(t)+'  ('+t.toFixed(1)+' s)';
  setBar('R',f.rms); setBar('C',f.cent); setBar('F',f.flat);
  document.getElementById('mB').textContent=(f.countInBar+1)+' of '+CPB; const sc=sectionAt(t); if(sc) secEl.textContent=sc.name+' · bar '+(sc.bar+1)+' of '+SECTIONS[sc.index].bars; [...secBox.children].forEach((b,i)=>b.classList.toggle('on',!!sc&&sc.index===i));
  [...dots.children].forEach((s,i)=>s.classList.toggle('on',i===f.countInBar));
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__cam=(x,y,z,lx,ly,lz)=>{camera.position.set(x,y,z);camera.lookAt(lx,ly,lz);};
window.__renderAt=t=>{ frozen=true; lastT=null; animate(t); };

// ---------- settings export
const cfgEl=document.getElementById('cfg');
function config(){ return pToLook(); }
function updCfg(){ cfgEl.value=JSON.stringify(config(),null,2); }
updCfg();
document.getElementById('copy').onclick=async()=>{
  updCfg(); cfgEl.style.display='block';
  try{ await navigator.clipboard.writeText(cfgEl.value); document.getElementById('copied').textContent='Copied. Paste it into the chat when you\u2019re happy with a look.'; }
  catch(e){ cfgEl.select(); document.getElementById('copied').textContent='Select the text below and copy it.'; }
};
