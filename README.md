---
title: SkyBlink
emoji: ✨
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Watch the infrared sky change with NASA SPHEREx
---

# SkyBlink

**Watch the infrared sky change, with NASA SPHEREx.** NASA Space Apps Challenge 2026.

Type a name or sky coordinates (RA/Dec) and SkyBlink plays every SPHEREx image of that patch of sky as a short, aligned animation. Things that move, like nearby stars and brown dwarfs, and things that brighten or fade, like variable stars, jump out.

## What it does

- **Coordinates in, time-lapse out.** It accepts decimal degrees, `hh:mm:ss ±dd:mm:ss`, or a name. Every image is cleaned, reprojected north-up onto one grid at SPHEREx's 6.15″ pixels, and shown on one shared brightness scale, so frames can be compared directly.
- **Stacked per detector.** By default it shows one frame per six-month survey window per detector (D1–D6, 0.75–5.0 µm). Each frame is an inverse-variance-weighted stack of every image that detector took in that window, which gives much higher signal-to-noise than a single image. You can switch to *every image* to see the raw frames.
- **Compare tools.** Blink A/B (0.5–2 swaps a second, under the WCAG flash limit), a difference image (red = brighter later, blue = brighter earlier) scaled by each pixel's own noise (S/N) or by the image scatter, a deep stack of everything, and a sharper 2MASS/AllWISE/DSS reference image of the same field.
- **Display.** Frames render in the browser from the float data cube, always on the view's one shared brightness scale: asinh, linear, square-root, log or "faint" stretch, grey/inferno/viridis/cubehelix colours, brightness and contrast, crisp or Catmull-Rom smoothed pixels, a colour bar, and a hover readout of pixel value, S/N and RA/Dec.
- **Zoom and pan.** Scroll, pinch, drag, the +/− buttons or the keyboard; double-click to fit.
- **Light curve.** Click a pixel (1×1, 3×3 or 5×5 aperture) for flux against time, coloured by wavelength; click a point to jump to that image.
- **Spectra on the fly.** Click any pixel to plot flux against wavelength from every SPHEREx image of the current detector, and add the other detectors with one click. Hover for values, colour by band or survey window, log scale, CSV download; saturated star cores are drawn hollow. SPHEREx's linear variable filters give each image its own wavelength at that pixel, read from the WCS-WAVE table.
- **Gaia DR3 overlay.** Small ticks beside each star (never on top of it) mark where Gaia predicts the star in each frame, with motion arrows for stars moving ≥ 20 mas/yr. Filter by G magnitude and proper motion; hover a star for its Gaia ID, magnitude and motion.
- **Metadata.** Every frame links to its SPHEREx file and shows the observation time, wavelength at the target, and contamination and saturation flags (as an overlay).
- **Choose the field of view** from 0.05° to 0.5°.
- **Sky atlas.** An Aladin Lite panel with Gaia DR3 and AllWISE catalogs.
- **Save.** The current frame as PNG, the animation as video (WebM/MP4), spectra and light curves as CSV.
- **Shareable and embeddable.** The whole view, including tool, display settings, overlays and the selected pixel, lives in the URL (`/?ra=133.75991&dec=-7.24225&fov=0.1&det=D6&mode=stack`), and `&embed=1` gives a bare player for iframes.

## For beginners

SkyBlink is built for people who have never touched astronomy data:

