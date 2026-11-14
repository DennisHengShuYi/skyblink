# SkyBlink — design (Space Apps 2026, "SPHEREx sky changes" challenge)

Date: 2026-11-15 (hackathon day 2). Supersedes the Oct 2 PRD's product scope; keeps its pipeline research.

## Intent

A public web tool: type RA/Dec (or a name), get a short looping video of aligned SPHEREx images of that patch so anyone can spot things that move or change brightness. Judges will test it on Barnard's Star, Epsilon Indi B, WISE 0855 (08h55m10.831s −7d14m42.53s), RW Aurigae and R Draconis.

## Goals (in build order — stop wherever the clock runs out, each tier is demoable)

1. **Core loop.** RA/Dec or name → list SPHEREx visits → fetch cutouts → clean → reproject to one north-up grid → shared stretch → play frames as a looping animation with a timeline scrubber. URL holds the view (`?ra=&dec=&fov=&det=&mode=`) so it can be embedded.
2. **Stacking per detector.** Default view: one frame per survey window per detector (D1–D6), a weighted mean of all that detector's visits in the window → higher S/N. Toggle to raw per-visit frames.
3. **Featured targets.** The five test targets on the home page, pre-built at the event as static files so they load instantly.
4. **Add / subtract.** Difference of any two frames (window B − window A); "sum all" deep stack.
5. **Field of view picker** (e.g. 0.1°–1°), with a warning that larger is slower.
6. **Metadata.** Per-frame provenance (file, time, detector, wavelength at target) and a flags overlay (masked / contaminated pixels from FLAGS).
7. **Overlays.** Aladin Lite panel with Gaia DR3 and AllWISE catalogs at the same position; Gaia stars' proper-motion vectors drawn on our frames.
8. **Spectrum on click.** Click a pixel → flux vs wavelength from every visit (wavelength from WCS-WAVE).
9. Stretch: Makemake parallax ruler from the old PRD.

## Non-goals

Discovery claims, user accounts, voting/flag queues, all-sky search, science-grade photometry.

## Anti-goals

- A featured target that shows nothing moving with no explanation. Each featured target gets a one-line caption of what to look for (e.g. "WISE 0855 moves ~1.3 px/yr — watch the D6 stack"; "Barnard's Star saturates; look for the moving saturated core"; RW Aur / R Dra: brightness change, not motion).
- The demo depending on a live 60-second archive query.

## Constraints

- Hours left, small team. No build step on the frontend, one deployable.
- Archive is slow (TAP 10–118 s) and cutouts carry 4–5 MB of PSF data each regardless of size; a full target is ~100 visits per survey window. **Data volume per target is the main risk** — see spike below.
- New data releases (QR2 → QR3 → …) must be a config change: collection names live in one config list.
- Parser must handle both QR2 and QR3 file layouts (FLAGS compression, PSF vs EPSF).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Python FastAPI service does all archive calls and image processing (astropy, reproject), caches rendered PNG frames on disk, and serves a static HTML/JS page with Aladin Lite. One deploy. | Uses the PRD's proven Python pipeline; server needs disk and a few minutes per new target. |
| B | Browser-only: fetch FITS cutouts client-side (AWS mirror has CORS) and reproject in JS. | No server, but no astropy/reproject in the browser — rewriting WCS-WAVE + reprojection is too much for hours left. |
| C | Old PRD stack: React + FastAPI + Supabase + Turnstile + Render. | Too many moving parts for one day; flags/voting were cut anyway. |

## Decided

- Keep the SkyBlink name and the PRD's pipeline steps (resolve → list visits → wavelength at target → cutout → zodi subtract + flag mask (never on SOURCE/FULLSAMPLE bits) → reproject north-up at 6.15″/px → flux-match → shared asinh stretch → PNG).
- Product flow follows the challenge, not the Makemake ruler.

## Builder's calls (stated so they can be corrected)

- Frontend: plain HTML + vanilla JS module, canvas animation, Aladin Lite v3 from CDN.
- Cache: on-disk under `cache/` keyed by hash(file, center, fov, grid); featured targets committed as static PNG + JSON manifest.
- Data access: IRSA TAP (`spherex.artifact` ⨝ `spherex.plane`, `producttype='science'`) for visit lists; IRSA cutout service for pixels; concurrency ≤10.
- **First task is a 30-minute spike** on WISE 0855: time the TAP query, count visits per detector per window, measure bytes per cutout. If a full target is too heavy, default to one detector (D6 for brown dwarfs) and cap visits per window.
- Tests: pytest for pure pipeline functions (coord parsing, window grouping, stacking, stretch, URL state); the archive-calling code gets one recorded-response integration test.
- Hosting: **must be deployed publicly** (judges use it unattended). Docker image on a Hugging Face Space (free, 16 GB RAM); deploy as soon as the core loop works, then redeploy per tier. Featured targets ship inside the image.
- **Featured targets come before stacking** (tiers 2 and 3 swap in practice): pre-build the five targets right after the core loop works, so the demo never waits on a live archive query. Live arbitrary coordinates stay best-effort with a visit cap and a progress message.
- **Releases:** query all collections in the config list (QR2 frozen, QR3 live since Sep 16, 2026); dedupe the same pointing across releases, preferring the newest release.
- **Saturation:** saturated pixels are never masked in the displayed frames (Barnard's Star's core must stay visible); they show up in the flags overlay and are excluded only from flux-matching and stacking weights.
