# Beginner Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven beginner-facing features to SkyBlink: auto-finds, false colour, an object info card, coordinate-free entry, guided tours, GIF/card sharing and sonification.

**Architecture:** Almost everything runs in the browser from data the page already has: the float16 cube (`cube.js`), `view.stars`, and sibling detector views (`spectrum-data.js`). Pure logic lives in DOM-free modules tested with `node --test`. DOM and canvas modules are thin and checked in the browser. The only backend change is two extra Gaia columns.

**Tech Stack:** Vanilla ES modules (no build step), Canvas 2D, Web Audio, `gifenc@1.0.3` from jsDelivr, FastAPI/pytest (backend), `node:test`.

**Spec:** `C:\Users\den51\.claude\plans\gentle-jumping-turtle.md` (approved plain-language plan). Project rules: `CLAUDE.md`, `.claude/CLAUDE.md`.

## Global Constraints

- Edit `frontend/`, never `public/`. Run `python scripts/export_static.py` after frontend changes.
- Each JS module stays under 400 lines. No framework, no bundler, no `console.log`.
- External scripts come only from pinned CDN URLs: `https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js`.
- Image invariants:
  - North up, east left, row 0 = north.
  - One fixed stretch per colour channel across all frames.
  - Never blank SOURCE pixels.
- No new HTTP routes. Colour builds use the existing `POST /api/build` (rate-limited).
- Tests never touch the network. Python: `cd backend && python -m pytest`. JS: `node --test tests/js`.
- Copy wording:
  - Say "candidate", never "discovery".
  - Spectra stay labelled "visualization, not science-grade".
- Blink stays at 1 Hz.
- **No `git push` without explicit user confirmation** (push = production deploy).
- Commits follow `<type>: <description>` and are derived from `git diff --staged`.

## Review Focus