- **No coordinates needed.** Ten popular sights (Orion Nebula, Pleiades, Proxima Centauri and others) are one click away and pre-built, so they open instantly. There's also a sky map where you can click anywhere to look there.
- **"Something moved here!"** Every view is scanned automatically. Numbered rings mark anything that moved or changed brightness between surveys, and the **Finds** tab explains each one in plain words, for example "Known star, moving 10.0″ a year", "Got 69% fainter" or "Moved — not in Gaia's catalogue". These are always labelled *candidates*, never discoveries. Clicking a find blinks the two frames that show the change best.
- **"What am I looking at?"** Click anything and a card explains it:
  - what kind of star it is (from Gaia's colour and distance);
  - how far away it is, and when its light left;
  - how fast it crosses the sky ("it would cross the full Moon in about 179 years");
  - what its infrared colours say ("much brighter at long wavelengths — a sign it is cool").
- **False colour.** D1 is shown as blue, D3 as green and D6 as red, so cold brown dwarfs glow orange-red among neutral stars. For new spots, SkyBlink offers to build the missing bands.
- **Guided tours.** Each featured target has a 4–5 step walkthrough that drives the page: it plays the frames, pulses the target, opens Difference and the spectrum.
- **Share it.** Export an animated GIF of what's on screen, or a 1200×630 picture card with before and after frames and a link. On phones, these open the system share sheet.
- **Listen to the sky.** Brightness over time, or a spectrum, is played as notes (higher means brighter), each with a text description for people who can't hear it.

## Featured test targets

Each one is pre-built so it loads instantly. Positions are moved forward to about 2025.9, so fast-moving stars sit at the crosshair.

| Target | What to look for |
|---|---|
| WISE 0855−0714 (D6) | The coldest known brown dwarf, moving about 8″ a year. It is detected at 10–23σ per survey stack in D6. |
| Barnard's Star (D2) | The highest proper motion of any star, 10.4″ a year. It is saturated, but its core steps north between surveys. |
| Epsilon Indi B (D6) | A pair of brown dwarfs moving 4.7″ a year; they look very red across D1 to D6. |
| RW Aurigae (D3) | A young star with irregular dimming events. |
| R Draconis (D3) | A Mira variable with a 246-day cycle, plus water absorption in its spectrum. |

## Keeping up with new SPHEREx data

The archive collections live in one list in `backend/skyblink/config.py` (`COLLECTIONS`, which can also be set with the `SKYBLINK_COLLECTIONS` env var). When IRSA publishes a new release, add it to the front of that list. Searches cover every listed release, and the same pointing found in two releases is counted once, from the earlier release in the list. Rebuild the featured targets with `python scripts/build_featured.py`. Rebuild the popular sights with `python scripts/build_featured.py --sights`, and refresh only the Gaia star lists with `python scripts/refresh_featured_stars.py`.

## How it works

```
name/RA,Dec ──► IRSA SIA2 (spherex_dr1, spherex_qr3) ──► visits for one detector
            ──► IRSA cutout service (≤6–10 in flight, retry/backoff, on-disk cache)
            ──► subtract ZODI, mask bad FLAGS bits (keep SOURCE/saturated), median sky
            ──► reproject north-up TAN grid (astropy + reproject), wavelength map from WCS-WAVE
            ──► group into survey windows (gap > 30 d) ──► inverse-variance stacks + deep stack
            ──► one shared asinh stretch ──► PNG frames + manifest.json + arrays.npz
```

The backend is Python FastAPI (`backend/skyblink`). The frontend is plain HTML/JS with no build step (`frontend/`). The API contract is in `docs/api.md`.

## Run locally

```bash
pip install -r requirements.txt
cd backend && uvicorn skyblink.main:app --port 8000
# open http://localhost:8000
python -m pytest            # from backend/
npm test                    # from the repo root: frontend unit tests (node --test, no install)
python scripts/check_static.py   # public/ must match frontend/ (CI checks this)
```

To try the frontend without a backend, run `python frontend/mock/serve.py 8000` and open `http://127.0.0.1:8000/?mock=1`.

## Deploy (Vercel)

The repo deploys to Vercel on every push to `main`. `vercel.json` holds all the settings:

- **Static site.** `public/`, which `scripts/export_static.py` generates, holds the web page and the pre-built featured views. Rewrites map `/api/view`, `/api/png` and `/api/featured` onto those files.
- **One Python function.** `api/index.py` serves `skyblink.serverless`. A new position is built inside a single request (about 60–120 s, up to 40 images, fov 0.05° or 0.1°) and returned inline, because serverless functions have no background jobs and no disk that persists between requests.
- **Browser-side analysis.** Difference images and spectra are computed in the browser from each view's float16 data cube.

To update the featured targets or add a new data release:

```bash
python scripts/build_featured.py   # rebuilds featured/ from IRSA
python scripts/export_static.py    # refreshes public/ and backend/skyblink/static_keys.json
git add featured public backend/skyblink/static_keys.json && git commit -m "data: refresh featured" && git push
```

No secrets are needed, since every data service is public. Optional settings are listed in `.env.example`.

The `Dockerfile` runs the same app as a long-lived server, with background builds and every field-of-view size, for any container host.

## Data and credits

- Images: NASA SPHEREx, via the NASA/IPAC Infrared Science Archive (IRSA).
- Stars: ESA Gaia DR3 (ESA Gaia archive).
- Names: NED (IPAC), with CDS Sesame as a fallback.
- Sky atlas: Aladin Lite (CDS).

SkyBlink is a visualization tool. Spectra use the per-pixel wavelength lookup, which IRSA describes as being for visualization, so they are not science-grade photometry.
