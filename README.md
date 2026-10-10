# Music Video Toolkit

Audio-reactive 3D music videos. The music drives the picture: a beat grid drives the choreography,
loudness drives the light, timbre drives the color, noisiness drives the haze. Actors are real human
bodies made with MakeHuman. Preview in the browser, render MP4s in Chrome on your own GPU.

This repo is the **toolkit only**. Content lives in a separate **project repo** per album/project,
which includes this toolkit as a git submodule pinned to a known version.

## Two repos

```
music-video-toolkit/            THIS REPO (generic, reusable)
  tools/                        setup.sh, analyze.py, build_actors.py, build_pages.py, smoke_test.py
  engine/                       browser engine (three.js r149): core, stage, actors, motion, preview, render
  shells/                       HTML templates for the preview and renderer pages
  templates/                    PROJECT.md, project.gitignore, clip-robed-dancers/ (a complete example clip config)
  skill/music-video-toolkit/    SKILL.md: how Claude runs sessions
  RUNBOOK.md                    the workflow, step by step

<project>/                      A PROJECT REPO (one per album/project)
  PROJECT.md                    context every session reads: tracks, shared visual identity, decisions
  toolkit/                      git submodule -> music-video-toolkit (pinned commit)
  clips/<NN-slug>/              per clip: track.json, actors.csv, choreography.json, look.json, stills/
                                audio/ is local only (gitignored)
  build/                        generated (gitignored)
```

## Start a new project repo

```bash
mkdir my-album-videos && cd my-album-videos && git init -b main
git submodule add https://github.com/ydorman/music-video-toolkit.git toolkit
cp toolkit/templates/PROJECT.md . && cp toolkit/templates/project.gitignore .gitignore
mkdir -p clips && cp -r toolkit/templates/clip-robed-dancers clips/01-first-track
git add -A && git commit -m "New project"
```

## Run a clip (from the project repo root)

```bash
bash toolkit/tools/setup.sh                        # once per machine/container
python3 toolkit/tools/analyze.py      clips/01-first-track
python3 toolkit/tools/build_actors.py clips/01-first-track
python3 toolkit/tools/build_pages.py  clips/01-first-track   # -> build/01-first-track/preview.html, renderer.html
```

Upgrading the toolkit inside a project: `git -C toolkit pull origin main && git commit -am "Update toolkit"`.
Every clip commit therefore records exactly which toolkit version built it.

## Requirements

- Build: Python 3.10+, ffmpeg, git. `toolkit/tools/setup.sh` installs the rest (into the toolkit's vendor/).
- Render: a current Chrome (H.264 + AAC). Safari works for video; audio encoding may not be available there.
- The pages load three.js and mp4-muxer from cdn.jsdelivr.net.

## Third-party pieces and licences

- makehuman-core (https://github.com/vidya-hub/makehuman-core, pinned in setup.sh): AGPL-3.0, a GUI-free packaging
  of MakeHuman, used as a build tool only (not shipped in the pages). Models exported from MakeHuman are, per the
  MakeHuman project's licence FAQ, free to use (CC0); confirm before commercial release.
- three.js r149 (MIT), mp4-muxer 5.1.3 (MIT), librosa (ISC). Audio is never committed.
