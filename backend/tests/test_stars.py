"""Gaia star lists: parsing of the ESA TAP CSV answer (network replaced, never called)."""
import httpx
import pytest

from skyblink import stars

CSV = (
    "source_id,ra,dec,pmra,pmdec,phot_g_mean_mag,parallax,bp_rp\n"
    "4472832130942575872,269.4485,4.7394,-801.55,10362.39,8.19,546.98,2.83\n"
    "123,269.4400,4.7300,1.2,-0.5,18.7,,\n"
)


class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


@pytest.fixture()
def captured(monkeypatch):
    seen = {}

    def fake_post(url, data=None, timeout=None):
        seen["query"] = data["QUERY"]
        return _Resp(CSV)

    monkeypatch.setattr(stars.httpx, "post", fake_post)
    return seen


def test_gaia_stars_parses_parallax_and_colour(captured):
    got = stars.gaia_stars(269.45, 4.74, 0.07)
    assert got[0]["parallax"] == pytest.approx(546.98)
    assert got[0]["bp_rp"] == pytest.approx(2.83)


def test_missing_parallax_and_colour_are_none(captured):
    got = stars.gaia_stars(269.45, 4.74, 0.07)
    assert got[1]["parallax"] is None
    assert got[1]["bp_rp"] is None


def test_gaia_query_requests_new_columns(captured):
    stars.gaia_stars(269.45, 4.74, 0.07)
    assert "parallax" in captured["query"]
    assert "bp_rp" in captured["query"]


def test_existing_fields_unchanged(captured):
    s = stars.gaia_stars(269.45, 4.74, 0.07)[0]
    assert s["source_id"] == "4472832130942575872"
    assert s["ra"] == pytest.approx(269.4485) and s["dec"] == pytest.approx(4.7394)
    assert s["pmra"] == pytest.approx(-801.55) and s["pmdec"] == pytest.approx(10362.39)
    assert s["gmag"] == pytest.approx(8.19)
    assert s["epoch_mjd"] == stars.GAIA_EPOCH_MJD


def test_gaia_unreachable_returns_empty_list(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(stars.httpx, "post", boom)
    assert stars.gaia_stars(269.45, 4.74, 0.07) == []
