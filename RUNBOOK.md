# Runbook: making a clip

One chat session per clip. Claude does the building in its container; you judge and tune in the browser,
and render on your Mac. Everything that matters ends up in `clips/<clip>/` and gets committed.

## 0. Start the session
- You: give Claude the repo (public: the GitHub URL; private: upload a zip of the repo) and the audio file
  (MP3 is enough for analysis and preview; the master is only used when rendering).
- Claude: `bash tools/setup.sh`, then create `clips/<NN-slug>/` from the previous clip as a template.

## 1. Idea -> config (conversation)
Decide together: who is on stage, what they wear, how they move, the stage and light.
This lands in the four config files:
- `track.json`: title, slug (used in video file names), audio path, meter, `pulse_bpm` (what you count),
  `counts_per_bar` (detected pulses per bar, e.g. 7 for this 7/4 at double time), `tempo_hint_bpm`
  (roughly the detected pulse), `snippets` (e.g. the Instagram section).
- `actors.csv`: one row per actor. Columns: actor, spot, gender, age (years), weight/muscle (0-100, 50 = average),
  height_m, african/asian/caucasian (MakeHuman blend, sums to 100), hair (short01-04, bob01-02, long01, braid01,
  ponytail01, afro01), hair_tint (#FFFFFF = natural), eyebrows (eyebrow001-012), skin (hex), costume (robe),
  costume_color (hex), lean_deg, reach (1.0 = exact), arm_offset_deg, sync_lag (0-1 share of the looseness slider).
  Edit in Numbers/Excel, export CSV, upload. Claude can also read .numbers files.
- `choreography.json`: positions (arm angles + head), final pose, step pattern, formations (`wide` for 16:9,
  `compact` for vertical/square). Spot names in actors.csv must exist in every formation.
- `look.json`: start from the previous clip's, or leave `{}` for defaults.

New capabilities (a different costume, props, a background, new music mappings) are engine/tool changes:
make them on a branch, keep them generic, document them here.

## 2. Analyse
`python3 tools/analyze.py clips/<clip>` prints the pulse, grid fit, bar-phase scores, music start/end and a
suggested ending start. Check:
- grid_fit_max_error_s below ~0.05 s means a steady tempo. If it is large, the tempo moves and the straight grid
  will drift (needs a tempo map, not built yet).
- bar_phase is a guess from bass accents. If "1" feels wrong in the preview, fix it by ear
  (Downbeat position slider), then pin it in `track.json` under `grid_override`.

## 3. Build and preview
```
python3 tools/build_actors.py clips/<clip>     # only when actors.csv changes (takes a minute)
python3 tools/build_pages.py  clips/<clip>     # every time a config or the engine changes
python3 tools/smoke_test.py   clips/<clip> --times 2 60 120 --render 60   # Claude checks before showing
```
Claude publishes `build/<clip>/preview.html` as an artifact (must stay under 16 MB).

## 4. Tune
You play with the sliders, press **Copy settings** and paste the JSON into the chat.
Claude saves it as `clips/<clip>/look.json`, rebuilds, republishes. Repeat with actors/choreography as needed.

## 5. Render (your Mac)
Claude hands you `build/<clip>/renderer.html`. Open it in Chrome, keep the tab in front.
- Whole song, 16:9, with your master (WAV/AIFF/FLAC) for DistroVid / YouTube.
- Snippet, 9:16 (Reels) or 4:5 (feed) for Instagram. Portrait/square uses the `compact` formation.
The master must start at the same point as the analysed audio.

## 6. Commit
Commit `clips/<clip>/` (configs only, audio is ignored) and any engine/tool changes, with a message saying what
changed. Tag a release when a clip is final, e.g. `git tag clip-05-final`.

## Known limits
- Rendering is in the browser on your GPU; Claude's container has none (several seconds per frame there).
- Choreography is a loop: positions cycle per bar, steps per bar, one optional turn; start fade-in and ending
  bow/fade are the only section-aware behaviour.
- Costumes: only `robe` (generated from MakeHuman's fitting helpers; a sash hides the waist seam).
- Backgrounds: only the built-in glowing backdrop; the background designer is still to be built (stage.js).
