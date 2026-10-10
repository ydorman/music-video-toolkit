// ---------- transport
const playBtn=document.getElementById('play'), scrub=document.getElementById('scrub'), timeEl=document.getElementById('time');
let dragging=false;
playBtn.onclick=()=>{ if(au.paused) au.play(); else au.pause(); };
au.onplay=()=>playBtn.textContent='Pause'; au.onpause=()=>playBtn.textContent='Play';
scrub.addEventListener('input',()=>{dragging=true; au.currentTime=+scrub.value;});
scrub.addEventListener('change',()=>{dragging=false;});
const setBar=(id,v)=>{document.getElementById('b'+id).style.width=(v*100)+'%'; document.getElementById('m'+id).textContent=v.toFixed(2);};
function fmtTime(t){ const a=t, m=Math.floor(a/60), s=a-m*60; return m+':'+(s<10?'0':'')+s.toFixed(1); }
let frozen=false;
scrub.max=F.duration;
function loop(){
  if(frozen){ requestAnimationFrame(loop); return; }
  const t=au.currentTime||0;
  const f=animate(t);
  if(!dragging) scrub.value=t;
  timeEl.textContent=fmtTime(t)+'  ('+t.toFixed(1)+' s)';
  setBar('R',f.rms); setBar('C',f.cent); setBar('F',f.flat);
  document.getElementById('mB').textContent=(f.countInBar+1)+' of 7';
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
