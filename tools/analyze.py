#!/usr/bin/env python3
"""Analyse a clip's audio: beat grid, bar phase, per-frame features, start/end suggestions.

Reads clips/<clip>/track.json, writes build/<clip>/features.json and prints a short report.
The beat grid is a straight line fitted through all detected beats (works for steady-tempo tracks).
If the track drifts in tempo this needs a tempo map instead (not implemented yet).

Usage (from the project repo): python3 toolkit/tools/analyze.py clips/<clip>
"""
import sys, os, json, argparse
import numpy as np, librosa

ap=argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--fps',type=int,default=30); args=ap.parse_args()
CLIP=os.path.abspath(args.clip); NAME=os.path.basename(CLIP.rstrip('/'))
PROJECT=os.path.dirname(os.path.dirname(CLIP)); OUT=os.path.join(PROJECT,'build',NAME); os.makedirs(OUT,exist_ok=True)
T=json.load(open(os.path.join(CLIP,'track.json')))
audio=os.path.join(CLIP,T['audio'])
if not os.path.exists(audio): sys.exit(f"audio not found: {audio}  (put the file there; audio is not committed to git)")
CPB=T.get('counts_per_bar',4)

y,sr=librosa.load(audio,sr=22050,mono=True); hop=512
S=np.abs(librosa.stft(y,hop_length=hop)); f=librosa.fft_frequencies(sr=sr)
oenv=librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop)
lowon=librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[f<200]),sr=sr,hop_length=hop)
tempo,beats=librosa.beat.beat_track(onset_envelope=oenv,sr=sr,hop_length=hop,start_bpm=T.get('tempo_hint_bpm',120))
bt=librosa.frames_to_time(beats,sr=sr,hop_length=hop)
n=np.arange(len(bt)); period,off=np.polyfit(n,bt,1); resid=bt-(period*n+off)
off=off%period
# bar phase: the count position (mod CPB) with the strongest low-band accents
ks=np.arange(0,int((len(y)/sr-off)/period)); tt=off+ks*period
acc=lowon[np.clip(librosa.time_to_frames(tt,sr=sr,hop_length=hop),0,len(lowon)-1)]
phase_scores=[float(acc[ks%CPB==c].mean()) for c in range(CPB)]
bar_phase=int(np.argmax(phase_scores))
grid=dict(beat_period=float(period),beat_offset=float(off),bar_phase=bar_phase,source='analysis')
if T.get('grid_override'):
    g=T['grid_override']; grid.update({k:g[k] for k in ('beat_period','beat_offset','bar_phase') if k in g}); grid['source']='track.json grid_override'

rms_full=librosa.feature.rms(y=y,hop_length=hop)[0]; tr=librosa.frames_to_time(np.arange(len(rms_full)),sr=sr,hop_length=hop)
db=20*np.log10(rms_full+1e-9); thr=db.max()-40
music_start=float(tr[np.argmax(db>thr)]); music_end=float(tr[len(db)-1-np.argmax(db[::-1]>thr)])
low=10*np.log10((S[f<150]**2).sum(0)+1e-9)
win=int(2*sr/hop); lows=np.convolve(low,np.ones(win)/win,'same'); med=np.median(lows[(tr>music_start)&(tr<music_end)])
above=np.where(lows>=med-6)[0]; bass_end=float(tr[above[-1]]) if len(above) else music_end
ending=max(music_start,round((bass_end-2)*2)/2)

duration=len(y)/sr; N=int(duration*args.fps); t=np.arange(N)/args.fps
fr=np.clip(librosa.time_to_frames(t,sr=sr,hop_length=hop),0,S.shape[1]-1)
rms=librosa.feature.rms(S=S)[0]; cent=librosa.feature.spectral_centroid(S=S,sr=sr)[0]; flat=librosa.feature.spectral_flatness(S=S)[0]; lowE=(S[f<200]**2).sum(0)
def sm(x,w): return np.convolve(x,np.ones(w)/w,'same')
def norm(x):
    lo,hi=np.percentile(x,[3,97]); return np.clip((x-lo)/(hi-lo+1e-9),0,1)
feat={'fps':args.fps,'duration':duration,**{k:grid[k] for k in ('beat_period','beat_offset','bar_phase')},
      'music_start':music_start,'music_end':music_end,'ending_suggestion':ending}
for k,v in {'rms':norm(sm(rms,9)),'cent':norm(sm(cent,43)),'flat':norm(sm(flat,43)),'low':norm(sm(lowE,5)),'onset':norm(oenv)}.items():
    feat[k]=[round(float(x),3) for x in v[fr]]
json.dump(feat,open(os.path.join(OUT,'features.json'),'w'),separators=(',',':'))
rep=dict(duration_s=round(duration,2),detected_pulse_bpm=round(60/period,2),grid_fit_max_error_s=round(float(np.abs(resid).max()),3),
         grid=grid,bar_phase_scores=[round(x,2) for x in phase_scores],music_start_s=round(music_start,2),music_end_s=round(music_end,2),
         bass_fades_by_s=round(bass_end,2),suggested_ending_start_s=ending)
json.dump(rep,open(os.path.join(OUT,'analysis_report.json'),'w'),indent=2)
print(json.dumps(rep,indent=2))
if rep['grid_fit_max_error_s']>0.08: print("WARNING: beats drift from a straight grid; the tempo may not be steady.")
