"""Unit tests for system.parse_wifi.

Covers both XML (Android 8+ WifiConfigStore.xml) and legacy wpa_supplicant.conf
shapes, plus the password-is-NOT-stored privacy invariant from
Adapter_System_Data.md §3.4.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Dict, List

import pytest

from forensics_bridge.dispatcher import IpcError, dispatch
from forensics_bridge.parsers.system import parse_wifi  # noqa: F401 (registers)


WIFI_CONFIG_XML = """\
<?xml version='1.0' encoding='UTF-8'?>
<WifiConfigStoreData>
  <NetworkList>
    <Network>
      <WifiConfiguration>
        <string name="SSID">"Home_5G"</string>
        <string name="PreSharedKey">"supersecret"</string>
        <string name="KeyMgmt">WPA-PSK</string>
        <boolean name="HiddenSSID">false</boolean>
      </WifiConfiguration>
    </Network>
    <Network>
      <WifiConfiguration>
        <string name="SSID">"Starbucks Free"</string>
        <string name="KeyMgmt">NONE</string>
        <boolean name="HiddenSSID">false</boolean>
      </WifiConfiguration>
    </Network>
    <Network>
      <WifiConfiguration>
        <string name="SSID">"Office_Secret"</string>
        <string name="PreSharedKey">"another"</string>
        <string name="KeyMgmt">WPA-PSK</string>
        <boolean name="HiddenSSID">true</boolean>
      </WifiConfiguration>
    </Network>
  </NetworkList>
</WifiConfigStoreData>
"""

WPA_SUPPLICANT_CONF = """\
network={
  ssid="Legacy_AP"
  psk="legacypassword"
  key_mgmt=WPA-PSK
}

