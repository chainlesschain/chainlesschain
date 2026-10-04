"""Offline projection/verification of the extracted run 37191570648 artifact.

Usage: python docs/research/cli/evidence/verify-updater-arm64-diagnostic-84f.py
  --artifact-root <extracted artifact directory> [--write]
Only --write updates the adjacent receipt. No network, raw content, or ZIP claim.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
RECEIPT = Path(__file__).with_name("updater-arm64-diagnostic-84f.json")
SOURCE = "84f204db944d92124d95b2348814ac562bde5841"
DRIVER = "0a0214ad785760c0a5c43dcdf43c4b7a42532e75"
RAW_LOCATION = (
    "C:/code/chainlesschain/.work/gap-validation/astra-updater-37191570648/"
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
    for name, sha in identity["sourceHashesBefore"].items():
        require(git_hash(SOURCE, name) == sha, f"source hash: {name}")
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
                                 "numPendingTests", "numTodoTests"]] == [69, 69, 0, 0, 0], "69 verdicts")
    require(report["success"] and result["status"] == 0 and result["signal"] is None, "test success")
    require(identity["testSelection"] == result["testSelection"] == "entire-updater-file", "full file")
    for record in [identity, completion, result]:
        require(record["releaseEligible"] is False, "diagnostic boundary")
    cases = [select(row, ["fullName", "status", "duration"])
             for suite in report["testResults"] for row in suite["assertionResults"]]
    require(len(cases) == 69 and all(c["status"] == "passed" for c in cases), "all passed")
    require(all(not row["failureMessages"] for suite in report["testResults"]
                for row in suite["assertionResults"]), "no assertion failures")

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
        expected_timeout = None if not config["synchronous"] else (30000 if tid == "4916-2" else 60000)
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
            "milestones": milestones,
        })
    return {
        "schema": "chainlesschain.updater-arm64-diagnostic-readback.v2",
        "sourceSha": SOURCE,
        "driverSha": DRIVER,
        "runId": 37191570648,
        "jobId": 111404667709,
        "url": "https://github.com/chainlesschain/chainlesschain/actions/runs/37191570648",
        "releaseEligible": False,
        "productionChanges": False,
        "originalSourceAndTestsUnchanged": True,
        "originalDeadlinesChanged": False,
        "contentPolicy": "Metadata only: names, verdicts, scalar observations, paths and hashes; no command output or fixture bytes",
        "artifact": {
            "id": 11300100561, "size": 146660,
            "createdAt": "2026-10-04T09:39:44Z",
            "apiReportedZipDigest": "sha256:fe3706fcd52c4de57a43043a14d4e7d5bb3fd28fa56c0e91704edac1ab27a3d2",
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
            "result": "All 69 original tests passed before their unchanged assertion deadlines; no late observation promoted a failed assertion",
            "rootCauseEstablished": False,
            "contextDifferencesFromBaseline": [
                "Diagnostic launched via pwsh rather than original Git Bash",
                "Diagnostic omitted the full installer predecessor",
                "Diagnostic ran a PowerShell host probe before updater tests",
                "Diagnostic adds measured observer setup and preload/reporters",
                "Diagnostic omitted native pack/build predecessor steps",
            ],
            "nextCondition": "Optional gate_context uses Git Bash plus full installer predecessor then all 69 updater tests on exact 84f source, deferring host probe; still diagnostic only",
            "samplingIntervalMs": 100,
            "postTestObservationBudgetMs": 185000,
            "samplingLimit": "Milestones record first observed changes, not exact write times; transient phases may be missed",
            "asyncCallLimit": "7280-1 records asynchronous spawn return and eventual success result blob; no child exit status was captured. Observer exit zero describes only the observer",
        },
        "identity": identity,
        "host": host_projection,
        "integrity": {"sourceAndDriverHashesMatchGitObjects": True,
                      "sourceUnchanged": True, "allObserversCompleted": True,
                      "blobCountVerified": len(blobs), "fileCountHashed": len(files)},
        "tests": {**result, "counts": {"total": 69, "passed": 69, "failed": 0, "skipped": 0},
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
    projection = project(args.artifact_root.resolve())
    if args.write:
        RECEIPT.write_text(json.dumps(projection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        require(json.loads(RECEIPT.read_text(encoding="utf-8")) == projection, "archived projection differs")
    print(json.dumps({"verified": True, **projection["integrity"], "testsPassed": 69}))
