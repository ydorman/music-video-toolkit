---
name: music-video-toolkit
description: Run a clip session with Yonatan's music-video-toolkit repo (audio-reactive 3D music videos with MakeHuman actors, browser preview and in-browser MP4 renderer). Use whenever the user wants to start, continue, tune or render a music video clip for a track, or change the toolkit itself.
---

# Music video toolkit: clip sessions

The repo is the source of truth. Read `RUNBOOK.md` and `README.md` in it before doing anything else.

## Session start
1. Get the repo: clone the URL the user gives you, or unzip the uploaded repo into /home/claude. Never work from memory of old versions.
2. `bash tools/setup.sh` (installs librosa, pinned makehuman-core, headless test libs).
3. Ask for the track audio if it isn't uploaded. Put it under `clips/<clip>/audio/` (never commit audio).
4. New clip: copy the most recent clip folder as a template, rename, then edit configs with the user.

## Working rules
- All per-clip decisions go in `clips/<clip>/` (track.json, actors.csv, choreography.json, look.json). Don't hard-code clip specifics in engine/ or tools/.
- After every change: `build_pages.py`, then `smoke_test.py` (look at the PNGs yourself) before publishing the preview artifact. Rebuild actors only when actors.csv changes.
- Publish `build/<clip>/preview.html` with the Artifact tool and keep updating the same artifact URL during the session.
- When the user pastes "Copy settings" JSON, save it verbatim to `clips/<clip>/look.json`, rebuild, republish.
- Never try to render full videos in the container (no GPU, seconds per frame). Give the user `build/<clip>/renderer.html` via present_files; they render in Chrome.
- Check beat alignment by ear with the user (Downbeat position); pin agreed grids in track.json `grid_override`.
- Engine or tool changes: keep them generic and configurable, update RUNBOOK.md, and tell the user what to commit.

## Session end
Make sure the user has everything to commit: give them a zip of the changed repo (or a patch), with suggested commit messages. Remind them that the container is wiped after the session.
