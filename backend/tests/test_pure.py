"""Unit tests for the pure (no-network) parts of the pipeline."""
import numpy as np
import pytest

from skyblink.coords import parse_coords
from skyblink.archive import Visit, dedupe_visits, group_windows
from skyblink.imaging import asinh_stretch_params, to_uint8, weighted_stack, view_key


@pytest.mark.parametrize(
    "text, ra, dec",
    [
        ("133.795129 -7.245147", 133.795129, -7.245147),
        ("133.795129, -7.245147", 133.795129, -7.245147),
        ("08h55m10.831s -7d14m42.53s", 133.795129, -7.245147),
        ("08:55:10.831 -07:14:42.53", 133.795129, -7.245147),
        ("08 55 10.831 -07 14 42.53", 133.795129, -7.245147),
    ],
)
def test_parse_coords_accepts_decimal_and_sexagesimal(text, ra, dec):
    got = parse_coords(text)
    assert got is not None
    assert got[0] == pytest.approx(ra, abs=1e-5)
    assert got[1] == pytest.approx(dec, abs=1e-5)


@pytest.mark.parametrize("text", ["Barnard's Star", "WISE 0855", "", "400 10", "10 95"])
def test_parse_coords_rejects_names_and_out_of_range(text):
    assert parse_coords(text) is None


def _visit(obs_id, det="D6", mjd=60000.0, coll="spherex_dr1"):
    return Visit(obs_id=obs_id, det=det, mjd=mjd, url=f"u/{coll}/{obs_id}", collection=coll)


def test_dedupe_prefers_earlier_collection_in_priority_list():
    a = _visit("X1", coll="spherex_qr3")
    b = _visit("X1", coll="spherex_dr1")
    c = _visit("X2", coll="spherex_qr3")
    got = dedupe_visits([a, b, c], priority=["spherex_dr1", "spherex_qr3"])
    assert {(v.obs_id, v.collection) for v in got} == {("X1", "spherex_dr1"), ("X2", "spherex_qr3")}


def test_dedupe_keeps_same_obs_id_on_different_detectors():
    got = dedupe_visits([_visit("X1", det="D1"), _visit("X1", det="D2")], priority=["spherex_dr1"])
    assert len(got) == 2


def test_group_windows_splits_on_gaps_over_30_days():
    mjds = [60800.7, 60801.0, 60980.0, 60990.0, 61150.0]
    visits = [_visit(f"X{i}", mjd=m) for i, m in enumerate(mjds)]
    windows, tagged = group_windows(list(reversed(visits)), gap_days=30)
    assert [w["n"] for w in windows] == [2, 2, 1]
    assert [v.window for v in tagged] == [0, 0, 1, 1, 2]
    assert [v.mjd for v in tagged] == sorted(mjds)
    assert all(v.window == -1 for v in visits)  # inputs untouched


def test_weighted_stack_ignores_nan_and_weights_by_inverse_variance():
    a = np.array([[1.0, np.nan]])
    b = np.array([[3.0, 5.0]])
    va = np.array([[1.0, 1.0]])
    vb = np.array([[3.0, 1.0]])
    img, var = weighted_stack([a, b], [va, vb])
    # pixel 0: (1/1*1 + 1/3*3)/(1 + 1/3) = 2/(4/3) = 1.5
    assert img[0, 0] == pytest.approx(1.5)
    assert img[0, 1] == pytest.approx(5.0)
    assert var[0, 0] == pytest.approx(0.75)


def test_weighted_stack_all_nan_pixel_stays_nan():
    img, _ = weighted_stack([np.array([[np.nan]])], [np.array([[1.0]])])
    assert np.isnan(img[0, 0])


def test_stretch_maps_into_uint8_range_and_nan_to_sky_level():
    data = np.linspace(-1, 10, 100).reshape(10, 10)
    data[0, 0] = np.nan
    params = asinh_stretch_params([data])
    out = to_uint8(data, params)
    assert out.dtype == np.uint8
    assert out[0, 0] == to_uint8(np.array([0.0]), params)[0]
    assert out.max() == 255


