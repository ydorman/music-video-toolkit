// Embedded by build_pages.py before this file: TRACK, CHOREO, LOOK, F (features), PEOPLE_DATA, EMBED_AUDIO
const stage = document.getElementById('stage');
const au = document.getElementById('au');

// ---------- look: the settings the user tunes in the preview (stored per clip in look.json)
function lookToP(L){ const m=(L&&L.mapping)||{}, g=(o,k,d)=>(o&&o[k]!==undefined)?o[k]:d;
  return { dim:g(m['loudness->light'],'base',0.45), resp:g(m['loudness->light'],'response',0.6),
    hueDark:g(m['brightness->hue'],'dark',30), hueBright:g(m['brightness->hue'],'bright',248), tint:g(m['brightness->hue'],'tint',0.45),
    haze:g(m,'noisiness->haze',0.5),
    posBars:g(m['bar->position'],'bars_per_position',1), sharp:g(m['bar->position'],'transition',0.35),
    step:g(m['bar->step'],'size_m',0.18), turnPos:g(m,'turn_during_position',1),
    fadeIn:g(m.start_end,'fade_in_s',6), outStart:g(m.start_end,'ending_starts_s',F.ending_suggestion||F.duration-10), outLen:g(m.start_end,'ending_length_s',10),
    skirt:g(m.robe,'skirt_shape',0.3), sleeve:g(m.robe,'sleeve_fullness',0.4),
    accent:g(m,'downbeat->dip',0.5), loose:g(m,'sync_looseness_s',0.05),
    shift:g(m,'downbeat_shift',0), offsetMs:g(m,'visual_offset_ms',0) }; }
function pToLook(){ return {track:TRACK.title, meter:TRACK.meter, pulse_bpm:TRACK.pulse_bpm, actors:PEOPLE_DATA.length, positions:CHOREO.positions.map(s=>s.name),
  mapping:{ "loudness->light":{base:P.dim, response:P.resp}, "brightness->hue":{dark:P.hueDark, bright:P.hueBright, tint:P.tint},
    "noisiness->haze":P.haze, "bar->position":{bars_per_position:P.posBars, transition:P.sharp},
    "bar->step":{size_m:P.step, pattern:CHOREO.step_pattern_name||'custom'}, turn_during_position:P.turnPos,
    start_end:{fade_in_s:P.fadeIn, ending_starts_s:P.outStart, ending_length_s:P.outLen},
    robe:{skirt_shape:P.skirt, sleeve_fullness:P.sleeve}, "downbeat->dip":P.accent, sync_looseness_s:P.loose,
    downbeat_shift:P.shift, visual_offset_ms:P.offsetMs } }; }
const P = lookToP(LOOK);
const CPB = TRACK.counts_per_bar||7;          // counts (detected pulses) per bar
const fmtMS=v=>Math.floor(v/60)+':'+String((v%60).toFixed(1)).padStart(4,'0');