network={
  ssid="OpenGuest"
  key_mgmt=NONE
}
"""


@pytest.fixture
def xml_only_dir(tmp_path: Path) -> Path:
    (tmp_path / "WifiConfigStore.xml").write_text(WIFI_CONFIG_XML, encoding="utf-8")
    return tmp_path


@pytest.fixture
def conf_only_dir(tmp_path: Path) -> Path:
    (tmp_path / "wpa_supplicant.conf").write_text(WPA_SUPPLICANT_CONF, encoding="utf-8")
    return tmp_path


@pytest.fixture
def both_dir(tmp_path: Path) -> Path:
    (tmp_path / "WifiConfigStore.xml").write_text(WIFI_CONFIG_XML, encoding="utf-8")
    (tmp_path / "wpa_supplicant.conf").write_text(WPA_SUPPLICANT_CONF, encoding="utf-8")
    return tmp_path


def _drain(data_path: str, **extra):
    chunks: List[Dict] = []

    def on_chunk(b):
        chunks.append(b)

    result = dispatch(
        "system.parse_wifi",
        {"data_path": str(data_path), **extra},
        lambda *a, **k: None,
        on_chunk,
    )
    return result, chunks


# ---------------------------------------------------------------------------
# XML path
# ---------------------------------------------------------------------------


def test_xml_extracts_three_places(xml_only_dir: Path) -> None:
    result, chunks = _drain(str(xml_only_dir))
    places = [p for c in chunks for p in c["places"]]
    assert result["status"] == "ok"
    assert result["totalPlaces"] == 3
    assert {p["name"] for p in places} == {"Home_5G", "Starbucks Free", "Office_Secret"}
    assert {p["type"] for p in places} == {"place"}
    assert {p["category"] for p in places} == {"wifi"}


def test_password_NEVER_stored(xml_only_dir: Path) -> None:
    """Even though XML has PreSharedKey, the password text must never appear."""
    _, chunks = _drain(str(xml_only_dir))
    places = [p for c in chunks for p in c["places"]]
    serialized = repr(places)
    assert "supersecret" not in serialized
    assert "another" not in serialized
    # But password presence flag should be set
    home = next(p for p in places if p["name"] == "Home_5G")
    assert home["extra"]["passwordStored"] is True
    starbucks = next(p for p in places if p["name"] == "Starbucks Free")
    assert starbucks["extra"]["passwordStored"] is False


def test_hidden_flag_propagates(xml_only_dir: Path) -> None:
    _, chunks = _drain(str(xml_only_dir))
    by_name = {p["name"]: p for c in chunks for p in c["places"]}
    assert by_name["Office_Secret"]["extra"]["hidden"] is True
    assert by_name["Home_5G"]["extra"]["hidden"] is False


def test_security_type_classification(xml_only_dir: Path) -> None:
    _, chunks = _drain(str(xml_only_dir))
    by_name = {p["name"]: p for c in chunks for p in c["places"]}
    assert by_name["Home_5G"]["extra"]["securityType"] == "WPA/WPA2"
    assert by_name["Starbucks Free"]["extra"]["securityType"] == "OPEN"


def test_place_id_is_stable_sha_prefix(xml_only_dir: Path) -> None:
    _, chunks = _drain(str(xml_only_dir))
    home = next(
        p for c in chunks for p in c["places"] if p["name"] == "Home_5G"
    )
    expected_hash = hashlib.sha1(b"Home_5G").hexdigest()[:12]
    assert home["id"] == f"place:wifi:{expected_hash}"
    assert home["source"]["originalId"] == "Home_5G"


def test_aliases_required_field_present_and_empty(xml_only_dir: Path) -> None:
    """Place schema requires aliases (possibly empty array). Sidecar must always emit."""
    _, chunks = _drain(str(xml_only_dir))
    for c in chunks:
        for place in c["places"]:
            assert place["aliases"] == []


def test_stats_breakdown(xml_only_dir: Path) -> None:
    result, _ = _drain(str(xml_only_dir))
    stats = result["stats"]
    assert stats["with_password"] == 2  # Home_5G + Office_Secret
    assert stats["hidden"] == 1
    assert stats["wpa"] == 2
    assert stats["open"] == 1
    assert stats["wep"] == 0


# ---------------------------------------------------------------------------
# Legacy wpa_supplicant.conf path
# ---------------------------------------------------------------------------


def test_conf_extracts_legacy_networks(conf_only_dir: Path) -> None:
    result, chunks = _drain(str(conf_only_dir))
    places = [p for c in chunks for p in c["places"]]
    assert result["totalPlaces"] == 2
    names = {p["name"] for p in places}
    assert names == {"Legacy_AP", "OpenGuest"}


def test_conf_does_not_leak_psk(conf_only_dir: Path) -> None:
    _, chunks = _drain(str(conf_only_dir))
    serialized = repr([p for c in chunks for p in c["places"]])
    assert "legacypassword" not in serialized


# ---------------------------------------------------------------------------
# Mixed dir
# ---------------------------------------------------------------------------


def test_xml_and_conf_dedup_by_ssid(both_dir: Path) -> None:
    """Both files present + no overlapping SSIDs → unique by name = 5 (3 + 2)."""
    result, _ = _drain(str(both_dir))
    assert result["totalPlaces"] == 5


def test_direct_file_path_xml(xml_only_dir: Path) -> None:
    xml = xml_only_dir / "WifiConfigStore.xml"
    result, _ = _drain(str(xml))
    assert result["totalPlaces"] == 3


def test_direct_file_path_conf(conf_only_dir: Path) -> None:
    conf = conf_only_dir / "wpa_supplicant.conf"
    result, _ = _drain(str(conf))
    assert result["totalPlaces"] == 2


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_missing_data_path_raises_invalid_params() -> None:
    with pytest.raises(IpcError) as info:
        dispatch("system.parse_wifi", {}, lambda *a, **k: None, lambda b: None)
    assert info.value.code == "INVALID_PARAMS"


def test_nonexistent_dir_raises_invalid_params(tmp_path: Path) -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_wifi",
            {"data_path": str(tmp_path / "nope")},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_empty_dir_no_files_raises(tmp_path: Path) -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_wifi",
            {"data_path": str(tmp_path)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_unknown_filename_raises(tmp_path: Path) -> None:
    bad = tmp_path / "random.xml"
    bad.write_text("ignored", encoding="utf-8")
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_wifi",
            {"data_path": str(bad)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_capabilities_includes_wifi() -> None:
    caps = dispatch("sidecar.capabilities", {}, lambda *a, **k: None, lambda b: None)
    assert "system.parse_wifi" in caps["methods"]
