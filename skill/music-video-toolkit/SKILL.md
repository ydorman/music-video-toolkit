---
name: music-video-toolkit
description: Run a clip session with Yonatan's music-video-toolkit (audio-reactive 3D music videos with MakeHuman actors, browser preview and in-browser MP4 renderer). Use whenever the user wants to start, continue, tune or render a music video clip, set up a new video project, or change the toolkit itself.
---

# Music video toolkit: clip sessions

Two kinds of repo: the toolkit (https://github.com/ydorman/music-video-toolkit, generic code) and a project repo
per album/project (content: PROJECT.md, clips/, toolkit as a submodule). The repos are the source of truth;
read `toolkit/RUNBOOK.md` and the project's `PROJECT.md` before doing anything else.

## Session start
1. Clone the project repo the user's instructions name, with `--recursive` (or unzip an uploaded copy) into /home/claude.
   If there is no project repo yet, set one up as described in the toolkit README.
2. `bash toolkit/tools/setup.sh`.
3. Ask for the track audio if it isn't uploaded; put it under `clips/<clip>/audio/` (never commit audio).
4. Look at the stills of finished clips (`clips/*/stills/`) to stay consistent with the project's look.
5. New clip: copy the nearest finished clip folder (or `toolkit/templates/clip-robed-dancers`), then edit the configs with the user.

## Working rules
- Per-clip decisions go in `clips/<clip>/`; project-wide decisions go in `PROJECT.md`. Never hard-code clip specifics in the toolkit.
- After every change: `build_pages.py`, then `smoke_test.py` (look at the PNGs yourself) before publishing the preview artifact. Rebuild actors only when actors.csv changes.
- Publish `build/<clip>/preview.html` with the Artifact tool and keep updating the same artifact URL during the session.
- When the user pastes "Copy settings" JSON, save it verbatim to `clips/<clip>/look.json`, rebuild, republish.
- Never render full videos in the container (no GPU, seconds per frame). Hand the user `build/<clip>/renderer.html` via present_files; they render in Chrome.
- Check beat alignment by ear with the user (Downbeat position); pin agreed grids in track.json `grid_override`.
- Toolkit changes: generic and configurable, documented in RUNBOOK.md, committed in the toolkit repo, then the submodule updated in the project.

## Session end
Follow RUNBOOK step 6 when a clip is final (stills, PROJECT.md, tag). You cannot push: give the user the changes
for each repo that changed (git format-patch output or a zip), with commit messages and the exact commands to apply them.
The container is wiped after the session.
