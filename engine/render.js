// ---------- offline renderer: frame-accurate, encodes MP4 in the browser (WebCodecs)
const ui=id=>document.getElementById(id);
const FORMATIONS=CHOREO.formations;  // 'wide' for landscape, 'compact' for portrait/square
function setFormation(name){ const F2=FORMATIONS[name]; dancers.forEach(d=>{ const sp=F2[d.meta.cfg.spot]||[0,0]; d.group.position.set(sp[0],0,sp[1]); }); }
function setupFrame(W,H){
  renderer.setPixelRatio(1); window.RW=W; window.RH=H; resize();
  const compact=W/H<1.2&&!!FORMATIONS.compact; setFormation(compact?'compact':'wide');
  const aspect=W/H, tanH=Math.tan(17*D)*aspect, hw=compact?2.45:3.15, cz=compact?-0.55:-0.35;
  const dist=Math.max(6.75, hw/tanH*1.04);
  camera.position.set(0,1.32+(dist-6.75)*0.09,cz+dist); camera.lookAt(0,1.02,cz-0.05);
  ui('stage').style.aspectRatio=W+'/'+H;
}
const SONG_LEN=F.duration;
function fmt(t){ const m=Math.floor(t/60), s=Math.floor(t-m*60); return m+':'+String(s).padStart(2,'0'); }
function range(){ const v=ui('what').value; if(v==='full') return [0,SONG_LEN]; if(v.startsWith('snip')){ const s=TRACK.snippets[+v.slice(4)]; return [s.start,s.end]; }
  const p=s=>{ const [m,x]=s.split(':'); return x===undefined?+m:(+m)*60+(+x); }; return [clamp(p(ui('t0').value),0,SONG_LEN),clamp(p(ui('t1').value),0,SONG_LEN)]; }
function sizes(){ return {h:[1920,1080],v:[1080,1920],f:[1080,1350],s:[1080,1080]}[ui('fmt').value]; }
ui('what').onchange=()=>{ ui('custom').style.display=ui('what').value==='custom'?'flex':'none'; };
function preview(){ const [W,H]=sizes(); setupFrame(W,H); const [a,b]=range(); const t=lerp(a,b,+ui('pv').value); animate(t); ui('pvt').textContent=fmt(t); }
ui('fmt').onchange=preview; ui('pv').oninput=preview; ui('what').addEventListener('change',preview);
let audioBuf=null;
// AIFF / AIFF-C reader (Chrome's decoder doesn't support AIFF)
function ext80(dv,o){ const s=dv.getUint8(o)&0x80?-1:1, e=((dv.getUint8(o)&0x7f)<<8|dv.getUint8(o+1))-16383, hi=dv.getUint32(o+2), lo=dv.getUint32(o+6);
  return s*(hi*Math.pow(2,e-31)+lo*Math.pow(2,e-63)); }
