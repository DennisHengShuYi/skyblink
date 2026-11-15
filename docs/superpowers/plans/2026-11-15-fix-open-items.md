# Fix Open Items on the Beginner Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user chose native execution earlier). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close every item left open after the beginner-features release: two shipped judgement calls, four checker notes, the known gaps and the nine minors.

**Architecture:** Frontend-only edits to the existing pure modules (`detect.js`, `describe.js`, `finds-text.js`, `colour.js`, `sonify.js`, `tour.js`, `aladin.js`) and their wiring in `beginner.js`. Every behaviour change gets a node test on a synthetic case first. Two measurement steps (Task 1) run in a real headless browser against the local server, because `cube.js` reads `location` and can't load in node.

**Tech Stack:** vanilla ES modules, `node --test`, Playwright (python, `PYTHONIOENCODING=utf-8`), ruff.

**Spec:** the approved plain-language plan `C:\Users\den51\.claude\plans\gentle-jumping-turtle.md` (the project has no design doc for this fix pass; `docs/superpowers/specs/2026-11-15-skyblink-design.md` is background).

## Global Constraints

- Worktree `C:\Users\den51\skyblink-beginner`, branch `feat/beginner-features`. First step: `git merge --ff-only origin/main`.
- Edit `frontend/` only, never `public/`; finish with `python scripts/export_static.py`, then `python scripts/check_static.py` must print "public/ matches frontend/".
- Before any export: this worktree's `featured/` must hold every deployed view (export deletes anything missing). Check `ls featured | wc -l` against `ls public/data` (40 views).
- Copy rule: say "candidate", never "discovery". Spectra stay labelled visualization.
- Image invariants untouched: one shared stretch per view, north up / east left, never blank SOURCE pixels.
- Blink ≤ 3 flashes/s. No secrets. Never push without the user's explicit go-ahead; before any push, fetch and message the other session (`nasa-space-x-challenge-5e`).
- Tests stay offline. Live-archive steps (Gaia refresh) run at low rate, once.
- Clean up every scratch file created for measuring.
- Suites that must stay green: `npm test` (153 at start), `cd backend && python -m pytest` (53 at start).

## Review Focus

1. Wavelength check with a missing `um_mean` (old manifests): must not flag every find as colour-mismatched.
2. Glow switched off: R Dra and RW Aur cards and tours still work, with no empty-find crash.
3. `starType` with `parallax_over_error` absent (mock data, old manifests): behaves as before.
4. Tour started twice, or closed by a view change mid-step: no stacked listeners, no step acting on a closed tour.
5. Card without sibling bands (single-band mock): no button, no error.

---

### Task 1: Measure before changing (throwaway, nothing committed)

**Files:** scratch only: `<scratchpad>/measure.py` (Playwright). Start the local server first: `cd backend && python -m uvicorn skyblink.main:app --port 8001` (background).

- [ ] **Step 1:** Fast-forward the worktree to `origin/main`; run `npm test` and `pytest` to confirm 153 / 53.
- [ ] **Step 2: Glow rate.** In the browser, for every view key in `public/data` (D1–D6 of the 5 featured + 10 sights positions), `import('/js/cube.js')` and `import('/js/detect.js')`, build `stacks/variances/deep` exactly as `beginner.js runFinds` does, then count: saturated sources found by `findSources`+`isSaturated` (use the `saturated` flag on a `detectFinds` run with glow on), and how many became `variable` finds. Output `flagged / saturated` overall and per view.
- [ ] **Step 3: Band S/N.** For WISE 0855 (`e01445dc3f16`, centre pixel) and RW Aur (`e5f4784477c4`, centre), print, per detector, `measure(deep, P, centre, centre).snr` using the existing `measure` from `detect.js`.
- [ ] **Step 4: Edge finds.** List the `detectFinds` output for `e01445dc3f16-D6` with each find's distance to the nearest field edge in px.
- [ ] **Step 5: Decide and record.** Rule: glow variability stays only if `flagged/saturated ≤ 10%`; default band changes only if another band's S/N is ≥ 1.5× the current default's and the caption still fits; edge margin rises only if an edge find is a clear artefact (not the real mover). Write the three decisions into the ledger as `Ruling:` lines and mention them in the completion report. Stop the server afterwards.