1. **A view with 0 or 1 survey windows** (common for live builds). Expect: no finds, a "needs at least two survey windows" hint, Colour still works on the single window, and nothing crashes. Tests in Tasks 3 and 6.
2. **Saturated bright stars** (Barnard's Star, R Dra: flat-topped filled cores). Expect: never labelled "variable"; motion reported only when backed by Gaia proper motion. Test in Task 3.
3. **Gaia star with null, zero or negative parallax** (common at G > 18). Expect: no distance sentence and no NaN text. Test in Task 5.
4. **Live inline view with no siblings and no other session builds.** Expect: Colour offers to build the missing detectors, and the card's spectrum words are omitted. Tests in Tasks 5 and 6.
5. **Audio unavailable or blocked** (no `AudioContext`, or autoplay policy). Expect: the "Hear it" button shows the text description and no exception escapes. Test in Task 11.

---

### Task 1: Gaia parallax and colour in star lists

**Files:**
- Modify: `backend/skyblink/stars.py` (the `gaia_stars` ADQL and row mapping)
- Create: `backend/tests/test_stars.py`
- Create: `scripts/refresh_featured_stars.py`
- Modify: `docs/api.md` (stars fields)

**Interfaces:**
- Produces: each `view.stars[]` entry gains `parallax: float|None` (mas) and `bp_rp: float|None` (mag). Existing keys are unchanged.

- [ ] **Step 1: Write the failing test** `test_gaia_stars_parses_parallax_and_colour`. Monkeypatch `skyblink.stars.httpx.post` to return a response whose `.text` is a CSV with header `source_id,ra,dec,pmra,pmdec,phot_g_mean_mag,parallax,bp_rp` and two rows (one with an empty parallax). Assert:
  - `stars[0]["parallax"] == pytest.approx(546.98)` and `stars[0]["bp_rp"] == pytest.approx(2.83)`;
  - `stars[1]["parallax"] is None`.
- [ ] **Step 2: Write the failing test** `test_gaia_query_requests_new_columns`. Capture `data["QUERY"]` from the monkeypatched `post`. Assert `"parallax"` and `"bp_rp"` are both in it.
- [ ] **Step 3:** Run `cd backend && python -m pytest tests/test_stars.py -v`. Expected: 2 FAIL.
- [ ] **Step 4:** Add `parallax, bp_rp` to the SELECT, and map them with the existing `_num` helper (empty → `None`).
- [ ] **Step 5:** Run the full `python -m pytest`. Expected: all PASS.
- [ ] **Step 6: Create `scripts/refresh_featured_stars.py`.**
  - For each `featured/*/D*/manifest.json`, call `gaia_stars(m["ra"], m["dec"], m["fov"] * sqrt(2) / 2)` once per position (cache by position folder).
  - Replace only `m["stars"]`, and write it back with `storage.atomic_write`.
  - It prints the number of manifests updated and makes 5 network calls (ESA only).
- [ ] **Step 7:** Run `python scripts/refresh_featured_stars.py`, then `python scripts/export_static.py`. Expected: "updated 30 manifests"; `featured/e01445dc3f16/D6/manifest.json` stars contain `parallax`.
- [ ] **Step 8:** Add `parallax` and `bp_rp` to the `stars` description in `docs/api.md`. Commit: `feat: add Gaia parallax and colour to star lists`.

### Task 2: Mock data for every new feature

**Files:**
- Modify: `frontend/mock/generate_mock.py`, `frontend/js/mock.js` (regenerates `frontend/mock/view.json`, `cube.bin`, `png/*`)

**Interfaces:**
- Produces mock data with the following properties:
  - The D6 mock view has ≥3 stacks.
  - One source moves +2 px in x across stacks.
  - One source doubles in flux from stack 0 to the last stack.
  - One source is static.
  - `stars` includes one entry matching the moving source, with `pmra/pmdec/parallax/bp_rp`.
  - `siblings` lists `D1`, `D3`, `D6`, and `mock.js` serves `/api/view/<sibling>` with rescaled cubes (the existing rescale path).

- [ ] **Step 1:** Edit `generate_mock.py` to inject the moving, brightening and static sources into the stack and deep planes, and add `parallax` and `bp_rp` to the mock stars. Run `python frontend/mock/generate_mock.py`. Expected: files regenerate with no error.
- [ ] **Step 2:** Run `python frontend/mock/serve.py 8000` and open `/?mock=1`. Expected: the page loads as before, with no page errors (headless check with Playwright).
- [ ] **Step 3:** Commit: `test: richer mock data for finds, colour and cards`.

### Task 3: Detection logic — `detect.js`

**Files:**
- Create: `frontend/js/detect.js` (DOM-free)
- Test: `tests/js/detect.test.mjs`

**Interfaces:**
- Consumes: `project`, `propagate`, `totalPm` from `frontend/js/gaia.js`.
- Produces:
  - `robustStats(plane: Float32Array) -> {median: number, sigma: number}`, where sigma is 1.4826·MAD over finite values.
  - `findSources(deep: Float32Array, P: number, opts?: {nsigma=6, edge=2, maxSources=40}) -> {x, y, snr}[]`. These are 3×3 local maxima above median + nsigma·sigma, at least `edge` px from the border, sorted by snr descending.
  - `measure(plane: Float32Array, P: number, x: number, y: number, r=2) -> {cx, cy, flux, ok}`. This is a background-subtracted (median of a ring at radius r+2) centroid and flux sum over a (2r+1)² box. `ok=false` if more than half the box is NaN.
  - `detectFinds(view: object, stackPlanes: Float32Array[], deep: Float32Array, P: number) -> Find[]`.
  - `Find = {id: number, x: number, y: number, kind: 'moving'|'variable', shiftPx: number, arcsecPerYr: number, fluxChange: number, from: number, to: number, saturated: boolean, gaia: object|null, snr: number}`.
    - `from` and `to` are stack indices of the best pair: the largest shift for movers, the largest |Δflux| for variables.
    - `id` is 1-based in display order.
- Rules (pinned):
  - **Moving:** the centroid shift between some pair of stacks is ≥ 0.7 px, and both measurements have snr ≥ 8.
  - **Variable:** |f_b − f_a| / min(f_a, f_b) ≥ 0.25, and |Δf| ≥ 5·sigma·(2r+1).
  - **Saturated:** peak ≥ 0.98 × the deep plane's maximum finite value, or a flat top (≥ 3 pixels within 1% of the peak in the 3×3 block).
    - A saturated source is never `variable`.
    - It is `moving` only if it has a Gaia match with `totalPm ≥ 0.5″/yr`.
  - **Gaia match:** propagate each star to the stack's mean MJD, project it, and take the nearest within 1.5 px of the deep-stack position.
  - **arcsecPerYr:** `shiftPx × view.grid.scale_arcsec / (Δmjd / 365.25)`.
  - Fewer than 2 stacks → `[]`.

- [ ] **Step 1: Write the failing tests.** Build synthetic P=31 planes with a Gaussian helper (σ=1 px, sigma noise 0.01, seeded):
  - `findSources finds a 20-sigma source and ignores noise`: exactly one source within 0.5 px of (15, 15).
  - `measure recovers a sub-pixel centroid`: a source at (10.3, 12.0) gives `cx` within 0.15 of 10.3.
  - `detectFinds flags a 2 px mover`: stacks with the source at x = 14, 15, 16 give one find with `kind === 'moving'`, `shiftPx` ≈ 2 (±0.3), `from === 0` and `to === 2`.
  - `detectFinds flags a doubling source as variable`: `kind === 'variable'` and `fluxChange` ≈ 1.0 (±0.15).
  - `detectFinds ignores a static source`: `[]`.
  - `a flat-topped saturated star is never variable`: a source clipped at 5.0 whose wings grow by 40% gives no `variable` find (Review Focus 2).
  - `fewer than two stacks returns no finds`: `detectFinds(view, [plane], deep, P)` gives `[]` (Review Focus 1).
  - `a mover matching a Gaia star is labelled with it`: `gaia.source_id === 'X'`.
- [ ] **Step 2:** Run `node --test tests/js/detect.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the five exports in `frontend/js/detect.js` per the rules above.
- [ ] **Step 4:** Run `node --test tests/js`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: client-side detection of moving and variable objects`.

### Task 4: Finds UI — rings, Finds tab, plain-language list

**Files:**
- Create: `frontend/js/finds-ui.js`
- Test: `tests/js/finds-ui.test.mjs` (for `describeFind` only)
- Modify: `frontend/js/player.js` (add a `finds` overlay drawn in `render`, and `setFinds(finds)`), `frontend/js/compare.js` (add `blinkFrames(a, b)` to the returned API), `frontend/app.js`, `frontend/index.html` (Finds tab, panel, and an `ov-finds` checkbox, checked by default), `frontend/styles.css`

**Interfaces:**
- Consumes: `detectFinds`, `loadCube`, `planeFor`.
- Produces:
  - `describeFind(find: Find, view: object) -> {title: string, body: string}`. Copy is pinned:
    - Gaia mover: title `"Known star, moving {arcsecPerYr:.1f}″ a year"`. Body adds `" — one of the fastest in the sky."` when ≥ 1″/yr.
    - Mover not in Gaia: title `"Moved — not in Gaia's catalogue"`, body `"Very red or very faint in visible light. A candidate worth a closer look."`.
    - Variable: title `"Got {pct}% brighter"` or `"Got {pct}% fainter"`, body `"between {dateA} and {dateB} — likely a variable star."`.
  - `renderFinds(listEl: HTMLElement, finds: Find[], view: object, onPick: (find) => void)`. It renders an empty state `"Nothing obviously moved or changed brightness here."`, or for fewer than 2 windows `"Finds need at least two survey windows."`.
  - `player.setFinds(finds: Find[])`: rings of radius `max(6, zoom*2.5)` px with their number, drawn when `overlays.finds` is true.
  - `compare.blinkFrames(a: number, b: number)`: switches to the Blink tool with A/B preset, and starts blinking.
- The app runs detection after `loadFrames` succeeds in stack mode, and only once per view key (cached in a `Map`).

- [ ] **Step 1: Write the failing tests** for `describeFind`: a Gaia mover with `arcsecPerYr: 10.4` gives a title starting `"Known star, moving 10.4″ a year"` and a body that includes `"fastest"`; a non-Gaia mover gives a title that includes `"not in Gaia"`; a variable with `fluxChange: 0.45` gives a title of `"Got 45% brighter"`.
- [ ] **Step 2:** Run `node --test tests/js/finds-ui.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `describeFind` and `renderFinds`; add `player.setFinds` and the `finds` overlay; add `compare.blinkFrames`.
- [ ] **Step 4:** In `app.js`, after frames load, run detection, then `player.setFinds`, then `renderFinds`. On pick: `player.select({x: round(x), y: round(y)})`, `compare.blinkFrames(from, to)`, and open the info card (wired in Task 5). The `ov-finds` checkbox toggles `setOverlay('finds', …)`. Move the featured/home code into `frontend/js/home.js` (`loadFeatured` and gallery rendering) so `app.js` stays under 400 lines.
- [ ] **Step 5:** Run `node --test tests/js`. Then run the mock in a headless browser: rings visible, Finds tab lists the mover and the variable, no page errors.
- [ ] **Step 6:** Commit: `feat: Finds tab with auto-marked movers and variables`.

### Task 5: Object info card — `describe.js` and `objectcard.js`

**Files:**
- Create: `frontend/js/describe.js` (DOM-free), `frontend/js/objectcard.js`
- Test: `tests/js/describe.test.mjs`
- Modify: `frontend/app.js` (`onPixel` → card + spectrum), `frontend/index.html` (an `#object-card` region at the top of `panel-info`), `frontend/styles.css`

**Interfaces:**
- Produces in `describe.js`:
  - `starType({gmag, bp_rp, parallax}) -> {label, blurb} | null`. Rules, with M_G = gmag + 5·log10(parallax/100), in order:
    - `bp_rp < 0.3` → "Hot blue star".
    - M_G > 10 and `bp_rp < 1.0` → "White dwarf".
    - `bp_rp ≥ 1.0` and M_G < 2 → "Red giant".
    - `bp_rp ≥ 1.8` → "Red dwarf: a small, cool star".
    - `0.6 ≤ bp_rp < 1.0` → "Sun-like star".
    - `1.0 ≤ bp_rp < 1.8` → "Orange (K-type) star".
    - else "White or yellow-white star".
    - Return `null` if `bp_rp` is null. The M_G rules are skipped when parallax ≤ 0 or null.
  - `distanceText(parallaxMas) -> string | null`. Null if parallax is null or < 0.2. ly = 3261.56/parallax, rounded to 2 significant figures (1 decimal below 10). Returns `"About {ly} light-years away."`, plus `" The light you see left it around {2026 − round(ly)}."` when ly < 500.
  - `speedText(star) -> string | null`. pm = `totalPm(star)`; null if pm < 0.02. Returns `"Moves {pm:.2f}″ a year across the sky — it would cross the full Moon's width in about {round(1865/pm)} years."`. When parallax ≥ 0.2, prepend `"Travels about {round(4.74*pm/(parallax/1000))} km/s sideways. "`.
  - `spectrumWords(points: {um, flux}[]) -> string | null`. Compare the median flux at `um < 1.6` with that at `um > 3.5` (each needs ≥ 3 points; otherwise null). Ratio long/short > 2 → `"Much brighter at long infrared wavelengths — a sign it is cool (or dusty)."`; < 0.5 → `"Brighter at short wavelengths — a sign it is hot."`; else `"Similar brightness across infrared colours."`.
  - `NOT_IN_GAIA = "Not seen by Gaia in visible light — it's very cold, very faint, or hidden behind dust. Brown dwarfs look like this."`
- Produces in `objectcard.js`:
  - `nearestStar(view, x, y, mjd, tolPx=2) -> star | null` (uses `propagate` and `project`).
  - `renderObjectCard(container, {view, pixel, star, caption, spectrumPromise, onHear, onSpectrum})`. The spectrum promise fills its line when it resolves; failure leaves it out.
- `app.js`: the `onPixel` callback calls `showObjectCard(pixel)` and keeps `loadSpectrum(pixel)`. Selecting the "Frame info" tab shows the card above the existing meta list. The featured caption comes from the featured list loaded by `home.js`, matched by view key.

- [ ] **Step 1: Write the failing tests:**
  - Barnard-like `{gmag: 8.19, bp_rp: 2.83, parallax: 546.98}` → `starType` label includes `"Red dwarf"`; `distanceText(546.98)` contains `"6.0 light-years"`.
  - `{gmag: 15, bp_rp: 0.1, parallax: 1}` → `"Hot blue star"`.
  - `distanceText(null)`, `distanceText(-1)` and `distanceText(0.1)` → `null` (Review Focus 3).
  - `starType({gmag: 15, bp_rp: 1.2, parallax: null})` → `"Orange (K-type) star"`, with no throw and no NaN in the label or blurb.
  - `speedText({pmra: -801.55, pmdec: 10362.39, parallax: 546.98})` contains `"10.39″"` and `"km/s"`.
  - `spectrumWords` with long/short = 3 → contains `"cool"`; with fewer than 3 points on one side → `null` (Review Focus 4).
- [ ] **Step 2:** Run `node --test tests/js/describe.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `describe.js`, then `objectcard.js`, and wire it into `app.js`.
- [ ] **Step 4:** Run `node --test tests/js`, then a mock headless check: clicking the mover shows a card with a type, a distance and the Moon comparison.
- [ ] **Step 5:** Commit: `feat: plain-language "what am I looking at" card`.

### Task 6: False colour — `colour.js`

**Files:**
- Create: `frontend/js/colour.js` (pure functions plus one DOM helper)
- Test: `tests/js/colour.test.mjs`
- Modify:
  - `frontend/js/spectrum-data.js`: export the private `sources` as `detectorViews(view) -> {det, view: Promise}[]`, and keep `gatherSpectrum` using it.
  - `frontend/js/player.js`: add `useImages(images | null)`, which swaps the drawn frame images (null restores the originals).
  - `frontend/js/compare.js`: add a `colour` tool.
  - `frontend/index.html`: add a Colour radio and a `#colour-panel` with a build prompt.
  - `frontend/app.js`: add `buildExtraDetectors(dets)`, which calls `api.startBuild` for each missing detector and polls via `api.buildStatus` when needed. It calls `rememberView` for each result and does not change `state.det` or the current view.

**Interfaces:**
- Produces:
  - `COLOUR_DETS = {r: 'D6', g: 'D3', b: 'D1'}`.
  - `matchByDate(refMjds: number[], otherMjds: number[], maxDays=60) -> (number|null)[]`, giving the index of the nearest other MJD within maxDays for each ref.
  - `stretchByte(value: number, stretch: {lo, hi, soft}) -> number`, the same formula as the backend `to_uint8`. A non-finite value is treated as 0.
  - `colourPixels(planes: {r, g, b: Float32Array}, stretches: {r, g, b}, P: number) -> Uint8ClampedArray` (RGBA, alpha 255).
  - `colourCanvas(...)`, the same arguments, returning an HTMLCanvasElement (DOM).
  - `async loadColour(view) -> {frames: HTMLCanvasElement[], deep: HTMLCanvasElement} | {missing: string[]}`. It uses `detectorViews` and `loadCube`. Frames align with `view.stacks` (the reference is the current view's stack MJDs); a frame with no match in some channel uses that channel's deep plane.
- Behaviour:
  - In stack mode, the Colour tool calls `player.useImages(frames)`; the animation continues and the badge reads `"Colour: D1 blue · D3 green · D6 red"`.
  - Leaving the tool calls `useImages(null)`.
  - In visits mode the tool shows `"Colour works on survey stacks — switch to Stacked."`.
  - `{missing}` shows the prompt `"Colour needs {list} — build them? (about 1–2 minutes each)"` with a Build button.

- [ ] **Step 1: Write the failing tests:**
  - `matchByDate([100, 280, 460], [105, 300, 900])` → `[0, 1, null]`.
  - `stretchByte` matches the backend's 0/255 ends: `stretchByte(lo, s) === 0`, `stretchByte(hi, s) === 255`, and NaN → `stretchByte(0, s)`.
  - `colourPixels` puts a red-only signal in channel 0 of the RGBA output.
  - With one stack, `matchByDate([100], [])` → `[null]` and does not throw (Review Focus 1).
- [ ] **Step 2:** Run `node --test tests/js/colour.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `colour.js`; export `detectorViews`; add `player.useImages`, the compare Colour tool, and `buildExtraDetectors`.
- [ ] **Step 4:** Run `node --test tests/js`. Then check in the browser:
  - Mock: Colour shows a coloured animation.
  - Local server, WISE 0855 featured: the crosshair object is red.
  - A live view (mock inline) with no siblings shows the build prompt (Review Focus 4).
- [ ] **Step 5:** Commit: `feat: false-colour view from three SPHEREx detectors`.

### Task 7: Popular sights and sky-map picker

**Files:**
- Create: `frontend/js/sights.js` (data only)
- Test: `tests/js/sights.test.mjs`
- Modify: `frontend/js/aladin.js` (add `pickOnSky(container, {ra, dec, fov}, onPick) -> Promise<widget>`), `frontend/js/home.js` (render chips and a "Pick on the sky map" button), `frontend/app.js` (the pick handlers call the existing `update` and `buildAndShow` flow, like `pickFeatured`), `frontend/index.html`, `frontend/styles.css`
- Modify (only if pre-building is approved): `scripts/build_featured.py` (add a `SIGHTS` list, built with `--sights` in each sight's single `det`, and written to `featured/sights.json`), `scripts/export_static.py` (copy `sights.json`)

**Interfaces:**
- Produces:
  - `SIGHTS: {slug, name, ra, dec, fov: 0.1, det, teaser}[]`, 10 entries:
    - Orion Nebula: 83.8221, −5.3911, D3
    - Pleiades: 56.75, 24.1167, D1
    - Crab Nebula: 83.6331, 22.0145, D2
    - Andromeda core: 10.6847, 41.2690, D2
    - Whirlpool: 202.4696, 47.1952, D2
    - Ring Nebula: 283.3962, 33.0291, D3
    - Proxima Centauri: 217.4290, −62.6795, D2
    - Alpha Centauri: 219.8737, −60.8331, D4
    - Galactic Centre: 266.4168, −29.0078, D4
    - Betelgeuse: 88.7929, 7.4071, D5
  - Proxima and Alpha Centauri use positions propagated to 2025.9.
  - `pickOnSky` uses `aladin.on('click', (e) => onPick({ra: e.ra, dec: e.dec}))`. If `e.ra` is missing, it falls back to `aladin.pix2world(e.x, e.y)`.
- Behaviour:
  - Chips show the name and teaser.
  - With pre-built sights, `home.js` merges `featured/sights.json` keys so clicks are instant (`POST /api/build` returns `done` for static keys, the existing path).

- [ ] **Step 1: Write the failing test** `every sight has valid coordinates, a detector and a teaser`: 10 entries, unique slugs, 0 ≤ ra < 360, −90 ≤ dec ≤ 90, `det` in D1–D6, `fov === 0.1`, and teaser length 10–90.
- [ ] **Step 2:** Run `node --test tests/js/sights.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `sights.js`, `pickOnSky`, the chips and the map picker.
- [ ] **Step 4:** Run `node --test tests/js`. Headless browser:
  - Clicking "Orion Nebula" starts a build (mock).
  - The sky-map picker opens and a synthetic click calls `onPick`. If Aladin is unreachable headless, verify by eye in a real browser and note it.
- [ ] **Step 5 (if approved):** Run `python scripts/build_featured.py --sights` at the default concurrency, then `export_static.py`. Expected: 10 views built, failed: none.
- [ ] **Step 6:** Commit: `feat: popular sights and sky-map picker`.

### Task 8: Share — GIF and picture card

**Files:**
- Create: `frontend/js/share.js`
- Test: `tests/js/share.test.mjs` (pure helpers only)
- Modify: `frontend/index.html` (a Share button and menu beside Copy link), `frontend/app.js`, `frontend/styles.css`

**Interfaces:**
- Consumes: `player.images`, `player.adjusted`, `player.display`, `shareUrl`.
- Produces:
  - `slugify(title: string) -> string`: lowercase, `[a-z0-9-]`, max 40 characters, falling back to `'skyblink'`.
  - `cardCaption({title, kind}) -> string`: `kind === 'motion'` → `"I watched {title} move across the sky!"`; `'variable'` → `"I watched {title} change brightness!"`; else `"I explored {title} with NASA SPHEREx."`.
  - `async makeGif(player, {scale=6, fps, title}) -> Blob`:
    - Imports `gifenc` from the pinned URL.
    - Each frame is drawn the way `render` draws it (display settings, crosshair, date label), plus a footer credit `"SkyBlink · NASA SPHEREx"`.
    - Encoded with `quantize` and `applyPalette` per frame.
  - `async makeCard({title, caption, url, imgA, imgB}) -> Blob` (1200×630 PNG).
  - `async shareOrDownload(blob, filename, url)`: uses `navigator.share` when `navigator.canShare({files})` is true, otherwise downloads through an object URL.

- [ ] **Step 1: Write the failing tests:** `slugify("Barnard's Star")` → `"barnards-star"`, `slugify("")` → `"skyblink"`, and the two `cardCaption` variants.
- [ ] **Step 2:** Run `node --test tests/js/share.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `share.js` and the Share menu (Download GIF, Download picture, Share…).
- [ ] **Step 4:** Run `node --test tests/js`. Headless browser: clicking Download GIF produces a download whose filename ends in `.gif` and whose size is > 10 KB; same for the card PNG.
- [ ] **Step 5:** Commit: `feat: share as GIF or picture card`.

### Task 9: Guided tours

**Files:**
- Create: `frontend/js/tours.js` (data), `frontend/js/tour.js` (coach panel and runner)
- Test: `tests/js/tours.test.mjs`
- Modify: `frontend/js/player.js` (add `pulse(pixel)`, a 1.5 s expanding ring), `frontend/js/compare.js` (add `showDifferenceFrames(a, b)`), `frontend/js/home.js` (a "Take the tour" button on each featured card), `frontend/app.js`, `frontend/index.html` (a `#tour` dialog region), `frontend/styles.css`

**Interfaces:**
- Produces:
  - `ACTIONS = ['frame', 'play', 'pause', 'mode', 'diff', 'blink', 'pulse', 'tab', 'gaia', 'colour']`.
  - `TOURS: {[slug]: {text: string, action?: {type, ...args}}[]}` for `wise0855`, `barnard`, `epsindib`, `rwaur` and `rdra`, with 4–6 steps each.
  - `validateTour(steps) -> string[]`: errors for an unknown `type`, non-integer frame args, or empty text.
  - `startTour(slug, ctx)`, where `ctx = {player, compare, setMode, selectSideTab, setOverlay}`. It shows the dialog with Back, Next and Exit; Esc exits.
    - Under reduced motion, `play` becomes `frame` steps.
    - It ends by restoring the animation tool.

- [ ] **Step 1: Write the failing tests:** every featured slug (`wise0855`, `barnard`, `epsindib`, `rwaur`, `rdra`) has a tour; `validateTour` returns `[]` for each; `validateTour([{text: '', action: {type: 'fly'}}])` returns 2 errors.
- [ ] **Step 2:** Run `node --test tests/js/tours.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write the tour copy (the WISE 0855 steps from the spec, and the others in the same voice), the runner, `player.pulse` and `compare.showDifferenceFrames`.
- [ ] **Step 4:** Run `node --test tests/js`. Then run the WISE 0855 tour headless on the local server, clicking Next through every step, with no page errors and the last step visible.
- [ ] **Step 5:** Commit: `feat: guided tours for featured targets`.

### Task 10: Sonification — `sonify.js`

**Files:**
- Create: `frontend/js/sonify.js`
- Test: `tests/js/sonify.test.mjs`
- Modify: `frontend/js/objectcard.js` and `frontend/js/finds-ui.js` (add "Hear it" buttons), `frontend/index.html` (a Hear-it button in the Spectrum tab), `frontend/app.js`

**Interfaces:**
- Produces:
  - `toNotes(values: number[], {minHz=220, maxHz=880, step=0.28, dur=0.24}) -> {freq, start, dur}[]`. The mapping is log-pitch, linear in value between min and max; non-finite values are skipped; if all values are equal they map to the middle pitch.
  - `describeSound(values) -> string`: `"rises"`, `"falls"`, `"stays steady"` or `"wobbles up and down"`. Use the last-minus-first slope over the range (> 0.3 → rises, < −0.3 → falls), the mean absolute step size, and the spread (< 10% → steady).
  - `lightcurve(cube, view, x, y) -> number[]`: the 3×3 mean per stack.
  - `spectrumSeries(points) -> number[]`: flux sorted by `um`, binned to at most 24 values.
  - `play(notes) -> {stop(): void} | null`: returns `null`, and never throws, if `AudioContext` is unavailable or `resume()` rejects.

- [ ] **Step 1: Write the failing tests:**
  - `toNotes([1, 2, 3])` gives increasing `freq`, with the first equal to 220 and the last 880.
  - `toNotes([5, 5])` gives both at about 440 (the geometric middle).
  - NaN values are skipped.
  - `describeSound([1, 2, 3, 4])` → `"rises"`; `[1, 1.02, 0.99]` → `"stays steady"`.
  - With `globalThis.AudioContext` undefined, `play(toNotes([1, 2]))` returns `null` (Review Focus 5).
- [ ] **Step 2:** Run `node --test tests/js/sonify.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `sonify.js` and the three buttons. Each button shows `"Sound: {describeSound}"` text next to it; a second click stops playback.
- [ ] **Step 4:** Run `node --test tests/js`. Manual: Barnard's card "Hear it" plays and the text reads "stays steady"; R Dra's reads "falls" or "wobbles".
- [ ] **Step 5:** Commit: `feat: listen to brightness and spectra`.

### Task 11: Docs, export, end-to-end verification

**Files:**
- Modify: `README.md` (a "For beginners" section listing the 7 features), `docs/api.md` (already done in Task 1; check it)
- Generated: `public/` via `scripts/export_static.py`

- [ ] **Step 1:** Run `cd backend && python -m pytest` and `node --test tests/js`. Expected: all PASS.
- [ ] **Step 2:** Run `python scripts/export_static.py`. Expected: "exported N views".
- [ ] **Step 3:** Start the local server and run a headless pass at 1366 px and 390 px widths on WISE 0855, Barnard, R Dra and the mock:
  - WISE 0855 has a "Moved — not in Gaia" find within 2 px of the centre.
  - Barnard has a "Known star, moving 10" find and its card reads "6.0 light-years".
  - R Dra has no "variable" claim on the saturated core.
  - Colour makes WISE 0855 red-dominant (R > G and R > B at the centre pixel).
  - The tour completes.
  - GIF and PNG are downloaded.
  - There are no page errors.
- [ ] **Step 4:** Commit: `docs: beginner features in README`. **Stop and ask the user before pushing.**