function parseAIFF(ab){
  const dv=new DataView(ab), tag=o=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
  if(tag(0)!=='FORM'||!['AIFF','AIFC'].includes(tag(8))) return null;
  let ch,frames,bits,sr,comp='NONE',dataOff=-1;
  for(let o=12;o+8<=ab.byteLength;){ const id=tag(o), sz=dv.getUint32(o+4);
    if(id==='COMM'){ ch=dv.getInt16(o+8); frames=dv.getUint32(o+10); bits=dv.getInt16(o+14); sr=ext80(dv,o+16); if(tag(8)==='AIFC') comp=tag(o+26); }
    if(id==='SSND'){ dataOff=o+16+dv.getUint32(o+8); }
    o+=8+sz+(sz&1); }
  if(dataOff<0||!ch) throw new Error('This AIFF file has no audio data.');
  const le=comp==='sowt', isFloat=comp==='fl32'||comp==='FL32';
  if(!['NONE','sowt','twos','fl32','FL32'].includes(comp)) throw new Error('Compressed AIFF ('+comp+') is not supported. Please export uncompressed AIFF or WAV.');
  const B=isFloat?4:Math.ceil(bits/8), buf=new AudioBuffer({length:frames,numberOfChannels:ch,sampleRate:Math.round(sr)});
  const planes=[...Array(ch)].map((_,c)=>buf.getChannelData(c)), scale=1/Math.pow(2,B*8-1);
  let p=dataOff;
  for(let i=0;i<frames;i++) for(let c=0;c<ch;c++,p+=B){
    let v;
    if(isFloat) v=dv.getFloat32(p,false);
    else if(B===2) v=dv.getInt16(p,le)*scale;
    else if(B===3){ const b0=dv.getUint8(p),b1=dv.getUint8(p+1),b2=dv.getUint8(p+2); let x=le?(b2<<16|b1<<8|b0):(b0<<16|b1<<8|b2); if(x&0x800000) x-=0x1000000; v=x*scale; }
    else if(B===4) v=dv.getInt32(p,le)*scale;
    else v=dv.getInt8(p)*scale;
    planes[c][i]=v;
  }
  return buf;
}
async function getAudio(){
  const f=ui('master').files[0];
  const ab= f ? await f.arrayBuffer() : b64(EMBED_AUDIO);
  const aiff=parseAIFF(ab); if(aiff) return aiff;
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  try{ return await ctx.decodeAudioData(ab); }
  catch(e){ throw new Error('This browser cannot read that audio file. WAV, FLAC, AIFF and MP3 work; please export one of those.'); }
  finally{ ctx.close(); }
}
async function pickVideoCodec(W,H,fps){
  const tries=[['avc1.640034','avc'],['avc1.4d0034','avc'],['avc1.42003e','avc'],['vp09.00.41.08','vp9']];
  for(const [codec,mux] of tries){
    const cfg={codec,width:W,height:H,bitrate:W*H>2e6?14e6:10e6,framerate:fps};
    if(codec.startsWith('avc')) cfg.avc={format:'avc'};
    try{ const s=await VideoEncoder.isConfigSupported(cfg); if(s.supported) return {cfg,mux}; }catch(e){}
  }
  return null;
}
async function pickAudioCodec(sr,ch){
  for(const [codec,mux] of [['mp4a.40.2','aac'],['opus','opus']]){
    const cfg={codec,sampleRate:sr,numberOfChannels:ch,bitrate:256000};
    try{ const s=await AudioEncoder.isConfigSupported(cfg); if(s.supported) return {cfg,mux}; }catch(e){}
  }
  return null;
}
let busy=false, cancel=false;
ui('go').onclick=async()=>{
  if(busy){ cancel=true; return; }
  if(!('VideoEncoder' in window)){ ui('status').textContent='This browser cannot encode video. Please use a current Chrome, Edge or Safari.'; return; }
  busy=true; cancel=false; ui('go').textContent='Cancel';
  try{
    const fps=30, [W,H]=sizes(), [t0,t1]=range();
    if(!(t1>t0)) throw new Error('The end time must be after the start time.');
    setupFrame(W,H);
    ui('status').textContent='Preparing audio…';
    const buf=await getAudio();
    if(ui('master').files[0] && Math.abs(buf.duration-SONG_LEN)>0.5) ui('note').textContent=`Note: the file you chose is ${buf.duration.toFixed(1)} s long, the analysed track is ${SONG_LEN.toFixed(1)} s. If it doesn't start at the same point, the dancers will be off the beat.`;
    const vc=await pickVideoCodec(W,H,fps); if(!vc) throw new Error('No supported video encoder found in this browser.');
    const ch=Math.min(2,buf.numberOfChannels), ac=('AudioEncoder' in window)?await pickAudioCodec(buf.sampleRate,ch):null;
    const muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(), fastStart:'in-memory',
      video:{codec:vc.mux,width:W,height:H,frameRate:fps}, audio: ac?{codec:ac.mux,sampleRate:buf.sampleRate,numberOfChannels:ch}:undefined});
    let encErr=null;
    const venc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m), error:e=>encErr=e}); venc.configure(vc.cfg);
    // audio
    if(ac){
      ui('status').textContent='Encoding audio…';
      const aenc=new AudioEncoder({output:(c,m)=>muxer.addAudioChunk(c,m), error:e=>encErr=e}); aenc.configure(ac.cfg);
      const s0=Math.floor(t0*buf.sampleRate), s1=Math.min(buf.length,Math.floor(t1*buf.sampleRate)), CH=1024;
      const planes=[...Array(ch)].map((_,c)=>buf.getChannelData(c));
      for(let s=s0;s<s1;s+=CH){
        const n=Math.min(CH,s1-s), data=new Float32Array(n*ch);
        for(let c=0;c<ch;c++) data.set(planes[c].subarray(s,s+n),c*n);
        // short fades so a snippet doesn't start or stop with a click
        const fadeN=Math.floor(0.02*buf.sampleRate);
        for(let c=0;c<ch;c++) for(let i=0;i<n;i++){ const k=s+i-s0, r=s1-(s+i); const g=Math.min(1,k/fadeN,r/fadeN); data[c*n+i]*=g; }
        aenc.encode(new AudioData({format:'f32-planar',sampleRate:buf.sampleRate,numberOfFrames:n,numberOfChannels:ch,timestamp:Math.round((s-s0)/buf.sampleRate*1e6),data}));
        if(aenc.encodeQueueSize>50) await new Promise(r=>setTimeout(r,0));
      }
      await aenc.flush(); aenc.close();
    } else ui('note').textContent='This browser cannot encode audio, so the video will be silent. Add the audio afterwards (see the note below).';
    // video
    const n0=Math.round(t0*fps), n1=Math.round(t1*fps), N=n1-n0, start=performance.now();
    for(let n=n0;n<n1;n++){
      if(cancel) throw new Error('Cancelled.'); if(encErr) throw encErr;
      animate(n/fps);
      const fr=new VideoFrame(renderer.domElement,{timestamp:Math.round((n-n0)*1e6/fps),duration:Math.round(1e6/fps)});
      venc.encode(fr,{keyFrame:(n-n0)%(fps*2)===0}); fr.close();
      while(venc.encodeQueueSize>4) await new Promise(r=>setTimeout(r,1));
      if((n-n0)%15===0){ const done=(n-n0+1)/N, el=(performance.now()-start)/1000, eta=el/done-el;
        ui('bar').style.width=(done*100)+'%'; ui('status').textContent=`Rendering frame ${n-n0+1} of ${N} · about ${fmt(Math.max(0,eta))} left`; await new Promise(r=>setTimeout(r,0)); }
    }
    await venc.flush(); venc.close(); muxer.finalize();
    const blob=new Blob([muxer.target.buffer],{type:'video/mp4'});
    const wv=ui('what').value, part=wv==='full'?'full-song':wv.startsWith('snip')?(TRACK.snippets[+wv.slice(4)].name||'snippet'):'section';
    const name=`${TRACK.slug}-${part}-${ui('fmt').selectedOptions[0].dataset.tag}.mp4`;
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.textContent='Download '+name+' ('+(blob.size/1e6).toFixed(1)+' MB)';
    ui('result').innerHTML=''; ui('result').appendChild(a); a.click();
    ui('bar').style.width='100%'; ui('status').textContent='Done.';
  }catch(e){ ui('status').textContent=(e&&e.message)||String(e); }
  busy=false; ui('go').textContent='Render video';
};
// fill the 'What' menu from track.json snippets
TRACK.snippets.forEach((s,i)=>{ const o=document.createElement('option'); o.value='snip'+i; o.textContent=`Snippet ${s.name||i+1} ${fmt(s.start)}–${fmt(s.end)}`; ui('what').insertBefore(o,ui('what').lastElementChild); });
if(TRACK.snippets.length) ui('what').value='snip0';
document.title=TRACK.title+' · video renderer'; ui('title').textContent=TRACK.title;
preview();
