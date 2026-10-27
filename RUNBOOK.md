# Runbook: making a clip

One chat session per clip. Claude builds in its container; you judge and tune in the browser and render on
your Mac. Everything that defines a clip ends up in the project repo under `clips/<clip>/`.
Commands below run from the **project repo root**; the toolkit is the `toolkit/` submodule.

## 0. Start the session
- You: the project's Claude Project instructions point to the project repo; upload the track as MP3
  (enough for analysis and preview; the master is only used when rendering).
- Claude: `git clone --recursive <project repo>`, read `PROJECT.md`, `bash toolkit/tools/setup.sh`,
  then create `clips/<NN-slug>/` from the nearest previous clip or from `toolkit/templates/`.

## 1. Idea -> config (conversation)
Decide together who is on stage, what they wear, how they move, the stage and light. It lands in four files:
- `track.json`: title, slug (used in video file names), audio path, meter, `pulse_bpm` (what you count),
  `counts_per_bar` (detected pulses per bar), `tempo_hint_bpm` (roughly the detected pulse), `snippets`
  (e.g. the Instagram section), optional `grid_override` (see step 2).
- `actors.csv`: one row per actor. Columns: actor, spot, gender, age (years), weight/muscle (0-100, 50 = average),
  height_m, african/asian/caucasian (MakeHuman blend, sums to 100), hair (short01-04, bob01-02, long01, braid01,
  ponytail01, afro01), hair_tint (#FFFFFF = natural), eyebrows (eyebrow001-012), skin (hex), costume (robe),
  costume_color (hex), lean_deg, reach (1.0 = exact), arm_offset_deg, sync_lag (0-1 share of the looseness slider).
  Edit in Numbers/Excel, export CSV, upload. Claude can also read .numbers files.
- `choreography.json`: positions (arm angles + head), final pose, step pattern, formations (`wide` for 16:9,
  `compact` for vertical/square). Spot names in actors.csv must exist in every formation.
- `look.json`: start from a previous clip's, or `{}` for defaults.
- `scene.json` (optional): the setting, the light per section and the camera shots. Without it you get the clip 05
  studio (glowing backdrop, fixed camera). See "Sections, scenes and cameras" below.

New capabilities (another costume, props, a background, new music mappings) are toolkit changes:
make them in the toolkit repo, keep them generic, document them here, then update the submodule in the project.

### Sections, scenes and cameras
- **Sections** (`track.json` `sections`: `[{"name":"Intro","bars":2},{"name":"A","bars":4},...]`) are counted in bars
  from bar 1 of the grid. The preview shows the current section and has a button to jump to each one. Anything
  timed in scene.json can say `"at": "C"` (start of C), `"C+2"` (2 bars into C) or a time in seconds.
  `accents` (optional) lists the accented counts within the bar, for the choreography.
- **Environment**: `"environment": "studio"` (default) or `"jungle"`, a procedural rain forest (trunks, understory,
  palms, canopy, vines, leaf litter, distant forest, sky, light shafts, mist, fireflies and dust). Its `jungle`
  block sets the seed (a different seed = a different forest), clearing size/centre, trunk count, understory/canopy
  density, canopy height, vines, fog and the sun's default direction. Plants are kept out of every camera's path.
- **Light keyframes** (`light`): each entry holds from its `at` until the next and blends in over `blend` bars.
  Jungle keys: `day` (0 night .. 1 full day), `sun` (direct sun and shafts), `shafts`, `sweep` (how far the sun
  swings with the sound's brightness), `spread` (1 = shafts all over the clearing, small = one focused shaft),
  `fireflies` (they sparkle on note onsets), `mist` (also thickens with noisier sound), `cool`, `warm`,
  `elevation`/`azimuth` (sun direction, degrees). Loudness, fade-in and ending still come from look.json.
  The preview's **Jungle** sliders scale these for the whole clip and are saved in look.json under `jungle`.
- **Cameras** (`cameras`): one shot per entry, held until the next: `pos`, `look`, `fov` (vertical, 16:9), optional
  `to` (where the shot ends), `path` `"line"` or `"arc"` (around the look point), `"cut": false` + `blend` (bars)
  to blend from the previous shot instead of cutting. `camera_sway` (default 1) adds a slow handheld breath.
  In the preview, Camera: Free lets you orbit (drag), pan (shift-drag) and zoom (scroll); **Copy camera shot**
  copies the current view as a shot to paste into the chat. Portrait renders widen the view automatically
  (a per-shot portrait framing is still to come).

## 2. Analyse
`python3 toolkit/tools/analyze.py clips/<clip>` prints the pulse, grid fit, bar-phase scores, music start/end and
a suggested ending start.
- grid_fit_max_error_s below ~0.05 s means a steady tempo. If it is large the tempo moves and a straight grid
  will drift (needs a tempo map, not built yet).
- bar_phase is a guess from bass accents. If "1" feels wrong in the preview, fix it by ear (Downbeat position),
  then pin the grid in `track.json` under `grid_override`.

## 3. Build and preview
```
python3 toolkit/tools/build_actors.py clips/<clip>   # only when actors.csv changes (about a minute)
python3 toolkit/tools/build_pages.py  clips/<clip>   # after any config or toolkit change
python3 toolkit/tools/smoke_test.py   clips/<clip> --times 2 60 120 --render 60   # Claude checks before showing
```
Claude publishes `build/<clip>/preview.html` as an artifact (must stay under 16 MB).

## 4. Tune
You play with the sliders, press **Copy settings** and paste the JSON into the chat. Claude saves it verbatim as
`clips/<clip>/look.json`, rebuilds, republishes. Repeat with actors/choreography as needed.

## 5. Render (your Mac)
Claude hands you `build/<clip>/renderer.html`. Open it in Chrome and keep the tab in front.
- Whole song, 16:9, with your master (WAV/AIFF/FLAC) for DistroVid / YouTube.
- Snippet, 9:16 (Reels) or 4:5 (feed). Portrait/square uses the `compact` formation.
The master must start at the same point as the analysed audio.

## 6. Finish the clip
When you're happy with the renders:
1. **Stills.** Claude saves 4-6 reference frames into `clips/<clip>/stills/`:
   `python3 toolkit/tools/smoke_test.py clips/<clip> --times <t1> <t2> ... --stills`
   Pick moments that show the clip's range: an early bar, the main positions, a turn, the brightest and the
   darkest color, the ending. Files are named `tNNNs.jpg` by song time in seconds. Future sessions look at
   these to keep the album consistent.
2. **PROJECT.md.** Mark the clip final in the track table and add anything the next session should know
   (what worked, what to avoid, shared choices that should carry over).
3. **Commit and tag** in the project repo: `git add clips/<clip> PROJECT.md && git commit -m "Clip NN final"`
   and `git tag clip-NN-final`. Toolkit changes made during the session are committed in the toolkit repo first,
   then the submodule is updated in the project repo.

## Known limits
- Rendering is in the browser on your GPU; Claude's container has none (several seconds per frame there).
- Choreography is a loop: positions cycle per bar, steps per bar, one optional turn; the start fade-in and the
  ending bow/fade are the only section-aware movement (light and cameras follow the sections via scene.json).
- Costumes: only `robe` (generated from MakeHuman's fitting helpers; a sash hides the waist seam).
- Backgrounds: the studio backdrop or the procedural jungle (engine/scene.js). More environments go there too.
- The smoke test skips the web fonts (not reachable from the container), so its screenshots use fallback fonts.
