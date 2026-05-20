"""Unit tests for android.list_devices / android.pull_file.

We never invoke a real adb in tests — instead we stub the subprocess.run
boundary so the dispatcher path is exercised without depending on hardware
or platform-tools install state.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from forensics_bridge.dispatcher import IpcError, dispatch
from forensics_bridge.extractors.android import _parse_devices_output


def _ok(stdout: str = "", stderr: str = "") -> SimpleNamespace:
    return SimpleNamespace(returncode=0, stdout=stdout, stderr=stderr)


def _fail(rc: int, stderr: str) -> SimpleNamespace:
    return SimpleNamespace(returncode=rc, stdout="", stderr=stderr)


def _noop(*_args, **_kwargs) -> None:
    pass


# ---------------------------------------------------------------------------
# Output parser
# ---------------------------------------------------------------------------


def test_parse_devices_handles_single_device_line() -> None:
    raw = (
        "List of devices attached\n"
        "24115RA8ECabcd1234       device usb:1-3 product:redmi_k60 model:Redmi_K60_Pro device:redmi_k60 transport_id:7\n"
    )
    devs = _parse_devices_output(raw)
    assert len(devs) == 1
    assert devs[0]["serial"] == "24115RA8ECabcd1234"
    assert devs[0]["state"] == "device"
    assert devs[0]["model"] == "Redmi_K60_Pro"
    assert devs[0]["transportId"] == "7"


def test_parse_devices_handles_empty_and_unauthorized() -> None:
    raw = (
        "List of devices attached\n"
        "\n"
        "emulator-5554            offline\n"
        "abcd1234                 unauthorized\n"
    )
    devs = _parse_devices_output(raw)
    states = {d["serial"]: d["state"] for d in devs}
    assert states == {"emulator-5554": "offline", "abcd1234": "unauthorized"}


# ---------------------------------------------------------------------------
# android.list_devices
# ---------------------------------------------------------------------------


def test_list_devices_returns_parsed_records() -> None:
    fake_stdout = (
        "List of devices attached\n"
        "24115RA8EC1234           device model:Redmi_K60_Pro transport_id:1\n"
    )
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_ok(stdout=fake_stdout),
    ):
        result = dispatch("android.list_devices", {}, _noop, _noop)

    assert isinstance(result["devices"], list)
    assert result["devices"][0]["serial"] == "24115RA8EC1234"
    assert result["devices"][0]["model"] == "Redmi_K60_Pro"


def test_list_devices_raises_when_adb_missing() -> None:
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value=None,
    ):
        with pytest.raises(IpcError) as info:
            dispatch("android.list_devices", {}, _noop, _noop)
    assert info.value.code == "ADB_NOT_INSTALLED"


def test_list_devices_explicit_adb_path_not_found() -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.list_devices",
            {"adb_path": "/nope/no/adb"},
            _noop,
            _noop,
        )
    assert info.value.code == "ADB_NOT_INSTALLED"


# ---------------------------------------------------------------------------
# android.pull_file
# ---------------------------------------------------------------------------


def test_pull_file_writes_local_path_on_success(tmp_path: Path) -> None:
    # Stage a fake "pulled" file so the post-check sees something.
    def fake_run(cmd, **_kwargs):
        # cmd = [adb, -s, serial, pull, remote, local]
        target = Path(cmd[-1])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"FAKE_DB_CONTENT_42")
        return _ok(stdout="1 file pulled\n")

    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        side_effect=fake_run,
    ):
        result = dispatch(
            "android.pull_file",
            {
                "serial": "24115RA8EC1234",
                "remote_path": "/data/data/com.android.providers.contacts/databases/contacts2.db",
                "local_dir": str(tmp_path / "out"),
            },
            _noop,
            _noop,
        )

    assert result["remote"].endswith("contacts2.db")
    assert Path(result["local"]).is_file()
    assert result["bytes"] == len(b"FAKE_DB_CONTENT_42")


def test_pull_file_permission_denied_maps_to_typed_error(tmp_path: Path) -> None:
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_fail(
            1,
            "adb: error: failed to copy '/data/data/com.x/...': "
            "remote object 'contacts2.db' does not exist\n",
        ),
    ):
        with pytest.raises(IpcError) as info:
            dispatch(
                "android.pull_file",
                {
                    "remote_path": "/data/data/com.x/databases/contacts2.db",
                    "local_dir": str(tmp_path),
                },
                _noop,
                _noop,
            )
    assert info.value.code == "EXTRACT_PERMISSION_DENIED"


def test_pull_file_device_not_found_is_retryable(tmp_path: Path) -> None:
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_fail(1, "adb: device 'abcd' not found\n"),
    ):
        with pytest.raises(IpcError) as info:
            dispatch(
                "android.pull_file",
                {
                    "serial": "abcd",
                    "remote_path": "/sdcard/x",
                    "local_dir": str(tmp_path),
                },
                _noop,
                _noop,
            )
    assert info.value.code == "DEVICE_NOT_FOUND"
    assert info.value.retryable is True


def test_pull_file_invalid_params_missing_fields(tmp_path: Path) -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.pull_file",
            {"local_dir": str(tmp_path)},  # missing remote_path
            _noop,
            _noop,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_capabilities_reports_android_extractor() -> None:
    caps = dispatch("sidecar.capabilities", {}, _noop, _noop)
    assert "android" in caps["extractors"]
    assert "android.list_devices" in caps["methods"]
    assert "android.pull_file" in caps["methods"]
    assert "android.adb_shell" in caps["methods"]
    assert "android.adb_backup" in caps["methods"]


# ---------------------------------------------------------------------------
# android.adb_shell
# ---------------------------------------------------------------------------


def test_adb_shell_returns_stdout_and_exit() -> None:
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_ok(stdout="/sdcard\n/system\n"),
    ):
        result = dispatch(
            "android.adb_shell",
            {"command": "ls -1 /"},
            _noop,
            _noop,
        )
    assert result["exitCode"] == 0
    assert "sdcard" in result["stdout"]
    assert result["command"] == "ls -1 /"


def test_adb_shell_rejects_disallowed_verb() -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.adb_shell",
            {"command": "rm -rf /"},
            _noop,
            _noop,
        )
    assert info.value.code == "INVALID_PARAMS"
    assert "allow-list" in info.value.message


def test_adb_shell_rejects_shell_composition() -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.adb_shell",
            {"command": "ls / | wc -l"},
            _noop,
            _noop,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_adb_shell_accepts_absolute_path_to_safe_verb() -> None:
    """`/system/bin/ls` should be accepted because the bare verb is `ls`."""
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_ok(stdout="ok\n"),
    ):
        result = dispatch(
            "android.adb_shell",
            {"command": "/system/bin/ls /"},
            _noop,
            _noop,
        )
    assert result["exitCode"] == 0


# ---------------------------------------------------------------------------
# android.adb_backup
# ---------------------------------------------------------------------------


def test_adb_backup_captures_ab_file(tmp_path: Path) -> None:
    def fake_run(cmd, **_kwargs):
        # cmd = [adb, ..., backup, -f, out_path, -noapk, -noshared, -nosystem, pkg]
        idx = cmd.index("-f")
        out = Path(cmd[idx + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        # Simulate a small .ab payload (header + a few bytes).
        out.write_bytes(b"ANDROID BACKUP\n5\n0\nnone\n" + b"\x00" * 64)
        return _ok(stderr="Now unlock your device and confirm the backup operation.\n")

    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        side_effect=fake_run,
    ):
        result = dispatch(
            "android.adb_backup",
            {
                "package": "com.android.providers.contacts",
                "local_dir": str(tmp_path),
                "serial": "redmi",
            },
            _noop,
            _noop,
        )
    assert result["package"] == "com.android.providers.contacts"
    assert result["bytes"] > 0
    assert Path(result["local"]).is_file()
    assert "unlock your device" in result["stderr"].lower()


def test_adb_backup_rejects_bad_package_name(tmp_path: Path) -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.adb_backup",
            {"package": "com.foo; rm -rf /", "local_dir": str(tmp_path)},
            _noop,
            _noop,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_adb_backup_password_deferred(tmp_path: Path) -> None:
    with pytest.raises(IpcError) as info:
        dispatch(
            "android.adb_backup",
            {
                "package": "com.tencent.mm",
                "local_dir": str(tmp_path),
                "password": "secret",
            },
            _noop,
            _noop,
        )
    assert info.value.code == "INVALID_PARAMS"
    assert "password" in info.value.message.lower()


def test_adb_backup_includes_apk_flag_when_requested(tmp_path: Path) -> None:
    captured = {}

    def fake_run(cmd, **_kwargs):
        captured["cmd"] = cmd
        out = Path(cmd[cmd.index("-f") + 1])
        out.write_bytes(b"ANDROID BACKUP\n5\n0\nnone\n")
        return _ok()

    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        side_effect=fake_run,
    ):
        dispatch(
            "android.adb_backup",
            {
                "package": "com.tencent.mm",
                "local_dir": str(tmp_path),
                "include_apk": True,
                "include_shared": True,
            },
            _noop,
            _noop,
        )
    assert "-apk" in captured["cmd"]
    assert "-noapk" not in captured["cmd"]
    assert "-shared" in captured["cmd"]
    assert "-nosystem" in captured["cmd"]


def test_adb_backup_device_not_found(tmp_path: Path) -> None:
    with patch(
        "forensics_bridge.extractors.android.shutil.which",
        return_value="/usr/bin/adb",
    ), patch(
        "forensics_bridge.extractors.android.subprocess.run",
        return_value=_fail(1, "adb: no devices/emulators found\n"),
    ):
        with pytest.raises(IpcError) as info:
            dispatch(
                "android.adb_backup",
                {"package": "com.x", "local_dir": str(tmp_path)},
                _noop,
                _noop,
            )
    assert info.value.code == "DEVICE_NOT_FOUND"
