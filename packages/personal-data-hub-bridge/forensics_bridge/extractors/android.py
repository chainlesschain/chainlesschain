"""ADB-backed Android extractor (thin wrapper).

Sufficient for Phase 4.5 real-device testing on Redmi 24115RA8EC. The full
sjqz extractor (ADB backup / APK downgrade / Root cp) is a larger fork target
for later sub-phases — for now we expose just what's needed to demo the
end-to-end Contacts pipeline.

Methods:
    android.list_devices  → enumerate ADB devices
    android.pull_file     → pull one file from device → host (rooted devices only
                            for /data/data paths; user-readable paths work without root)

ADB binary location:
    Found via $PATH unless params.adb_path is provided. On Windows, the
    installer-side helper typically points at the Android platform-tools
    bundle; we don't try to auto-locate vendor-specific copies.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from ..dispatcher import IpcError, register


# ---------------------------------------------------------------------------
# adb locator + invoker
# ---------------------------------------------------------------------------


def _find_adb(explicit: Optional[str]) -> str:
    """Return an absolute path to adb, or raise IpcError("ADB_NOT_INSTALLED")."""
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return str(p)
        raise IpcError("ADB_NOT_INSTALLED", f"adb_path={explicit} not found")

    found = shutil.which("adb") or shutil.which("adb.exe")
    if found:
        return found
    raise IpcError(
        "ADB_NOT_INSTALLED",
        "adb not found on PATH; pass params.adb_path or install Android platform-tools",
    )


def _run_adb(
    adb_path: str,
    args: List[str],
    timeout_s: float = 30.0,
    capture: bool = True,
) -> subprocess.CompletedProcess:
    """Run an adb subcommand. Always UTF-8."""
    try:
        return subprocess.run(
            [adb_path, *args],
            capture_output=capture,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        raise IpcError(
            "TIMEOUT",
            f"adb {' '.join(args)} exceeded {timeout_s}s",
            retryable=True,
        ) from exc
    except FileNotFoundError as exc:
        raise IpcError("ADB_NOT_INSTALLED", str(exc)) from exc


# ---------------------------------------------------------------------------
# android.list_devices
# ---------------------------------------------------------------------------


_DEVICE_LINE_RE = re.compile(r"^(\S+)\s+(\S+)(?:\s+(.*))?$")


def _parse_devices_output(stdout: str) -> List[Dict[str, Any]]:
    """Parse `adb devices -l` output into structured records."""
    devices: List[Dict[str, Any]] = []
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line or line.startswith("List of devices") or line.startswith("*"):
            continue
        m = _DEVICE_LINE_RE.match(line)
        if not m:
            continue
        serial, state, trailing = m.group(1), m.group(2), m.group(3) or ""
        # adb -l trailing format: "usb:... product:... model:... device:... transport_id:..."
        props: Dict[str, str] = {}
        for tok in trailing.split():
            if ":" in tok:
                k, v = tok.split(":", 1)
                props[k] = v
        devices.append({
            "serial": serial,
            "state": state,  # device | offline | unauthorized | bootloader | ...
            "model": props.get("model"),
            "product": props.get("product"),
            "device": props.get("device"),
            "transportId": props.get("transport_id"),
        })
    return devices


@register("android.list_devices")
def list_devices(
    params: Dict[str, Any],
    _progress: Callable[..., None],
    _chunk: Callable[..., None],
) -> Dict[str, Any]:
    """Return all ADB devices visible to the host.

    Params:
        adb_path: str (optional) — override adb binary location.

    Returns:
        {"devices": [{"serial": ..., "state": ..., "model": ..., ...}, ...]}
    """
    adb_path = _find_adb(params.get("adb_path"))
    proc = _run_adb(adb_path, ["devices", "-l"], timeout_s=10.0)
    if proc.returncode != 0:
        raise IpcError(
            "ADB_NOT_INSTALLED",
            f"adb devices failed (rc={proc.returncode}): {proc.stderr.strip()}",
        )
    return {"devices": _parse_devices_output(proc.stdout)}


# ---------------------------------------------------------------------------
# android.pull_file
# ---------------------------------------------------------------------------


@register("android.pull_file")
def pull_file(
    params: Dict[str, Any],
    _progress: Callable[..., None],
    _chunk: Callable[..., None],
) -> Dict[str, Any]:
    """Pull one file off a connected device.

    Params:
        serial: str (optional but recommended when >1 device attached)
        remote_path: str (required) — absolute path on device, e.g.
            /sdcard/Download/foo.db
            /data/data/com.android.providers.contacts/databases/contacts2.db
              (requires `adb root` on a rooted/userdebug device, OR a Mi/Termux
              copy-out workaround — see docs/design/Adapter_System_Data.md §2.1)
        local_dir: str (required) — host directory to write into.
        adb_path: str (optional)
        timeout_ms: int (optional, default 60000)

    Returns:
        {
          "remote": "<remote_path>",
          "local": "<absolute path on host>",
          "bytes": <int>
        }

    Errors:
        ADB_NOT_INSTALLED, DEVICE_NOT_FOUND, EXTRACT_PERMISSION_DENIED,
        INVALID_PARAMS, TIMEOUT.
    """
    remote = params.get("remote_path")
    local_dir_raw = params.get("local_dir")
    if not isinstance(remote, str) or not remote:
        raise IpcError("INVALID_PARAMS", "params.remote_path (string) is required")
    if not isinstance(local_dir_raw, str) or not local_dir_raw:
        raise IpcError("INVALID_PARAMS", "params.local_dir (string) is required")

    local_dir = Path(local_dir_raw)
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / Path(remote).name

    adb_path = _find_adb(params.get("adb_path"))
    base_args: List[str] = []
    serial = params.get("serial")
    if serial:
        base_args = ["-s", str(serial)]

    timeout_s = float(params.get("timeout_ms") or 60_000) / 1000.0
    proc = _run_adb(
        adb_path,
        [*base_args, "pull", remote, str(local_path)],
        timeout_s=timeout_s,
    )
    if proc.returncode != 0:
        err = (proc.stderr or "").lower()
        # adb device-absence messages take several shapes; match the substantive
        # tokens rather than full phrases ("device 'abc' not found", "no
        # devices/emulators found", "device offline").
        if (
            ("not found" in err and "device" in err)
            or "no devices" in err
            or "device offline" in err
            or "device unauthorized" in err
        ):
            raise IpcError(
                "DEVICE_NOT_FOUND",
                f"adb pull failed: {proc.stderr.strip()}",
                retryable=True,
            )
        if "permission denied" in err or (
            "remote object" in err and "does not exist" in err
        ):
            raise IpcError(
                "EXTRACT_PERMISSION_DENIED",
                f"adb cannot read {remote} (root or content provider workaround needed): {proc.stderr.strip()}",
            )
        raise IpcError(
            "EXTRACT_PERMISSION_DENIED",
            f"adb pull failed (rc={proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}",
        )

    if not local_path.exists():
        raise IpcError(
            "EXTRACT_PERMISSION_DENIED",
            f"adb pull reported success but {local_path} is missing",
        )

    return {
        "remote": remote,
        "local": str(local_path.resolve()),
        "bytes": local_path.stat().st_size,
    }


# ---------------------------------------------------------------------------
# android.adb_shell — run a read-only one-shot shell command
# ---------------------------------------------------------------------------


# Allow-list of safe shell verbs. Anything else returns INVALID_PARAMS so the
# sidecar can't be turned into a generic command-runner. If the user really
# wants to run arbitrary commands they have a shell already; this method is a
# friendly wrapper for the common forensics-style read operations.
_SHELL_SAFE_VERBS = frozenset({
    "ls", "cat", "pm", "getprop", "dumpsys", "stat", "find", "wc", "head",
    "tail", "df", "du", "whoami", "id", "echo", "settings",
})


@register("android.adb_shell")
def adb_shell(
    params: Dict[str, Any],
    _progress: Callable[..., None],
    _chunk: Callable[..., None],
) -> Dict[str, Any]:
    """Run one read-only adb shell command and return its output.

    Params:
        command: str (required) — single command line (no `;`, no `|`,
            verb must be in the safe allow-list).
        serial: str (optional) — target device.
        adb_path: str (optional)
        timeout_ms: int (optional, default 10000)

    Returns:
        {
          "exitCode": int,
          "stdout": str,
          "stderr": str,
          "command": str
        }
    """
    cmd = params.get("command")
    if not isinstance(cmd, str) or not cmd.strip():
        raise IpcError("INVALID_PARAMS", "params.command (string) is required")
    # Guard against shell composition — single command, single verb.
    if any(tok in cmd for tok in (";", "|", "&", "`", "$(", ">", "<")):
        raise IpcError(
            "INVALID_PARAMS",
            "adb_shell does not allow shell composition operators",
        )
    verb = cmd.split(None, 1)[0]
    # Strip absolute-path prefix so `/system/bin/ls` matches `ls`.
    bare_verb = verb.rsplit("/", 1)[-1]
    if bare_verb not in _SHELL_SAFE_VERBS:
        raise IpcError(
            "INVALID_PARAMS",
            f"verb '{bare_verb}' not in safe allow-list: {sorted(_SHELL_SAFE_VERBS)}",
        )

    adb_path = _find_adb(params.get("adb_path"))
    base_args: List[str] = []
    serial = params.get("serial")
    if serial:
        base_args = ["-s", str(serial)]
    timeout_s = float(params.get("timeout_ms") or 10_000) / 1000.0

    proc = _run_adb(
        adb_path,
        [*base_args, "shell", cmd],
        timeout_s=timeout_s,
    )
    return {
        "exitCode": proc.returncode,
        "stdout": proc.stdout or "",
        "stderr": proc.stderr or "",
        "command": cmd,
    }


# ---------------------------------------------------------------------------
# android.adb_backup — capture a .ab file for one package (non-root path)
# ---------------------------------------------------------------------------


@register("android.adb_backup")
def adb_backup(
    params: Dict[str, Any],
    _progress: Callable[..., None],
    _chunk: Callable[..., None],
) -> Dict[str, Any]:
    """Run `adb backup` for ONE package and capture the resulting .ab file.

    IMPORTANT: This is interactive. The user must tap "Back up my data" on
    the device within ~30s of starting. Newer Android (12+) often disables
    backup for system providers entirely — in that case the .ab will be
    written but contain only the magic header (no payload). The caller
    should check `bytes` is meaningfully large (> ~1 KiB) before assuming
    success.

    Params:
        package: str (required) — package name, e.g. "com.android.providers.contacts".
        local_dir: str (required) — output directory for the .ab file.
        serial: str (optional)
        password: str (optional) — backup password (default: none)
        include_apk: bool (optional, default false)
        include_shared: bool (optional, default false)
        include_system: bool (optional, default false)
        adb_path: str (optional)
        timeout_ms: int (optional, default 60000)

    Returns:
        {
          "package": "...",
          "local": "<path to .ab>",
          "bytes": N,
          "stderr": "<adb output, mostly progress hints>"
        }

    Notes:
        Unpacking the .ab file is NOT done here — the format is `ANDROID
        BACKUP\\n` header + 4 lines of metadata + zlib-deflated tar payload.
        A separate sidecar method can be added later to do the unpack; for
        Phase 4.5.4 we just capture it so users can verify the backup ran.
    """
    package = params.get("package")
    local_dir_raw = params.get("local_dir")
    if not isinstance(package, str) or not package:
        raise IpcError("INVALID_PARAMS", "params.package (string) is required")
    # Cheap package-name guard.
    if not re.match(r"^[a-zA-Z0-9._-]+$", package):
        raise IpcError("INVALID_PARAMS", f"invalid package name: {package}")
    if not isinstance(local_dir_raw, str) or not local_dir_raw:
        raise IpcError("INVALID_PARAMS", "params.local_dir (string) is required")

    local_dir = Path(local_dir_raw)
    local_dir.mkdir(parents=True, exist_ok=True)
    safe_pkg = package.replace(".", "_")
    out_path = local_dir / f"{safe_pkg}.ab"

    adb_path = _find_adb(params.get("adb_path"))
    base_args: List[str] = []
    serial = params.get("serial")
    if serial:
        base_args = ["-s", str(serial)]

    cli = [*base_args, "backup", "-f", str(out_path)]
    if params.get("include_apk"):
        cli.append("-apk")
    else:
        cli.append("-noapk")
    if params.get("include_shared"):
        cli.append("-shared")
    else:
        cli.append("-noshared")
    if params.get("include_system"):
        cli.append("-system")
    else:
        cli.append("-nosystem")
    cli.append(package)

    # Optional backup password — adb backup reads it from stdin via the
    # "Encrypt full backup?" prompt; passing via command line is not portable.
    # For now we leave it as no-password unless the design later requires it.
    if params.get("password"):
        # Document deferral instead of silently dropping.
        raise IpcError(
            "INVALID_PARAMS",
            "adb_backup with password not yet supported (interactive prompt)",
        )

    timeout_s = float(params.get("timeout_ms") or 60_000) / 1000.0
    proc = _run_adb(adb_path, cli, timeout_s=timeout_s)
    if proc.returncode != 0:
        err = (proc.stderr or "").lower()
        if "device not found" in err or "no devices" in err:
            raise IpcError(
                "DEVICE_NOT_FOUND",
                f"adb backup failed: {proc.stderr.strip()}",
                retryable=True,
            )
        raise IpcError(
            "EXTRACT_PERMISSION_DENIED",
            f"adb backup failed (rc={proc.returncode}): {proc.stderr.strip()}",
        )

    if not out_path.exists():
        raise IpcError(
            "EXTRACT_PERMISSION_DENIED",
            f"adb backup reported success but {out_path} is missing",
        )

    return {
        "package": package,
        "local": str(out_path.resolve()),
        "bytes": out_path.stat().st_size,
        "stderr": proc.stderr or "",
    }