### Task 2: Wavelength match and still-Gaia flag in `detect.js`

**Files:** Modify `frontend/js/detect.js`; Test `tests/js/detect.test.mjs`.

**Interfaces:**
- Produces: `export const UM_MATCH_TOLERANCE = 0.03`; `export function wavelengthsMatch(view, from, to) → boolean` (true when either `um_mean` is missing or non-finite; else `|a−b| / min(a,b) ≤ 0.03`). Find objects gain `colourMismatch: boolean` (variables only) and `stillGaia: boolean` (movers only).
- Consumes: existing `detectFinds`, `gaiaMatch`, `totalPm`.

- [ ] **Step 1: Failing tests.** `wavelengthsMatch` returns false for `um_mean` 4.944 vs 4.688, true for 1.989 vs 1.997, true when either is missing. A synthetic variable (doubling source) on a view whose two stacks have `um_mean` 4.94/4.69 returns `colourMismatch: true`; with 1.989/1.997 `false`; with no `um_mean` `false`. A synthetic mover sitting on a still Gaia star (pm < 0.1″/yr) keeps `gaia: null` and gets `stillGaia: true`; a mover on a fast Gaia star gets `stillGaia: false`.
- [ ] **Step 2:** Run `node --test tests/js/detect.test.mjs`; expect the new tests FAIL.
- [ ] **Step 3: Implement.** `wavelengthsMatch` as specified; in `detectFinds` set `stillGaia` where the existing `gaia = null` coincidence branch fires, and `colourMismatch = !wavelengthsMatch(view, change.from, change.to)` on variable finds. Change nothing else in detection.
- [ ] **Step 4:** Full file passes.
- [ ] **Step 5 (only if Task 1 ruled glow off):** replace the glow branch so saturated sources produce no `variable` find; flip the existing glow tests to assert "no variable find for a saturated source whose wings change by 40%". If glow stays: keep the existing tests unchanged and add one asserting variable finds on saturated sources carry `saturated: true` (already true; pins the "less certain" wording trigger).
- [ ] **Step 6: Commit** `fix: finds check wavelength match and flag movers on still Gaia stars`.

### Task 3: Wording in `finds-text.js` and `describe.js`

**Files:** Modify `frontend/js/finds-text.js`, `frontend/js/describe.js`, `frontend/js/objectcard.js`; Test `tests/js/finds-ui.test.mjs`, `tests/js/describe.test.mjs`.

**Interfaces:**
- Consumes: `colourMismatch`, `stillGaia` from Task 2.
- Produces: `describeFind` titles — mover with `stillGaia` → `"Moved, but the Gaia star here doesn't"`; variable with `colourMismatch` → `"Looks different between {dateA} and {dateB}"` with a body saying the two pictures differ slightly in infrared colour so it may be colour rather than the star (no percentage); saturated variable body ends `"…estimated from its outer glow, so less certain."` `describe.js`: `NOT_IN_GAIA_MOVER` (the current text, keeps the brown-dwarf sentence) and `NOT_IN_GAIA` (plain dot: "Not in SkyBlink's Gaia star list for this field. With one view we can't tell what it is."). `objectHeadline({mover, snr})` uses `NOT_IN_GAIA_MOVER` only when `mover && !mover.stillGaia`; for `mover.stillGaia` the body is the still-star sentence.
- `finds-text.js` also exports `emptyFindsText(view) → string`: fewer than two stacks → `"Only one look at this spot so far, so nothing can have changed yet. More looks arrive as SPHEREx keeps scanning."`; else `"Nothing obviously moved or changed brightness here."`. `finds-ui.js renderFinds` uses it for both empty states.

- [ ] **Step 1: Failing tests** for each title/body above (assert titles equal, bodies contain "candidate" for movers, never "discovery", variable bodies for colour mismatch contain "infrared colour" and no "%"); `objectHeadline` with a plain dot has no "Brown dwarfs"; with a confirmed untracked mover it does; `emptyFindsText` both cases.
- [ ] **Step 2:** Run both test files; expect FAIL.
- [ ] **Step 3: Implement** as specified; thread `stillGaia` through `objectcard.js` (`untrackedMover` already carries the whole find).
- [ ] **Step 4:** Both files pass; `npm test` green.
- [ ] **Step 5: Commit** `fix: more careful wording for finds, unlisted dots and single-window views`.

