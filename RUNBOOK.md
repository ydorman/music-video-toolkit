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
  ponytail01, afro01), hair_tint (#FFFFFF = natural), eyebrows (eyebrow001-012), skin (hex), costume (robe, trousers,
  dress; see Costumes below), costume_color (hex), lean_deg, reach (1.0 = exact), arm_offset_deg, sync_lag (0-1 share of the looseness slider),
  sash_color (optional hex; see Costumes).
  Edit in Numbers/Excel, export CSV, upload. Claude can also read .numbers files.
- `choreography.json`: positions (arm angles + head), final pose, step pattern, formations (`wide` for 16:9,
  `compact` for vertical/square). Spot names in actors.csv must exist in every formation.
- `look.json`: start from a previous clip's, or `{}` for defaults.
- `scene.json` (optional): the setting, the light per section and the camera shots. Without it you get the clip 05
  studio (glowing backdrop, fixed camera). See "Sections, scenes and cameras" below.

### Costumes
Generated per actor from MakeHuman's fitting helpers (tights, skirt), skinned to the body; `costume_color` colours them.
- `robe`: long robe with wide hanging sleeves and a sash (clip 05).
- `trousers`: straight, relaxed trousers ending below the knee, with a fitted sash at the waist; bare chest.
- `dress`: light slip dress: fitted bodice with a straight neckline and thin straps, a narrow sash at the natural
  waist, and a skirt that follows the hips and ends above the knee.
Hair: every actor gets a hair-coloured cap on the scalp under the hair (coloured from the hair texture and hair_tint),
so heads don't look bald between the see-through hair cards when seen from above.
**Sash colours** (a storytelling tool): an actor with a `sash_color` always wears it. `choreography.json` `partners`
lists who is paired with whom from each `at` (as in scene.json): `[{"at":"C","blend":2,"pairs":[["m2","w1"],...]}]`.
The partner without a colour of their own takes on the other's over `blend` bars; an actor in no pair fades back to
neutral (the lone one).
The preview's **Costume colours** pickers (one cloth colour per actor, and a sash colour for actors with their own)
are saved in look.json under `colors` by spot and override actors.csv `costume_color` / `sash_color`.
The preview's **Costume** sliders (saved in look.json under `robe`): `skirt_shape` (flare), `sash_tint` (how strongly
sashes show their colours, default 0.6), `skirt_swing` (the skirt of robes and dresses trails behind steps and flares
out on turns and quick moves; 0 = off, the default), `sleeve_fullness` (robe only).

### Choreography timeline (where actors are, travel and face)
`choreography.json` `timeline` (optional): per actor spot, a list of entries from each `at` (as in scene.json):
`{"at":"B","to":[x,z],"bars":3,"face":"w1","turn_bars":1}`.
- `to`: travel there (metres; x = audience right, z = toward the audience) over `bars` (default 2), eased.
  The first entry places the actor (no travel).
- `face`: degrees (0 = audience), another actor's spot (tracked while either moves), an `[x,z]` point, or `"path"`
  (the direction of travel); turns blend over `turn_bars` (default 1). An entry without `face` keeps the last one.
- Body and feet come from a motion track simulated once at load (engine/motion.js `motionTrack`), so they obey what a
  body can do: the facing is reached at a limited turn rate and acceleration (150 deg/s, no snapping or reversing);
  feet stay planted and step - landing on the counts, half counts when travelling fast (strides up to 72 cm), at
  most 55 cm otherwise, alternating, off the count when fallen behind - whenever the body has moved or turned away
  from them; no step while spinning on the spot, up on releve or kneeling; a leg gesture gives way (over about 0.8 s)
  before the body travels; the hips lower just enough that a standing leg always reaches the floor, and sway (at most
  4 cm, smoothed) over the standing foot. Walking is its own gait: even pace (speeds up and slows down over at most
  1.2 s), steps off the counts every ~0.42 s swing, strides up to 62 cm, heel peeling off first and meeting the floor
  first, the pelvis riding highest over the standing leg; walking brings the dancer down off releve and drops leg
  gestures. Keep travel lyrical: about 6 m takes 3 bars (about 0.6 m/s at most).