const GROUPS = [
  { name:'Light', items:[
    {k:'dim', label:'Base light', min:0.15, max:1, step:0.01, hint:'How dim the stage is overall'},
    {k:'resp', label:'Loudness → light', min:0, max:1, step:0.01, hint:'How much the light swells with loudness'},
    {k:'haze', label:'Haze', min:0, max:1, step:0.01, hint:'Thickens when the sound gets noisier'} ]},
  { name:'Color', items:[
    {k:'hueDark', label:'Hue when timbre is dark', min:0, max:360, step:1, fmt:v=>v+'°'},
    {k:'hueBright', label:'Hue when timbre is bright', min:0, max:360, step:1, fmt:v=>v+'°'},
    {k:'tint', label:'Tint on robes and light', min:0, max:1, step:0.01, hint:'0 keeps everything neutral'} ]},
  { name:'Robe', items:[
    {k:'skirt', label:'Skirt shape', min:0, max:1, step:0.01, hint:'0 = straight and close to the legs, 1 = full A-line'},
    {k:'sleeve', label:'Sleeve fullness', min:0, max:1, step:0.01, hint:'How much cloth hangs below the arm'} ]},
  { name:'Movement', items:[
    {k:'posBars', label:'Length of each position', options:[[1,'1 bar'],[2,'2 bars']]},
    {k:'sharp', label:'Transition length', min:0.08, max:1, step:0.01, hint:'Short = sudden and held, long = flowing'},
    {k:'step', label:'Step size', min:0, max:0.35, step:0.01, fmt:v=>Math.round(v*100)+' cm', hint:'One step per bar, pattern set in choreography.json'},
    {k:'turnPos', label:'Full turn during', options:[[0,'No turn'],...CHOREO.positions.map((s,i)=>[i+1,'Position '+(i+1)+' ('+s.name+')'])]},
    {k:'loose', label:'Sync looseness', min:0, max:0.2, step:0.005, fmt:v=>Math.round(v*1000)+' ms', hint:'Tiny lag between dancers'},
    {k:'accent', label:'Downbeat dip', min:0, max:1, step:0.01} ]},
  { name:'Start and end', items:[
    {k:'fadeIn', label:'Fade in', min:0, max:20, step:0.5, fmt:v=>v+' s', hint:'The dancers emerge from darkness when the music starts'},
    {k:'outStart', label:'Ending starts at', min:Math.max(0,Math.floor(F.duration-90)), max:Math.ceil(F.duration), step:0.5, fmt:fmtMS, hint:'Movement settles into a still bow, then the light fades'},
    {k:'outLen', label:'Ending length', min:2, max:16, step:0.5, fmt:v=>v+' s'} ]},
  { name:'Timing', items:[
    {k:'shift', label:'Downbeat position', min:0, max:CPB-1, step:1, fmt:v=>'count '+(v+1), hint:'Move this if "1" lands in the wrong place'},
    {k:'offsetMs', label:'Visual offset', min:-200, max:200, step:5, fmt:v=>v+' ms'} ]}
];

// ---------- controls
const fmtNum=v=>(+v).toFixed(2);
const cbox=document.getElementById('controls');
GROUPS.forEach(g=>{
  const fs=document.createElement('fieldset'); const lg=document.createElement('legend'); lg.textContent=g.name; fs.appendChild(lg);
  g.items.forEach(it=>{
    const d=document.createElement('div'); d.className='ctl'; const id='c_'+it.k;
    if(it.options){
      d.innerHTML=`<label for="${id}">${it.label}</label>`;
      const s=document.createElement('select'); s.id=id;
      it.options.forEach(([v,tx])=>{const o=document.createElement('option');o.value=v;o.textContent=tx;if(v==P[it.k])o.selected=true;s.appendChild(o);});
      s.onchange=()=>{P[it.k]=+s.value;updCfg();}; d.appendChild(s);
    } else {
      const f=it.fmt||fmtNum;
      d.innerHTML=`<label for="${id}"><span>${it.label}</span><output id="o_${it.k}">${f(P[it.k])}</output></label>`;
      const r=document.createElement('input'); r.type='range'; r.id=id; r.min=it.min; r.max=it.max; r.step=it.step; r.value=P[it.k];
      r.oninput=()=>{P[it.k]=+r.value; document.getElementById('o_'+it.k).textContent=f(P[it.k]); updCfg();};
      d.appendChild(r);
      if(it.hint){const sm=document.createElement('small'); sm.textContent=it.hint; d.appendChild(sm);}
    }
    fs.appendChild(d);
  });
  cbox.appendChild(fs);
});
const dots=document.getElementById('dots'); for(let i=0;i<CPB;i++) dots.appendChild(document.createElement('span'));

// ---------- helpers
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const D=Math.PI/180;
function feat(name,t){ const a=F[name]; return a[clamp(Math.floor(t*F.fps),0,a.length-1)]; }
function beatPos(t){ return (t - F.beat_offset - P.offsetMs/1000)/F.beat_period - P.shift - F.bar_phase; }

