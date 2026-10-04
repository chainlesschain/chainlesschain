"""Offline projection/verification of the extracted gate-context run 37193652496 artifact.

Usage: python docs/research/cli/evidence/verify-updater-arm64-gate-context-84f.py
  --artifact-root <extracted artifact directory> [--write]
Only --write updates the adjacent receipt. No network, raw content, or ZIP claim.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
RECEIPT = Path(__file__).with_name("updater-arm64-gate-context-84f.json")
SOURCE = "84f204db944d92124d95b2348814ac562bde5841"
DRIVER = "71f4ee4f7693bc6d392186ce23500ac0860dcdee"
RAW_LOCATION = (
    "C:/code/chainlesschain/.work/updater-gate-context-20261004/.work/gate-context-37193652496/"
    f"updater-arm64-diagnostic-{SOURCE}-{DRIVER}"
)


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def select(obj, keys):
    return {key: obj[key] for key in keys if key in obj}


def git_hash(commit, filename):
    return digest(subprocess.check_output(
        ["git", "-C", str(ROOT), "cat-file", "blob", f"{commit}:{filename}"],
        stderr=subprocess.PIPE,
    ))


def project(artifact):
    files = {p.relative_to(artifact).as_posix(): p.read_bytes()
             for p in sorted(artifact.rglob("*")) if p.is_file()}
    read = lambda name: json.loads(files[name])
    identity, completion = read("identity.json"), read("completion.json")
    require(identity["sourceSha"] == completion["sourceSha"] == SOURCE, "source identity")
    require(identity["driverSha"] == DRIVER, "driver identity")
    require(identity["sourceCleanBefore"] and completion["sourceCleanAfter"], "source clean")
    require(identity["sourceHashesBefore"] == completion["sourceHashesAfter"], "source unchanged")
    source_bindings = {}
    attributes = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", f"{SOURCE}:.gitattributes"])
    require(b"*.ps1 text eol=crlf" in attributes, "pinned PowerShell checkout EOL")
    for name, sha in identity["sourceHashesBefore"].items():
        blob = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", f"{SOURCE}:{name}"])
        checkout = blob.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") if name.endswith(".ps1") else blob
        require(digest(checkout) == sha, f"source checkout hash: {name}")
        source_bindings[name] = {
            "gitBlobSha256": digest(blob), "checkoutSha256": sha,
            "checkoutConversion": "CRLF required by pinned .gitattributes" if name.endswith(".ps1") else "none",
        }
    for name, sha in identity["driverHashes"].items():
        require(git_hash(DRIVER, f"scripts/diagnostics/updater-arm64/{name}") == sha,
                f"driver hash: {name}")
    require((identity["platform"], identity["arch"], identity["nodeVersion"],
             identity["nodePeMachine"], identity["runnerArch"]) ==
            ("win32", "arm64", "v22.14.0", "0xaa64", "ARM64"), "native Node identity")
    host = read("host.json")
    require(host["status"] == 0 and not host["signal"] and not host["errorCode"], "host probe")
    require(host["powershellPeMachine"] == host["cmdPeMachine"] == "0xaa64", "native hosts")
    host_projection = select(host, ["elapsedMs", "status", "signal", "errorCode",
                                    "powershellPeMachine", "cmdPeMachine"])
    host_projection["facts"] = select(json.loads(host["stdout"]), [
        "PowerShellVersion", "ProcessorArchitecture", "ProcessArchitecture",
        "OSArchitecture", "Version"])
    require(host_projection["facts"]["ProcessorArchitecture"] == 12, "ARM64 processor")

    report, result = read("vitest.json"), read("test-result.json")
    require([report[k] for k in ["numTotalTests", "numPassedTests", "numFailedTests",
                                 "numPendingTests", "numTodoTests"]] == [69, 64, 5, 0, 0], "69 verdicts")
    require(not report["success"] and result["status"] == 1 and result["signal"] is None, "original failure verdict")
    require(identity["testSelection"] == result["testSelection"] == "entire-updater-file", "full file")
    for record in [identity, completion, result]:
        require(record["releaseEligible"] is False, "diagnostic boundary")
    cases = [select(row, ["fullName", "status", "duration"])
             for suite in report["testResults"] for row in suite["assertionResults"]]
    require(len(cases) == 69 and sum(c["status"] == "passed" for c in cases) == 64, "64 passed")
    failed = [c for c in cases if c["status"] == "failed"]
    require(len(failed) == 5 and all(c["fullName"].endswith(name)
            for c, name in zip(failed, result["originalTestNames"])), "same five failures")
    installer = read("installer-result.json")
    require(installer["status"] == 0 and installer["diagnosticPreload"] is False, "predecessor passed")
    context = identity["executionContext"]
    require(context["gateContext"] and context["launchShell"] == "bash"
            and context["hostProbeTiming"] == "after-tests"
            and context["nativeValidationSha"] == SOURCE, "gate execution context")
    require(installer["args"] == context["predecessorArgs"], "exact predecessor command")
    require(completion["updaterRan"], "updater ran after predecessor")
    installer_text = re.sub(r"\x1b\[[0-9;]*m", "", files["installer.stdout.log"].decode("utf-8"))
    require("18 passed" in installer_text and "53 skipped" in installer_text
            and "432888" in installer_text, "installer counts and duration")
    prior_path = RECEIPT.with_name("updater-arm64-diagnostic-84f.json")
    prior_bytes = prior_path.read_bytes()
    prior = json.loads(prior_bytes)
    require(prior["sourceSha"] == SOURCE and prior["runId"] == 37191570648, "prior diagnostic")
    previous_cases = {c["fullName"]: c for c in prior["tests"]["cases"]}
    require(set(previous_cases) == {c["fullName"] for c in cases}, "same 69 test names")

    blobs = {name[6:]: data for name, data in files.items() if name.startswith("blobs/")}
    require(all(digest(data) == sha for sha, data in blobs.items()), "content-addressed blob hashes")
    configurations = sorted(name for name in files if name.endswith(".config.json"))
    require(len(configurations) == 10 and completion["observationComplete"], "ten completed observers")
    calls = []
    for filename in configurations:
        config = read(filename)
        tid = config["id"]
        require(f"{tid}.observer-done" in completion["observers"], "observer completion receipt")
        require(f"{tid}.observer-done" in files, "observer done file")
        exit_record = read(f"{tid}.observer-exit.json")
        require(exit_record["status"] == 0 and not exit_record["signal"] and not exit_record["error"],
                "observer exit")
        events = [json.loads(line) for line in files[f"{tid}.jsonl"].splitlines()]
        require(any(e["type"] == "observation-ended" for e in events), "observation ended")
        start = read(f"{tid}.started.json")["at"]
        started = next(e for e in events if e["type"] == "native-call-start")
        require(started["observerReady"], "observer ready before call")
        expected_timeout = None if not config["synchronous"] else (30000 if tid == "10580-2" else 60000)
        require(config["timeoutMs"] == expected_timeout, "original timeout")
        returns = [e for e in events if e["type"] in [
            "native-sync-return", "native-async-return", "native-child-exit"]]
        initial = next(e["files"] for e in events if e["type"] == "before-native-call")
        milestones, seen = [], set()
        for event in events:
            observed = event.get("files", {})
            for key, state in observed.items():
                if state.get("sha256"):
                    require(state["sha256"] in blobs, f"missing referenced blob: {tid}/{key}")
            for key in ["JOURNAL_FILE", "RESULT_FILE", "LINEAGE_FILE", "LOCK_FILE",
                        "READY_FILE", "TARGET_EXE", "ALIAS_EXE", "BACKUP_EXE"]:
                state = observed.get(key)
                if not state:
                    continue
                fingerprint = (key, state.get("sha256"), state.get("error"))
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                row = {"fileRole": key, "firstObservedElapsedMs": event["at"] - start,
                       "eventType": event["type"], **select(state, ["size", "sha256", "error"])}
                if "afterOriginalDeadline" in event:
                    row["afterOriginalDeadline"] = event["afterOriginalDeadline"]
                if state.get("sha256") and key in ["JOURNAL_FILE", "RESULT_FILE", "LINEAGE_FILE"]:
                    try:
                        decoded = json.loads(blobs[state["sha256"]].decode("utf-8-sig"))
                        row["facts"] = select(decoded, ["schema", "phase", "status", "decision", "operation"])
                    except (ValueError, UnicodeError):
                        row["structuredFactsUnavailable"] = True
                if state.get("sha256"):
                    row["matchesInitialHash"] = state["sha256"] == initial.get(key, {}).get("sha256")
                milestones.append(row)
        calls.append({
            **select(config, ["id", "kind", "synchronous", "timeoutMs"]),
            "setupElapsedMs": started["setupElapsedMs"],
            "observerCompleted": True,
            "observerExit": select(exit_record, ["status", "signal", "error"]),
            "nativeReturns": [select(e, ["type", "elapsedMs", "status", "signal", "error"])
                              for e in returns],
            "filesAtNativeReturn": [{
                "eventType": e["type"],
                "files": {key: select(state, ["size", "sha256", "error"])
                          for key, state in e.get("files", {}).items()
                          if key in ["TARGET_EXE", "ALIAS_EXE", "JOURNAL_FILE",
                                     "RESULT_FILE", "LOCK_FILE", "BACKUP_EXE", "LINEAGE_FILE"]},
            } for e in returns],
            "milestones": milestones,
        })
    return {
        "schema": "chainlesschain.updater-arm64-diagnostic-readback.v2",
        "sourceSha": SOURCE,
        "driverSha": DRIVER,
        "runId": 37193652496,
        "jobId": 111410896419,
        "url": "https://github.com/chainlesschain/chainlesschain/actions/runs/37193652496",
        "releaseEligible": False,
        "productionChanges": False,
        "originalSourceAndTestsUnchanged": True,
        "originalDeadlinesChanged": False,
        "contentPolicy": "Metadata only: names, verdicts, scalar observations, paths and hashes; no command output or fixture bytes",
        "artifact": {
            "id": 11301280171, "size": 138655,
            "createdAt": "2026-10-04T10:25:20Z",
            "apiReportedZipDigest": "sha256:1474526e3e5ddf8c9a680b10fad6c5b8ebc3db83ccbb959d67a552e90bf4108d",
            "zipDigestLocallyVerified": False,
            "extractedFilesLocallyHashed": True,
            "originalLocalPath": RAW_LOCATION,
        },
        "baseline": {
            "runId": 37189753288, "jobId": 111399295090, "sourceSha": SOURCE,
            "updaterPassed": 64, "updaterFailed": 5,
            "failureSummary": "Readiness result absent after 60s with lock retained; four direct cmd calls returned null status after 60000ms",
            "installerPredecessor": {"passed": 18, "skipped": 53, "elapsedMs": 428713},
            "rawLog": {
                "path": "C:/code/chainlesschain/.work/gap-validation/native-84f-windows-arm64-failure.log",
                "sha256": "07b15e792cec4af3fbac5ba20d8739c2d47e7205e88a47a643e1220e5cc0da5d",
                "hashVerifiedAtArchival": True,
            },
            "shell": "bash", "closed": False,
        },
        "interpretation": {
            "result": "Original 64-pass/5-fail outcome reproduced; detached result appeared only after the original assertion deadline and does not convert failure to success",
            "rootCauseEstablished": False,
            "reproducedBaselineFailures": True,
            "contextDifferencesFromBaseline": [
                "Diagnostic retains observer setup, preload and verbose/JSON reporters",
                "Diagnostic omits native pack/build predecessor steps",
            ],
            "bottleneck": "Four synchronous calls have candidate target and alias bytes at the 60s timeout, but journal remains target-committed, lock remains and result is absent; alias-committed journal persistence has not completed",
            "sourceMapping": {
                "file": "packages/cli/src/lib/packer/pack-update-applier.js",
                "aliasMoveLine": 1441, "aliasJournalCallLine": 1445,
                "writeJournalPowerShellInvocationLine": 1725,
                "sourceSha": SOURCE,
            },
            "detachedProgress": "Readiness succeeds quickly but result appears at 161424ms from helper start; successive durable phases are approximately 22-23s apart",
            "causalityLimit": "File snapshots localize the durable progress boundary, not a live process stack. Shell, inherited environment, installer predecessor and probe ordering changed together; no independent attribution to one condition or specific PowerShell internals is established",
            "cleanupLimit": "Direct-call fixture files disappear after the failed assertions; later ENOENT observations are test cleanup, not evidence of production rollback or recovery",
            "samplingIntervalMs": 100,
            "postTestObservationBudgetMs": 185000,
            "samplingLimit": "Milestones record first observed changes, not exact write times; transient phases may be missed",
            "asyncCallLimit": "9224-1 records asynchronous spawn return and late success result blob; no child exit status was captured. Observer exit zero describes only the observer",
        },
        "identity": identity,
        "host": host_projection,
        "previousDiagnostic": {
            "runId": 37191570648,
            "driverSha": prior["driverSha"],
            "counts": prior["tests"]["counts"],
            "archivePath": "docs/research/cli/evidence/updater-arm64-diagnostic-84f.json",
            "archiveSha256": digest(prior_bytes),
            "all69NamesIdentical": True,
            "changedVerdicts": [{
                "fullName": c["fullName"],
                "before": previous_cases[c["fullName"]],
                "after": c,
            } for c in failed],
            "hostProbeElapsedMs": prior["host"]["elapsedMs"],
        },
        "sourceBindings": source_bindings,
        "integrity": {"sourceHashesMatchGitCheckoutAttributes": True,
                      "driverHashesMatchGitObjects": True,
                      "sourceUnchanged": True, "allObserversCompleted": True,
                      "blobCountVerified": len(blobs), "fileCountHashed": len(files)},
        "installer": {**installer, "counts": {"total": 71, "passed": 18, "failed": 0, "skipped": 53}, "testFileElapsedMs": 432888},
        "tests": {**result, "counts": {"total": 69, "passed": 64, "failed": 5, "skipped": 0},
                  "cases": cases},
        "calls": calls,
        "rawReports": [{"path": name, "size": len(data), "sha256": digest(data)}
                       for name, data in sorted(files.items())],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    artifact_root = args.artifact_root.resolve()
    # Windows relative paths to content-addressed blobs can exceed MAX_PATH.
    if __import__("os").name == "nt":
        artifact_root = Path("\\\\?\\" + str(artifact_root))
    projection = project(artifact_root)
    if args.write:
        RECEIPT.write_text(json.dumps(projection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        require(json.loads(RECEIPT.read_text(encoding="utf-8")) == projection, "archived projection differs")
    print(json.dumps({"verified": True, **projection["integrity"], "testsPassed": 64, "testsFailed": 5}))
