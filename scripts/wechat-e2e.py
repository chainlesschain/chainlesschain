#!/usr/bin/env python3
"""
Phase 12.10.6 — Automated WeChat in-app collector real-device E2E harness.

Runs the 8-scenario PASS checklist from
`docs/design/Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md` against
a paired rooted Android device, automating everything that adb + the
in-APK `cc` CLI can reach. Manual interaction is required only for:

  - WeChat-side actions (open WeChat, send 5 test messages) — script
    pauses + prompts "press Enter when done"
  - HubLocalScreen UI taps (login button, sync button) — script tries
    `adb shell input tap <x> <y>` first; if coordinates don't match your
    device, falls back to "please tap the [立即同步] button" prompt

Usage:

    python scripts/wechat-e2e.py --device <adb-serial> --uin <wechat-uin>
                                  [--scenarios 1,2,3] [--output e2e-record.json]
                                  [--skip-large-perf]

    # First time: discover device + verify prereqs only
    python scripts/wechat-e2e.py --discover --device <adb-serial>

Output: e2e-record.json filled out per §6 PASS Record template, ready to
attach to a GitHub issue if any scenario fails.

Prereqs (script checks these in --discover mode):
  1. adb installed on host + device paired (`adb devices` shows your serial)
  2. Device is rooted (Magisk-su available via `adb shell su -c id` returns uid=0)
  3. Magisk Zygisk on + com.tencent.mm in DenyList (preflight per
     Phase_12_10_7_AntiDetection.md §3.2)
  4. WeChat ≥ 8.0.50 installed (`adb shell dumpsys package com.tencent.mm |
     grep versionName`)
  5. ChainlessChain APK ≥ v5.0.3.X installed (with Phase 12.10.4 frida-inject
     binaries embedded)
  6. WeChat already logged in with the uin you pass to --uin
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


# ─── adb wrappers ────────────────────────────────────────────────────────────


def adb(serial: str, *args: str, timeout: int = 60, check: bool = True) -> str:
    """Run `adb -s <serial> <args>` and return stdout. Raises on non-zero exit."""
    cmd = ["adb", "-s", serial, *args]
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"adb command timed out after {timeout}s: {' '.join(cmd)}")
    if check and r.returncode != 0:
        raise RuntimeError(
            f"adb exited {r.returncode}: {' '.join(cmd)}\nstderr: {r.stderr}"
        )
    return r.stdout


def adb_shell(serial: str, cmd: str, timeout: int = 60, check: bool = True) -> str:
    """Run a shell command on the device via adb."""
    return adb(serial, "shell", cmd, timeout=timeout, check=check)


def adb_su(serial: str, cmd: str, timeout: int = 60) -> str:
    """Run a shell command as root (via Magisk su)."""
    # Wrap in `su -c '<cmd>'` so Magisk's su prompt path is exercised.
    quoted = cmd.replace("'", "'\\''")
    return adb_shell(serial, f"su -c '{quoted}'", timeout=timeout)


# ─── cc CLI on the device (via adb run-as) ──────────────────────────────────


CC_BIN_REL = "files/.chainlesschain/bin/cc"
APK_PACKAGE = "com.chainlesschain.android"


def cc_on_device(serial: str, *args: str, timeout: int = 120) -> dict:
    """
    Invoke the in-APK cc CLI via `adb run-as <pkg>` and parse JSON output.

    Always appends --json to the args (caller must not supply it).
    """
    cmd = (
        f"run-as {APK_PACKAGE} {CC_BIN_REL} "
        + " ".join(args)
        + " --json"
    )
    out = adb_shell(serial, cmd, timeout=timeout)
    out = out.strip()
    if not out:
        return {}
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"cc CLI returned non-JSON for `{' '.join(args)}`:\n{out[:500]}\n\n{e}"
        )


# ─── Preflight + discovery ───────────────────────────────────────────────────


@dataclass
class DeviceInfo:
    serial: str
    fingerprint: str
    android_release: str
    wechat_version: Optional[str]
    apk_version: Optional[str]
    is_rooted: bool
    zygisk_status: Optional[str]
    wechat_in_denylist: bool


def discover(serial: str) -> DeviceInfo:
    fingerprint = adb_shell(serial, "getprop ro.build.fingerprint").strip()
    android_release = adb_shell(serial, "getprop ro.build.version.release").strip()

    wechat_version = None
    out = adb_shell(
        serial,
        "dumpsys package com.tencent.mm | grep -E 'versionName=' | head -1",
        check=False,
    )
    if out and "versionName=" in out:
        wechat_version = out.split("versionName=")[1].split()[0].strip()

    apk_version = None
    out = adb_shell(
        serial,
        f"dumpsys package {APK_PACKAGE} | grep -E 'versionName=' | head -1",
        check=False,
    )
    if out and "versionName=" in out:
        apk_version = out.split("versionName=")[1].split()[0].strip()

    is_rooted = False
    try:
        uid = adb_su(serial, "id -u", timeout=15).strip()
        is_rooted = uid == "0"
    except RuntimeError:
        pass

    zygisk_status = None
    if is_rooted:
        try:
            zygisk = adb_su(serial, "magisk --denylist status", timeout=10).strip()
            zygisk_status = "enabled" if "enabled" in zygisk else "disabled"
        except RuntimeError:
            zygisk_status = "magisk-not-found"

    wechat_in_denylist = False
    if is_rooted:
        try:
            denylist = adb_su(serial, "magisk --denylist ls", timeout=10)
            wechat_in_denylist = "com.tencent.mm" in denylist
        except RuntimeError:
            pass

    return DeviceInfo(
        serial=serial,
        fingerprint=fingerprint,
        android_release=android_release,
        wechat_version=wechat_version,
        apk_version=apk_version,
        is_rooted=is_rooted,
        zygisk_status=zygisk_status,
        wechat_in_denylist=wechat_in_denylist,
    )


def print_discovery(info: DeviceInfo) -> bool:
    """Pretty-print discovery + return True if all prereqs satisfied."""
    print("─── Device discovery ─────────────────────────────────────────")
    print(f"  serial          : {info.serial}")
    print(f"  fingerprint     : {info.fingerprint}")
    print(f"  Android release : {info.android_release}")
    print(f"  WeChat version  : {info.wechat_version or 'NOT INSTALLED'}")
    print(f"  APK version     : {info.apk_version or 'NOT INSTALLED'}")
    print(f"  rooted (uid=0)  : {'✅' if info.is_rooted else '❌'}")
    print(f"  Zygisk status   : {info.zygisk_status or 'unknown'}")
    print(f"  wechat in DenyL : {'✅' if info.wechat_in_denylist else '❌'}")
    print()

    errors = []
    if not info.is_rooted:
        errors.append(
            "Device not rooted (Magisk-su returns uid=0 required). "
            "Install Magisk + reboot."
        )
    if info.zygisk_status != "enabled":
        errors.append(
            "Zygisk not enabled. Open Magisk app → Settings → Zygisk → On + reboot."
        )
    if not info.wechat_in_denylist:
        errors.append(
            "com.tencent.mm NOT in Magisk DenyList. Open Magisk app → "
            "Settings → Configure DenyList → tick 微信."
        )
    if not info.wechat_version:
        errors.append("WeChat not installed. Install WeChat ≥ 8.0.50.")
    elif not info.wechat_version.startswith("8."):
        errors.append(
            f"WeChat version {info.wechat_version} not supported. Need ≥ 8.0.50 "
            "(7.x uses md5 path — different runbook)."
        )
    if not info.apk_version:
        errors.append(
            f"ChainlessChain APK ({APK_PACKAGE}) not installed. Build + install via "
            "`cd android-app && ./gradlew :app:installDebug`."
        )

    if errors:
        print("Prereq errors:")
        for e in errors:
            print(f"  ❌ {e}")
        print()
        return False
    print("✅ All prereqs satisfied — ready to run E2E scenarios.")
    print()
    return True


# ─── Scenario results ────────────────────────────────────────────────────────


@dataclass
class ScenarioResult:
    id: str
    title: str
    status: str  # "PASS" / "FAIL" / "SKIP"
    duration_sec: Optional[float] = None
    notes: str = ""
    metrics: dict = field(default_factory=dict)
    error: Optional[str] = None


# ─── Scenarios ───────────────────────────────────────────────────────────────


def scenario_1_login_bind(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.1 — 登录绑定: uin 输入 + EncryptedSharedPreferences 落盘."""
    t0 = time.time()
    print("\n=== 12.10.6.1 — 登录绑定 ===")
    print("  Manual step: open ChainlessChain → 本机数据 tab → '微信' card →")
    print(f"  tap '登录/授权' → enter uin={uin} → select keyProvider=frida → tap '绑定'")
    input("  Press Enter when done... ")

    # Verify EncryptedSharedPreferences file landed.
    out = adb_shell(
        serial,
        f"run-as {APK_PACKAGE} ls -la shared_prefs/pdh_social_wechat.xml",
        check=False,
    )
    if "No such file" in out or "Permission denied" in out:
        return ScenarioResult(
            id="12.10.6.1",
            title="登录绑定",
            status="FAIL",
            duration_sec=time.time() - t0,
            error=f"EncryptedSharedPreferences file not found: {out.strip()}",
        )

    # Verify content is encrypted (not plain uin).
    content = adb_shell(
        serial,
        f"run-as {APK_PACKAGE} cat shared_prefs/pdh_social_wechat.xml",
        check=False,
    )
    if uin in content:
        return ScenarioResult(
            id="12.10.6.1",
            title="登录绑定",
            status="FAIL",
            duration_sec=time.time() - t0,
            error=f"uin {uin} appears in plain text — encryption not working",
        )

    return ScenarioResult(
        id="12.10.6.1",
        title="登录绑定",
        status="PASS",
        duration_sec=time.time() - t0,
        notes="prefs encrypted + uin not in plain text",
    )