### Task 4: Card stops fetching five bands per click

**Files:** Modify `frontend/js/describe.js`, `frontend/js/objectcard.js`, `frontend/js/beginner.js`; Test `tests/js/describe.test.mjs`.

**Interfaces:**
- Produces: `describe.js` `export function readColoursLabel(count, megabytesEach) → string | null` (null when `count < 1`; else `"Read its infrared colours (about N MB)"` with N = `Math.max(1, Math.round(count * megabytesEach))`).
- `renderObjectCard` ctx gains `colours: { label: string|null, load: () => Promise<string|null> }`; when `label` is set the card shows a ghost button that calls `load()` and then fills the words paragraph (or removes it on null).
- Consumes: `extraBands(view)`, `cubeMegabytes(view)`, `gatherSpectrum(view,x,y,{allBands})` from `spectrum-data.js`.

- [ ] **Step 1: Failing tests** for `readColoursLabel`: `(0, 8)` → null, `(5, 7.6)` → "…about 38 MB", `(1, 0.2)` → "…about 1 MB".
- [ ] **Step 2:** FAIL. **Step 3:** implement. In `beginner.js onPixel`: `spectrumWords` = `gatherSpectrum(view,x,y,{allBands:false}).then(r => spectrumWords(r.points))` (current + session-built bands only); `colours` = `{label: readColoursLabel(extraBands(view).length, cubeMegabytes(view)), load: () => gatherSpectrum(view,x,y,{allBands:true}).then(r => spectrumWords(r.points))}`. When `extraBands` is empty `label` is null.
- [ ] **Step 4:** tests pass. **Step 5: Commit** `fix: the card reads other bands only when asked`.

### Task 5: Colour — reduced motion, honest windows, resilient offer

**Files:** Modify `frontend/js/colour.js`, `frontend/js/beginner.js`; Test `tests/js/colour.test.mjs`.

**Interfaces:**
- Produces in `colour.js`: `export function windowNotes({ matched, sigmas }) → { unmatched: number[], noisy: number[] }` — `matched` is `{r,g,b}` arrays of stack index|null per reference window; `sigmas` is the per-window noise of the reference stacks; `unmatched` = windows where any channel is null; `noisy` = windows whose sigma exceeds 1.5× the median sigma (empty with fewer than 3 windows). `export function colourNote({unmatched, noisy}) → string|null` (e.g. `"Window 2 had no matching look in every band, so it shows the deep stack."`, `"Window 1 is noisier than the others."`, null when both empty).
- `loadColour` returns `{frames, deep, notes}` (notes from `windowNotes`/`colourNote`) or `{missing}`; a channel whose view promise rejects or cube fails counts as `missing` (uses `Promise.allSettled`) instead of throwing.
- Consumes: `robustStats` from `detect.js`.

- [ ] **Step 1: Failing tests:** `windowNotes` flags window 1 unmatched when `matched.g[1] === null`; flags noisy window 0 for sigmas `[0.03, 0.01, 0.011]`; flags nothing for equal sigmas and for two windows. `colourNote` wording for each and null for empty. `loadColour` with a detector list where D6's view promise rejects resolves (does not throw) with `missing` containing `'D6'`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. In `beginner.js colourEnter`: if `matchMedia('(prefers-reduced-motion: reduce)').matches` do not call `player.play()` (show frame 0); append `result.notes` to the success message; the "build them?" offer now lists exactly `result.missing` and stays visible when a sibling failed (remove the early hide in the catch path for a failed sibling).
- [ ] **Step 4:** tests pass. **Step 5: Commit** `fix: colour respects reduced motion and says which windows are approximate`.

### Task 6: Tours, sound, star type, sky map, finds edge

**Files:** Modify `frontend/js/tour.js`, `frontend/js/sonify.js`, `frontend/js/beginner.js`, `frontend/js/describe.js`, `frontend/js/aladin.js`, and (only if Task 1 said so) `frontend/js/detect.js`; Test `tests/js/sonify.test.mjs`, `tests/js/describe.test.mjs`, `tests/js/detect.test.mjs`.