def test_view_key_is_stable_and_rounds_coordinates():
    k1 = view_key(133.7951291, -7.2451471, 0.1, "D6")
    k2 = view_key(133.7951292, -7.2451472, 0.1, "D6")
    assert k1 == k2
    assert k1 != view_key(133.7951291, -7.2451471, 0.2, "D6")


def test_sample_bilinear_and_nearest():
    from skyblink.imaging import sample_bilinear, sample_nearest
    arr = np.arange(16, dtype=float).reshape(4, 4)  # value = 4*row + col
    sx = np.array([1.5, 0.0, -0.6, 3.0])
    sy = np.array([2.0, 0.5, 0.0, 3.4])
    got = sample_bilinear(arr, sx, sy)
    assert got[0] == pytest.approx(9.5)
    assert got[1] == pytest.approx(2.0)
    assert np.isnan(got[2])            # outside the image
    assert got[3] == pytest.approx(15.0)  # within half a pixel of the edge: clamped
    assert list(sample_nearest(arr, np.array([1.4, 2.6]), np.array([0.0, 3.0]), fill=-1)) == [1, 15]


def test_masked_bilinear_does_not_spread_nan():
    from skyblink.imaging import masked_bilinear
    arr = np.ones((4, 4))
    arr[1, 1] = np.nan
    got = masked_bilinear(arr, np.array([1.75, 1.0]), np.array([1.75, 1.0]))
    assert got[0] == pytest.approx(1.0)  # mostly-good neighbourhood survives
    assert np.isnan(got[1])              # exactly on the bad pixel stays masked


def test_reprojection_matches_known_shift():
    """A grid offset by exactly 2 pixels east must pull pixels from 2 columns over."""
    from skyblink.imaging import grid_wcs, source_pixels, sample_bilinear
    target, n = grid_wcs(10.0, 0.0, 0.05)
    src = target.deepcopy()
    src.wcs.crpix = [src.wcs.crpix[0] + 2, src.wcs.crpix[1]]
    data = np.tile(np.arange(n, dtype=float), (n, 1))
    sx, sy = source_pixels(src, target, n)
    out = sample_bilinear(data, sx, sy).reshape(n, n)
    assert out[n // 2, n // 2] == pytest.approx(n // 2 + 2, abs=1e-6)


def test_encode_cube_layout_is_north_up_float16():
    from skyblink.imaging import encode_cube
    p = 3
    img = [np.arange(9, dtype=float).reshape(3, 3), np.full((3, 3), np.nan)]
    var = [np.ones((3, 3))] * 2
    um = [np.full((3, 3), 4.5)] * 2
    stacks = [np.zeros((3, 3))]
    deep = np.full((3, 3), 7.0)
    raw = np.frombuffer(encode_cube(img, var, um, stacks, deep), dtype="<f2")
    assert raw.size == (3 * 2 + 1 + 1) * p * p
    first = raw[:9].reshape(3, 3)
    assert first[0, 0] == 6.0  # FITS row 2 (north-most) becomes row 0
    assert np.isnan(raw[9:18]).all()
    assert raw[-1] == 7.0


def test_fill_saturated_core_uses_neighbour_max():
    from skyblink.imaging import fill_saturated
    img = np.array([[1.0, 2.0, 1.0],
                    [3.0, np.nan, 9.0],
                    [1.0, 4.0, 1.0]])
    core = ~np.isfinite(img)
    out = fill_saturated(img, core)
    assert out[1, 1] == 9.0
    assert np.isnan(img[1, 1])  # input untouched


def test_source_pixels_survive_bad_bits(tmp_path):
    """A star's wings flagged TRANSIENT+SOURCE must stay visible after cleaning."""
    from skyblink.imaging import clean_frame
    img = np.array([[0.0, 500.0], [np.nan, 0.0]])
    zodi = np.zeros_like(img)
    var = np.ones_like(img)
    source, transient = 1 << 21, 1 << 0
    flags = np.array([[transient, transient | source], [source, 0]])
    clean, v, filled = clean_frame(img, zodi, var, flags)
    assert np.isnan(clean[0, 0])           # bad and not a star: blanked
    assert clean[0, 1] > 100               # star wing kept
    assert filled[1, 0] and np.isfinite(clean[1, 0])  # saturated core filled
    assert v[1, 0] > 100 * np.nanmedian(var)  # ...with tiny stacking weight
