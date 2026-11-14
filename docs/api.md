# SkyBlink HTTP API (contract between frontend and backend)

All JSON. Images are PNG. The frontend is served from `/` by the same FastAPI app; static files live in `frontend/`.

## Coordinates and the view URL

Page URL state (shareable/embeddable): `/?ra=133.79513&dec=-7.24515&fov=0.1&det=D6&mode=stack&fps=2&target=WISE%200855`
- `ra`, `dec`: decimal degrees (ICRS). `target` (optional): free text name, resolved if ra/dec absent.
- `fov`: degrees, one of 0.05, 0.1, 0.2, 0.3, 0.5.
- `det`: D1..D6. `mode`: `stack` (one frame per survey window) or `visits` (every image).
- `embed=1` hides the header/controls except the player.

## GET /api/resolve?q=<text>
Accepts a name ("Barnard's Star"), decimal "133.795 -7.245", or sexagesimal "08h55m10.831s -7d14m42.53s" / "08:55:10.8 -07:14:42".
`200 {"ra": 133.795129, "dec": -7.245147, "name": "WISE 0855", "source": "sesame|parsed"}`; `404 {"detail": "..."}`.

## GET /api/featured
`[{"slug": "wise0855", "name": "WISE 0855−0714", "ra":..., "dec":..., "fov": 0.1, "det": "D6", "caption": "what to look for", "kind": "motion|variable"}]`

## POST /api/build  body `{"ra":..,"dec":..,"fov":0.1,"det":"D6"}`
Starts (or reuses) a build. Returns `{"key": "<hex>", "status": "done|queued|running|error"}`.
Featured targets are already `done`.

## GET /api/build/{key}
`{"key","status","progress":0..1,"message":"Fetching 12/45 cutouts","error":null}`

## GET /api/view/{key}
The manifest once status is done:
```json
{
  "key": "...", "ra": 133.795, "dec": -7.245, "fov": 0.1, "det": "D6",
  "grid": {"npix": 59, "scale_arcsec": 6.15, "ctype": "TAN", "north_up": true, "east_left": true},
  "band": {"det": "D6", "um_min": 4.42, "um_max": 5.00},
  "stretch": {"kind": "asinh", "lo": 0.01, "hi": 2.3, "unit": "MJy/sr"},
  "windows": [{"id": 0, "label": "2025-05", "mjd_start": 60800.7, "mjd_end": 60801.1, "n": 5}],
  "stacks": [{"window": 0, "png": "/api/png/<key>/stack_0.png", "mjd": 60800.9, "date": "2025-05-05", "n": 5, "um_mean": 4.7}],
  "deep": {"png": "/api/png/<key>/deep.png", "n": 45},
  "visits": [{
      "i": 0, "obs_id": "2025W19_1B_0116_1", "window": 0, "mjd": 60800.7007, "date": "2025-05-05T16:49:00",
      "um": 4.71, "um_bw": 0.037, "png": "/api/png/<key>/visit_0.png", "flags_png": "/api/png/<key>/flags_0.png",
      "file": "https://irsa.../level2_...fits", "collection": "spherex_dr1",
      "flag_frac": 0.03, "flag_counts": {"SOURCE": 12, "NONLINEAR": 0}
  }],
  "stars": [{"source_id": "...", "ra":..., "dec":..., "pmra": mas/yr, "pmdec": mas/yr, "gmag": 12.3}],
  "notes": ["Barnard's Star saturates in every band: watch the saturated core move."]
}
```
- Frame PNGs are `npix × npix`, north up, east left, row 0 = north. All frames of one view share one stretch, so they can be animated directly.
- `flags_png` is an RGBA overlay (transparent where unflagged).
- `stars` is Gaia DR3 within the FOV (may be empty); frontend projects them with a TAN projection centred on ra/dec at `scale_arcsec` per pixel.

## GET /api/diff/{key}?a=<frameRef>&b=<frameRef>
frameRef is `s<window>` (stack), `v<i>` (visit) or `deep`. Returns PNG of b − a with a symmetric stretch (red = brighter in b, blue = brighter in a).

## GET /api/spectrum/{key}?x=<col>&y=<row>
Pixel spectrum at grid pixel (row 0 = north) across every visit in every detector built for this position:
`{"x":..,"y":..,"ra":..,"dec":..,"points":[{"um":1.23,"flux":0.12,"err":0.01,"mjd":60800.7,"det":"D2","window":0}]}`
Only detectors already built for this ra/dec/fov contribute.