- Personal space: wherever two dancers would come closer than their bodies and poses allow (a torso leaning toward
  the other, a leg reaching toward them), their positions are pushed apart, smoothly over about 2 s. An arm meeting
  another body rests on its surface instead of passing through.
- Skirts: the hem is a damped spring (about 1.4 Hz) hanging from the hips; it trails travel and sway, flares with
  turns and travel, and is carried out by a raised leg; the knees push it too, so no leg pokes through.
- Off stage: a dancer whose position is beyond 1.3x the clearing (scene `clearing_m`) is hidden in the forest, so
  entrances and exits are just timeline travel to or from such a spot.
- Preview: the ◀ ▶ buttons (or , . and the arrow keys; shift = 1 s) step one frame (1/30 s) and pause; the clock
  then shows the frame number, so a faulty frame can be named exactly.
- Check every clip after choreography changes: `python3 toolkit/tools/check_motion.py build/<clip>` samples all
  dancers at 30 fps (no rendering) and lists what a real dancer couldn't do: airborne (no foot on the floor), skate
  (a planted foot sliding), overreach (a leg too short for its target), spin/snap (turning too fast or reversing in a
  frame), limb (a bone swinging too fast), speed (travel or acceleration), crowd (bodies too close) and, for floor
  work, sink (body pushed into the floor), through (an arm or head inside another dancer's torso or head) and dart
  (a stepping foot flicking faster than a walk swings it); "airborne" counts knees, hips, chest and hands as support. Partners at
  about 0.5 m, leg kicks around 600-1100 deg/s and brief 6-10 m/s2 weight shifts into a gesture are normal.
- Actors without a timeline keep the looping step pattern and the turn from the preview.

### Movement vocabulary: poses and phrases
- **Floor work** (pose fields): `pitch` tilts the whole body forward at the pelvis (90 = face down);
  `kneel: {left|right: [knee spot in metres forward of the dancer's spot, thigh angle from vertical]}` puts that knee
  down with the shin along the floor (positive angle sits back toward the heels, 0 upright on the knees, -90 lying
  flat); the pelvis goes where the kneeling thighs put it. Keep the knee spot the same across consecutive floor poses
  (the knees stay put). Arms reaching into the floor rest on it. Base poses for getting up from lying face down, in
  order: `prone`, `prone_lift`, `all_fours`, `child`, `sit_heels`, `sit_open`, `high_kneel`, `kneel_R`, then standing.
  `wide`: metres each foot steps out (a wide stance; the feet step there).
- Phrase keys take `dur` (counts the move into the pose takes) for slow floor work; a phrase with `"once": true`
  plays once and holds its last pose (no loop back to the start).
- **Poses** (base library in `engine/vocab.js`; a clip adds or overrides in `choreography.json` `poses`): `arms` (both) or
  `left`/`right` ([raise to side, raise forward, elbow forward, elbow in-plane, palm twist], as seen from the audience),
  `head` [bow, tilt], `torso` [bend forward, bend toward the audience's right, twist], `plie`/`releve` (0-1),
  `leg.left`/`leg.right` [direction: 0 front, 90 out to its side, 180 back; height in degrees; knee bend 0-1], `turn`
  (degrees turned while moving into the pose), `base` (start from another pose). `name_L` mirrors `name_R`.
  Library: stand, prep, first, second, fifth, demi_plie, releve, reach_R, open_heart, curl, port_fwd, cambre,
  side_bend_R, tendu_R, developpe_R, arabesque_R, attitude_R, retire_R, pirouette_R, promenade_R, lunge_R, bow.
- **Phrases** (`choreography.json` `phrases`): `{"bars":2,"keys":[{"at":1,"pose":"curl"},{"at":8,"pose":"prep"},...]}`;
  `at` counts from 1 across the phrase's bars (bar 2 starts at count 16 in 15/8). Each pose arrives on its count; the
  move takes the preview's Transition share of the gap before it. Phrases loop, aligned to the bar their entry starts in.
- A timeline entry's `phrase` starts a phrase, blending from the previous over `phrase_blend` bars (0.5).
- While an actor travels or turns by the timeline, leg gestures drop out and plie/releve soften, so the steps stay clean:
  turn dancers in place with a phrase `turn` (e.g. pirouette_R) rather than a timeline `face` change mid-solo.
- Actors without a phrase keep the looping arm positions. The ending bow blends every pose into the final pose.

New capabilities (another costume, props, a background, new music mappings) are toolkit changes:
make them in the toolkit repo, keep them generic, document them here, then update the submodule in the project.

### Sections, scenes and cameras
- **Sections** (`track.json` `sections`: `[{"name":"Intro","bars":2},{"name":"A","bars":4},...]`) are counted in bars
  from bar 1 of the grid. The preview shows the current section and has a button to jump to each one. Anything
  timed in scene.json can say `"at": "C"` (start of C), `"C+2"` (2 bars into C) or a time in seconds.
  `accents` (optional) lists the accented counts within the bar, for the choreography.
- **Environment**: `"environment": "studio"` (default, the clip 05 backdrop) or an outdoor preset. Outdoor scenes
  share one generic system: ground, sky, fog, sun with dappled light, light shafts, mist, particles, light keyframes,
  palette. A preset adds its content and defaults; so far `"jungle"` (a procedural rain forest: trunks, understory,
  palms, epiphytes, leafy vines, canopy, leaf litter, distant forest). A new setting = a new preset in
  `ENV_PRESETS` (engine/scene.js) plus its content generator, not a new editor.
  `settings` overrides the preset's parameters (jungle: seed (different seed = different forest), clearing size and
  centre, trunks, understory, canopy, canopy height, vines, fog, default sun direction, `moonlight` (cool dappled
  light that keeps night sections readable, fading out as day comes), `particle_count` (fireflies, spread through
  the whole forest and dimmer with distance)). `palette` sets the light
  colours: `night`, `dawn`, `day` (blended by the day level), `haze` (tints the fog), `cool`, `warm`.
  The set is kept clear along the whole camera path (a corridor around the flight and the view ahead of the lens).
- **Light keyframes** (`light`): each entry holds from its `at` until the next and blends in over `blend` bars.
  Keys: `day` (0 night .. 1 full day), `sun` (direct sun and shafts), `shafts`, `sweep` (how far the sun swings
  with the sound's brightness), `spread` (1 = shafts all over the clearing, small = one focused shaft),
  `particles` (fireflies in the jungle; they sparkle on note onsets), `mist` (also thickens with noisier sound),
  `cool`, `warm`, `elevation`/`azimuth` (sun direction, degrees). Loudness, fade-in and ending come from look.json.
  The preview's **Scene** sliders scale these for the whole clip and are saved in look.json under `scene`.
- **Cameras** (`cameras`): one entry per key, held until the next: `pos`, `look`, `fov` (vertical, 16:9).
  - `to` (where the shot ends) + `path` `"line"` or `"arc"` (around the look point): a move eased over the shot.
  - `"glide": true`: fly smoothly from this pose to the next entry's pose. Consecutive glide entries are one
    continuous flight through all their poses (it only slows at the start and end of the chain). To glide into a
    cut, end the chain with an entry at the cut time and put the next shot at the same `at`.
  - `"cut": false` + `blend` (bars): blend from the previous shot instead of cutting.
  - `camera_sway` (default 1) adds a slow handheld breath.
  In the preview: **Director** plays these shots exactly as they will render. **Free** hands you the camera
  (drag = orbit, shift-drag = pan, scroll = zoom; the render ignores it) and starts from the director's current
  view. **Copy camera shot** copies the current view with its position in the music (`at` to the nearest quarter
  bar, plus `t` in seconds). For a move, copy the start and end views. Portrait renders widen the view
  automatically (per-shot portrait framing is still to come).

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
- Choreography: travel and facing can follow the sections (timeline); actors with phrases dance poses on the
  counts (no partner contact yet); others cycle the arm positions with one optional turn; the ending bow is section-aware.
- Costumes: `robe`, `trousers`, `dress` (generated from MakeHuman's fitting helpers, not cloth-simulated: the skirt
  swing is a morph driven by the hips' recent movement, so it shows most with quick steps and turns).
- Backgrounds: the studio backdrop or an outdoor preset (so far the procedural jungle; engine/scene.js).
- The smoke test skips the web fonts (not reachable from the container), so its screenshots use fallback fonts.
