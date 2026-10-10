# Music Video Toolkit

Audio-reactive 3D music videos, built per track from a few config files.
The music drives the picture: a beat grid drives the choreography, loudness drives the light,
timbre drives the color, noisiness drives the haze. Actors are real human bodies made with MakeHuman.

First clip: `clips/05-mr-gs-dance-at-seven`, seven robed dancers, 7/4.

## How it fits together

```
clips/<clip>/                 per-clip input (committed)
  track.json                  title, audio file, meter, counts per bar, snippets, optional grid override
  actors.csv                  who is on stage: body, hair, skin, costume, spot, movement quirks
  choreography.json           positions, final pose, step pattern, formations
  look.json                   the tuned settings (pasted from the preview's "Copy settings")
  audio/                      the track (NOT committed)

tools/                        the pipeline (runs in Claude's container, or on a Mac with Python)
  setup.sh                    one-time: librosa, makehuman-core (pinned), test libs
  analyze.py                  audio -> build/<clip>/features.json (+ analysis_report.json)
  build_actors.py             actors.csv -> build/<clip>/actors/ (MakeHuman bodies + costume)
  build_pages.py              engine + clip data -> build/<clip>/preview.html, renderer.html
  smoke_test.py               headless check: preview frames + a 1 s test render

engine/                       the browser engine (three.js r149), concatenated in this order
  core.js                     look <-> settings, sliders, helpers, beat position
  stage.js                    renderer, camera, floor, backdrop, lights      <- per-clip looks / backgrounds go here
  actors.js                   skinned MakeHuman actors, costume morphs, hanging sleeves
  motion.js                   positions, steps, turns, leg IK, start/end, animate(t)
  preview.js                  transport, live sliders, "Copy settings"
  render.js                   offline frame-by-frame MP4 encoder (WebCodecs + mp4-muxer)

shells/                       HTML templates for the two pages
skill/music-video-toolkit/    SKILL.md: how Claude should run a clip session
RUNBOOK.md                    the per-clip workflow, step by step
```

## Quick start (a new clip)

```bash
bash tools/setup.sh                          # once per machine/container
cp -r clips/05-mr-gs-dance-at-seven clips/06-new-track   # then edit the four config files
cp ~/Music/06.mp3 clips/06-new-track/audio/
python3 tools/analyze.py      clips/06-new-track
python3 tools/build_actors.py clips/06-new-track
python3 tools/build_pages.py  clips/06-new-track
open build/06-new-track/renderer.html        # in Chrome
```

See RUNBOOK.md for the full loop (preview -> tune -> bake -> render).

## Requirements

- Build: Python 3.10+, ffmpeg, git. `tools/setup.sh` installs the rest.
- Render: a current Chrome (H.264 + AAC). Safari works for video; audio encoding may not be available there.
- Preview pages and the renderer load three.js and mp4-muxer from cdn.jsdelivr.net.

## Third-party pieces and licences

- makehuman-core (https://github.com/vidya-hub/makehuman-core, pinned in setup.sh): AGPL-3.0, a GUI-free packaging of MakeHuman.
  Used as a build tool only; it is not shipped in the pages. Models exported from MakeHuman are, per the
  MakeHuman project's licence FAQ, free to use (CC0); confirm before commercial release.
- three.js r149 (MIT), mp4-muxer 5.1.3 (MIT), librosa (ISC).
- Audio files are never committed.