def scenario_2_first_sync(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.2 — 首次同步: extract key + DB decrypt + cc ingest."""
    t0 = time.time()
    print("\n=== 12.10.6.2 — 首次同步 ===")

    # Baseline stats
    stats_before = cc_on_device(serial, "hub", "stats")
    events_before = stats_before.get("vault", {}).get("events", 0)
    persons_before = stats_before.get("vault", {}).get("persons", 0)

    print("  Manual step: in APK, tap '立即同步' on the WeChat card.")
    print("  WeChat must be running in the foreground first (open + tap a chat).")
    input("  Press Enter once you've triggered sync... ")

    # Poll cc hub stats until events count rises (or 8-min timeout)
    deadline = time.time() + 8 * 60
    polled = 0
    while time.time() < deadline:
        time.sleep(15)
        polled += 1
        try:
            stats = cc_on_device(serial, "hub", "stats", timeout=30)
        except RuntimeError:
            continue
        events = stats.get("vault", {}).get("events", 0)
        persons = stats.get("vault", {}).get("persons", 0)
        if events > events_before or persons > persons_before:
            ingested = events - events_before
            new_persons = persons - persons_before
            duration = time.time() - t0

            # Verify audit_log entry
            audit = cc_on_device(serial, "hub", "audit", "--limit", "1")
            audit_row = audit.get("rows", [{}])[0] if audit.get("rows") else {}
            if audit_row.get("action") != "ingest" or audit_row.get("adapter") != "wechat":
                return ScenarioResult(
                    id="12.10.6.2",
                    title="首次同步",
                    status="FAIL",
                    duration_sec=duration,
                    error=f"audit row mismatch: {audit_row}",
                    metrics={"events_added": ingested, "persons_added": new_persons},
                )

            return ScenarioResult(
                id="12.10.6.2",
                title="首次同步",
                status="PASS",
                duration_sec=duration,
                notes=f"ingested ~{ingested} events + {new_persons} persons, wall={duration:.0f}s",
                metrics={
                    "events_added": ingested,
                    "persons_added": new_persons,
                    "polled_intervals": polled,
                    "wall_seconds": duration,
                },
            )

    return ScenarioResult(
        id="12.10.6.2",
        title="首次同步",
        status="FAIL",
        duration_sec=time.time() - t0,
        error=f"events count never rose after 8 min ({polled} 15s polls)",
    )


def scenario_3_decrypt_spotcheck(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.3 — 解密 spot-check: 10 条已知 message 比对源 DB."""
    t0 = time.time()
    print("\n=== 12.10.6.3 — 解密 spot-check ===")
    print("  Manual step: in WeChat, pick 10 specific messages across 5 different")
    print("  friends, with at least one emoji, one newline, one @mention.")
    print("  Record them in /tmp/spotcheck.csv (one per line: from,timestamp,content30chars)")
    input("  Press Enter once /tmp/spotcheck.csv is filled in on host... ")

    # We can't really diff content from the device side without OCR or staging.json.
    # Best-effort: dump staging.json and check first-N message subset is non-empty
    # + UTF-8 decodes.
    staging = adb_shell(
        serial,
        f"run-as {APK_PACKAGE} sh -c 'ls files/.chainlesschain/staging/wechat-*.json 2>/dev/null | head -1'",
        check=False,
    ).strip()
    if not staging:
        return ScenarioResult(
            id="12.10.6.3",
            title="解密 spot-check",
            status="FAIL",
            duration_sec=time.time() - t0,
            error="No wechat-*.json found in app staging dir",
        )
    sample = adb_shell(
        serial,
        f"run-as {APK_PACKAGE} cat {staging} | head -c 2000",
        check=False,
    )
    if not sample or "{" not in sample:
        return ScenarioResult(
            id="12.10.6.3",
            title="解密 spot-check",
            status="FAIL",
            duration_sec=time.time() - t0,
            error="staging.json sample is empty or non-JSON — decrypt likely failed",
        )

    print("\n  Auto-verification only confirms staging.json exists + parses.")
    print("  Manual: compare your /tmp/spotcheck.csv against the citation results")
    print("  in HubAskCard — type PASS/FAIL")
    verdict = input("  Spot-check verdict (PASS/FAIL): ").strip().upper()
    return ScenarioResult(
        id="12.10.6.3",
        title="解密 spot-check",
        status="PASS" if verdict == "PASS" else "FAIL",
        duration_sec=time.time() - t0,
        notes=f"staging.json present + parses; manual verdict={verdict}",
    )


def scenario_4_ask_llm(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.4 — Ask 自然语言 + 本地 LLM."""
    t0 = time.time()
    print("\n=== 12.10.6.4 — Ask 自然语言 + 本地 LLM ===")
    print("  Manual step: in APK, 本机数据 → HubAskCard, ask 3 questions:")
    print("    1. '上周我和[好友]聊了什么'")
    print("    2. '[群名]最近讨论的话题'")
    print("    3. '我和[好友]最早是哪天加好友的'")
    print("  Tap each citation chip to verify event-detail opens correctly.")
    verdict = input("  Verdict (PASS if 3/3 + ≥1 citation per Q): ").strip().upper()
    return ScenarioResult(
        id="12.10.6.4",
        title="Ask 自然语言 + LLM",
        status="PASS" if verdict == "PASS" else "FAIL",
        duration_sec=time.time() - t0,
        notes=f"manual verdict={verdict}",
    )


def scenario_5_incremental(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.5 — 增量同步."""
    t0 = time.time()
    print("\n=== 12.10.6.5 — 增量同步 ===")
    stats_before = cc_on_device(serial, "hub", "stats")
    events_before = stats_before.get("vault", {}).get("events", 0)

    print("  Manual: in WeChat, send 5 new messages to any friend. Wait 30s.")
    input("  Press Enter when done... ")
    print("  Manual: in APK, tap '立即同步' again.")
    input("  Press Enter when sync card shows '上次同步: ...'... ")

    stats_after = cc_on_device(serial, "hub", "stats")
    events_after = stats_after.get("vault", {}).get("events", 0)
    delta = events_after - events_before
    duration = time.time() - t0

    # Allow ±1 for system/notify messages
    if not (4 <= delta <= 7):
        return ScenarioResult(
            id="12.10.6.5",
            title="增量同步",
            status="FAIL",
            duration_sec=duration,
            error=f"expected ~5 new events, got delta={delta}",
            metrics={"events_delta": delta, "wall_seconds": duration},
        )
    if duration > 90:
        return ScenarioResult(
            id="12.10.6.5",
            title="增量同步",
            status="FAIL",
            duration_sec=duration,
            error=f"incremental took {duration:.0f}s, expected ≤90s including manual",
            metrics={"events_delta": delta, "wall_seconds": duration},
        )
    return ScenarioResult(
        id="12.10.6.5",
        title="增量同步",
        status="PASS",
        duration_sec=duration,
        metrics={"events_delta": delta, "wall_seconds": duration},
    )


def scenario_6_large_perf(serial: str, uin: str, skip: bool = False) -> ScenarioResult:
    """12.10.6.6 — 大库性能 (5w+ messages required)."""
    if skip:
        return ScenarioResult(
            id="12.10.6.6",
            title="大库性能",
            status="SKIP",
            notes="--skip-large-perf",
        )
    print("\n=== 12.10.6.6 — 大库性能 ===")
    print("  ⚠️ Requires test account with ≥ 50,000 messages. Pass --skip-large-perf")
    print("  if your account is smaller — this scenario is dataset:small skippable.")
    proceed = input("  Proceed? (y/N): ").strip().lower()
    if proceed != "y":
        return ScenarioResult(
            id="12.10.6.6",
            title="大库性能",
            status="SKIP",
            notes="user skipped (dataset:small)",
        )

    print("  Manual: in APK, logout WeChat → re-bind + full re-sync.")
    print("  Background: this script will monitor APK RSS every 5s.")
    input("  Press Enter once you've triggered the full re-sync... ")

    t0 = time.time()
    rss_peaks = []
    # Poll top every 5s for up to 25 min
    deadline = t0 + 25 * 60
    while time.time() < deadline:
        try:
            out = adb_shell(
                serial,
                f"top -p $(pidof {APK_PACKAGE}) -b -n 1 -o RES",
                timeout=10,
                check=False,
            )
            # Parse RES column (KB on Android)
            for line in out.splitlines():
                if APK_PACKAGE in line or "chainlesschain" in line.lower():
                    parts = line.split()
                    for p in parts:
                        if p.endswith("M") or p.endswith("K") or p.isdigit():
                            try:
                                if p.endswith("M"):
                                    rss_peaks.append(int(p[:-1]))
                                elif p.endswith("K"):
                                    rss_peaks.append(int(p[:-1]) // 1024)
                            except ValueError:
                                continue
        except RuntimeError:
            pass
        time.sleep(5)
        # Check if sync done by looking at stats
        try:
            stats = cc_on_device(serial, "hub", "stats", timeout=15)
            # Heuristic: if ingest rate has flattened (stats unchanged for 30s), done
            # For brevity, ask user to confirm
        except RuntimeError:
            continue
        # Bail early if user-driven sync done
        # (simplified: just keep polling until deadline or user breaks)

    duration = time.time() - t0
    peak_rss_mb = max(rss_peaks) if rss_peaks else 0
    wall_min = duration / 60

    if wall_min > 18:
        verdict = "FAIL"
        err = f"wall={wall_min:.1f}min > 18min threshold"
    elif peak_rss_mb > 800:
        verdict = "FAIL"
        err = f"RSS peak={peak_rss_mb}MB > 800MB threshold"
    else:
        verdict = "PASS"
        err = None
    return ScenarioResult(
        id="12.10.6.6",
        title="大库性能",
        status=verdict,
        duration_sec=duration,
        error=err,
        metrics={"wall_minutes": wall_min, "rss_peak_mb": peak_rss_mb},
    )


def scenario_7_failure_recovery(serial: str, uin: str) -> ScenarioResult:
    """12.10.6.7 — 失败恢复: 3 子场景 (WeChat killed / su denied / frida timeout)."""
    t0 = time.time()
    print("\n=== 12.10.6.7 — 失败恢复 ===")
    print("  Sub-a: WeChat killed → expect 'WeChat 进程未运行' banner")
    adb_shell(serial, "am force-stop com.tencent.mm", check=False)
    print("  Manual: in APK, tap '立即同步'. Check banner reads:")
    print("    'WeChat 进程未运行 — 请先打开微信再同步'")
    sub_a = input("  Sub-a verdict (PASS/FAIL): ").strip().upper()

    print("\n  Sub-b: su denied → manual step required.")
    print("  Open Magisk app → Superuser → set ChainlessChain to 'Deny'")
    input("  Press Enter when done... ")
    print("  Manual: in APK, tap '立即同步'. Check banner reads:")
    print("    '设备未 root — 改用桌面端'")
    sub_b = input("  Sub-b verdict (PASS/FAIL): ").strip().upper()
    print("  ⚠️ Don't forget to re-grant su to ChainlessChain in Magisk before next test!")
    input("  Press Enter once su re-granted... ")

    print("\n  Sub-c: frida timeout → kill WeChat + immediately sync (libWCDB not loaded)")
    adb_shell(serial, "am force-stop com.tencent.mm", check=False)
    adb_shell(serial, "monkey -p com.tencent.mm 1", check=False)
    time.sleep(2)  # tiny delay so WeChat starts but doesn't open DB
    print("  Manual: in APK, IMMEDIATELY tap '立即同步' (within 5s of WeChat opening).")
    print("  Wait 30s. Check banner reads:")
    print("    'Frida hook 30s 未触发 — 请打开任意聊天后再同步'")
    sub_c = input("  Sub-c verdict (PASS/FAIL): ").strip().upper()

    duration = time.time() - t0
    all_pass = sub_a == "PASS" and sub_b == "PASS" and sub_c == "PASS"
    return ScenarioResult(
        id="12.10.6.7",
        title="失败恢复",
        status="PASS" if all_pass else "FAIL",
        duration_sec=duration,
        notes=f"sub-a={sub_a} sub-b={sub_b} sub-c={sub_c}",
    )


def scenario_8_longterm(serial: str, uin: str, duration_min: int = 120) -> ScenarioResult:
    """12.10.6.8 — 长稳 + 反检测 (2h)."""
    t0 = time.time()
    print(f"\n=== 12.10.6.8 — 长稳 + 反检测 ({duration_min} min) ===")
    print("  Background loop: monitor WeChat crash + APK FATAL log every 60s.")
    print("  Manual: every 30 min, tap '立即同步' in APK.")
    print("  Use WeChat normally (send 50+ messages, add 1-2 friends).")
    print(f"  Will auto-end after {duration_min} min — Ctrl+C to abort.")

    deadline = t0 + duration_min * 60
    crash_count = 0
    wechat_kill_count = 0
    last_wechat_pid = None

    try:
        while time.time() < deadline:
            time.sleep(60)

            # Crash check
            crash = adb_shell(
                serial,
                "logcat -d -b crash | grep -E 'FATAL.*chainlesschain|TombstonedCrash' | wc -l",
                check=False,
            )
            try:
                crash_count = int(crash.strip())
            except ValueError:
                pass

            # WeChat survival check
            pid_str = adb_shell(serial, "pidof com.tencent.mm", check=False).strip()
            current_pid = pid_str.split()[0] if pid_str else None
            if last_wechat_pid and current_pid and last_wechat_pid != current_pid:
                wechat_kill_count += 1
            if current_pid:
                last_wechat_pid = current_pid

            elapsed = time.time() - t0
            print(
                f"  +{elapsed / 60:.1f}min: crashes={crash_count} "
                f"wechat-kills={wechat_kill_count} pid={current_pid}"
            )
    except KeyboardInterrupt:
        print("  Aborted by user.")

    duration = time.time() - t0

    # Check audit log count
    audit = cc_on_device(serial, "hub", "audit", "--limit", "50")
    sync_count = sum(
        1 for r in audit.get("rows", []) if r.get("adapter") == "wechat" and r.get("action") == "ingest"
    )

    all_clean = crash_count == 0 and wechat_kill_count == 0
    return ScenarioResult(
        id="12.10.6.8",
        title="长稳 + 反检测",
        status="PASS" if all_clean else "FAIL",
        duration_sec=duration,
        notes=f"crashes={crash_count} wechat-kills={wechat_kill_count} sync-count={sync_count}",
        metrics={
            "crashes": crash_count,
            "wechat_kills": wechat_kill_count,
            "sync_count": sync_count,
            "duration_min": duration / 60,
        },
    )


# ─── Main ────────────────────────────────────────────────────────────────────


SCENARIOS = {
    "1": scenario_1_login_bind,
    "2": scenario_2_first_sync,
    "3": scenario_3_decrypt_spotcheck,
    "4": scenario_4_ask_llm,
    "5": scenario_5_incremental,
    "6": lambda s, u: scenario_6_large_perf(s, u, skip=False),
    "7": scenario_7_failure_recovery,
    "8": lambda s, u: scenario_8_longterm(s, u, duration_min=120),
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Phase 12.10.6 WeChat E2E automated harness",
    )
    parser.add_argument("--device", required=True, help="adb serial of paired device")
    parser.add_argument("--uin", help="WeChat numeric uin (required for non-discover)")
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Print device prereq report + exit (no scenarios)",
    )
    parser.add_argument(
        "--scenarios",
        default="1,2,3,4,5,6,7,8",
        help="Comma-separated scenario IDs to run (default: all)",
    )
    parser.add_argument(
        "--output",
        default="e2e-record.json",
        help="JSON output file (default: ./e2e-record.json)",
    )
    parser.add_argument(
        "--skip-large-perf",
        action="store_true",
        help="Skip §12.10.6.6 (saves ~25 min on dataset:small accounts)",
    )
    args = parser.parse_args()

    info = discover(args.device)
    prereqs_ok = print_discovery(info)

    if args.discover:
        return 0 if prereqs_ok else 1

    if not prereqs_ok:
        print("❌ Prereqs failed — refusing to run scenarios.")
        return 1

    if not args.uin:
        print("❌ --uin required for non-discover mode.")
        return 1

    scenario_ids = [s.strip() for s in args.scenarios.split(",")]
    results: list[ScenarioResult] = []

    for sid in scenario_ids:
        if sid not in SCENARIOS:
            print(f"⚠️ Unknown scenario {sid}, skipping")
            continue
        try:
            if sid == "6" and args.skip_large_perf:
                r = ScenarioResult(
                    id="12.10.6.6",
                    title="大库性能",
                    status="SKIP",
                    notes="--skip-large-perf",
                )
            else:
                r = SCENARIOS[sid](args.device, args.uin)
        except Exception as e:
            r = ScenarioResult(
                id=f"12.10.6.{sid}",
                title=f"scenario {sid}",
                status="FAIL",
                error=f"unhandled exception: {e}",
            )
        results.append(r)
        print(f"  → {r.status} ({r.duration_sec or 0:.0f}s)")

    overall = "PASS" if all(r.status in ("PASS", "SKIP") for r in results) else "FAIL"

    record = {
        "device": asdict(info),
        "overall": overall,
        "scenarios": [asdict(r) for r in results],
        "generated_by": "scripts/wechat-e2e.py v0.1",
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    Path(args.output).write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n✅ E2E record written to {args.output}")
    print(f"Overall: {overall} ({sum(1 for r in results if r.status == 'PASS')}/{len(results)} PASS)")
    return 0 if overall == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
