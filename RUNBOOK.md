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

New capabilities (another costume, props, a background, new music mappings) are toolkit changes:
make them in the toolkit repo, keep them generic, document them here, then update the submodule in the project.

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
  ending bow/fade are the only section-aware behaviour.
- Costumes: only `robe` (generated from MakeHuman's fitting helpers; a sash hides the waist seam).
- Backgrounds: only the built-in glowing backdrop; the background designer is still to be built (engine/stage.js).
