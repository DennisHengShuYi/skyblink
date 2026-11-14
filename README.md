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
- **Compare tools.** Blink A/B (1 Hz, under the WCAG flash limit), a difference image (red = brighter later, blue = brighter earlier), and a deep stack of everything.
- **Spectra on the fly.** Click any pixel to plot flux against wavelength from every SPHEREx image in every detector. SPHEREx's linear variable filters give each image its own wavelength at that pixel, read from the WCS-WAVE table.
- **Gaia DR3 overlay.** Shows each star's proper motion as an arrow, plus where Gaia predicts the star should be in each frame, so a moving star visibly tracks its marker.
- **Metadata.** Every frame links to its SPHEREx file and shows the observation time, wavelength at the target, and contamination and saturation flags (as an overlay).
- **Choose the field of view** from 0.05° to 0.5°.
- **Sky atlas.** An Aladin Lite panel with Gaia DR3 and AllWISE catalogs.
- **Shareable and embeddable.** The whole view lives in the URL (`/?ra=133.75991&dec=-7.24225&fov=0.1&det=D6&mode=stack`), and `&embed=1` gives a bare player for iframes.

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

The archive collections live in one list in `backend/skyblink/config.py` (`COLLECTIONS`, which can also be set with the `SKYBLINK_COLLECTIONS` env var). When IRSA publishes a new release, add it to the front of that list. Searches cover every listed release, and the same pointing found in two releases is counted once, from the earlier release in the list. Rebuild the featured targets with `python scripts/build_featured.py`.

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
```

To try the frontend without a backend, run `python frontend/mock/serve.py 8000` and open `http://127.0.0.1:8000/?mock=1`.

## Deploy

```bash
docker build -t skyblink . && docker run -p 7860:7860 skyblink
```

The repo is ready to use as a Hugging Face Space (Docker SDK). The front matter at the top of this file is its config.

## Data and credits

- Images: NASA SPHEREx, via the NASA/IPAC Infrared Science Archive (IRSA).
- Stars: ESA Gaia DR3 (ESA Gaia archive).
- Names: NED (IPAC), with CDS Sesame as a fallback.
- Sky atlas: Aladin Lite (CDS).

SkyBlink is a visualization tool. Spectra use the per-pixel wavelength lookup, which IRSA describes as being for visualization, so they are not science-grade photometry.