**Interfaces:**
- `sonify.js`: `export function soundAction(current, textEl) → 'start' | 'toggle-off' | 'switch'` — `'start'` when nothing plays, `'toggle-off'` when `current.textEl === textEl`, else `'switch'`.
- `describe.js starType`: a star whose `parallax_over_error` is finite and `< 5` is treated as having no usable parallax (type from colour only); when the field is absent behaviour is unchanged.
- `tour.js`: `startTour` closes any open tour first (module-level handle), returns `{close}`; Next/Back clicks are serialised through a promise chain; `act` is awaited inside that chain; `close()` removes the key listener and is idempotent.
- `beginner.js`: keeps `{sound, textEl, timer}`; `hear` uses `soundAction`: `'switch'` stops the old sound and starts the new one in one click; the timer is cleared on stop; `onFramesLoaded` for a different view and `onHome` call the tour handle's `close()`.
- `aladin.js pickOnSky`: keeps one module-level aladin instance (and its container); later calls reuse it and only swap the current `onPick` callback, which a single click listener calls.

- [ ] **Step 1: Failing tests:** `soundAction(null, a)` → `'start'`; `({textEl:a}, a)` → `'toggle-off'`; `({textEl:a}, b)` → `'switch'`. `starType({gmag:8,bp_rp:1.3,parallax:0.5,parallax_over_error:2})` does not return "Red giant"; the same with `parallax_over_error:20` still can (use a case that reaches "Red giant" today: `gmag 6, bp_rp 1.4, parallax 2`); with the field absent unchanged. (If Task 1 raised the edge margin: a synthetic source 5 px from the edge produces no find.)
- [ ] **Step 2:** FAIL. **Step 3:** implement all of the above. **Step 4:** tests pass, `npm test` green.
- [ ] **Step 5: Commit** `fix: tours, sound handles, noisy parallax and sky map reuse`.

### Task 7: Lint

**Files:** whichever files ruff names (existing backend files).

- [ ] **Step 1:** `cd backend && python -m ruff check . --fix` then fix the remaining 3 by hand without changing behaviour (the 2 unsafe fixes are applied only after reading each diff).
- [ ] **Step 2:** `python -m ruff check .` clean; `python -m pytest` still 53 passed.
- [ ] **Step 3: Commit** `chore: clear existing ruff warnings`.

### Task 8: Default bands (only if Task 1 ruled a change)

**Files:** Modify `scripts/build_featured.py` (the `det` of the affected entry) and `featured/featured.json` (same `det` and `key`), plus `frontend/js/tours.js` only if a tour step names a band.

- [ ] **Step 1:** Change `det` and `key` (`<hash>-<DET>`) together; confirm the target view folder exists under `featured/`.
- [ ] **Step 2:** `npm test`; tours test still passes; caption still true for the new band (edit the caption if it names a band).
- [ ] **Step 3: Commit** `fix: better default band for <target>`. Skip the whole task if no change was ruled.

### Task 9: Data refresh, export, live checks

- [ ] **Step 1: Gaia retry.** `python scripts/refresh_featured_stars.py` once (it sleeps 2 s per position). If it prints "Gaia returned nothing" for the sights, leave them and note it. If it succeeds, check each refreshed manifest still has `bp_rp` (the script's query includes it).
- [ ] **Step 2:** Confirm `featured/` completeness (see Global Constraints), `python scripts/export_static.py`, `python scripts/check_static.py`.
- [ ] **Step 3: Browser checks** against the local server and the mock: card (no button on single-band mock, button on a featured view, one click loads colours), Colour with reduced motion emulated (`reduced_motion="reduce"`), tour run twice and closed via view change, two Hear buttons switching, Finds wording on WISE 0855 / R Dra / RW Aur, Andromeda single-window message, phone width 390 with no overflow, no page errors. The sky-map picker and Then & Now are checked in a real (non-headless) browser if the headless one can't load Aladin or CDS; report what was seen or that it could not be checked.
- [ ] **Step 4:** `code-review` over the diff; fix findings.
- [ ] **Step 5: Commit** `chore: re-export public/ after fixes`; stop any server; delete scratch files.
- [ ] **Step 6:** completion report; fetch `origin/main`; if newer, merge and re-run suites; message `nasa-space-x-challenge-5e`; ask the user for the go-ahead to push (a push to `main` deploys).
