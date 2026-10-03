"""Read-only, offline audit of the two frozen Windows ARM64 diagnostic ZIPs.

Usage: python docs/research/cli/evidence/verify-updater-arm64-diagnostic-1fe7.py
  --evidence-root .work/updater-arm64-diagnostic-1fe7/.work [--self-test]
The receipt defaults to the adjacent archived JSON. No extraction or network.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[4]
SOURCE = "1fe7a46c0f97b93fb5110ea3427cc8551d0dab37"
BASELINE = "13095fd42635a580f4d88eaada5ef01ec0553ce1"
ATTEMPTS = [
    (37103017501, 111146114421, 11266819486,
     "c6c3fdae851c48b94d5ddc560ff1c1570680995e", 102575,
     "53bd29e5b384402f365328ff34d529524e48ee47e1a108804b46d64f1b9f5bb4", 62),
    (37103910028, 111148639136, 11268065696,
     "5907ff3ea76f0ea8593fce75d50a573b300fa8e0", 108624,
     "c6f55ba55a8005ccc4f4e8345ada3c9a438b9b06c906fca65d6ee666a2f3afd6", 63),
]
SOURCES = {
    "packages/cli/src/lib/packer/pack-update-applier.js",
    "packages/cli/src/lib/packer/native-update-state.js",
    "packages/cli/__tests__/unit/packer-pack-update-applier.test.js",
}
TESTS = [
    "transfers the real lock only after a sidecar readiness handshake",
    "commits the canonical binary and alias with lineage/result persistence",
    "rolls the canonical binary and alias back after verification fails",
    "restores prior backup and lineage generations after verification fails",
    "commits an independent rescue without consuming its canonical backup",
]


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(commit, name):
    return subprocess.check_output(
        ["git", "-C", str(ROOT), "cat-file", "blob", f"{commit}:{name}"],
        stderr=subprocess.PIPE,
    )


def zip_files(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        require(len(names) == len(set(names)), "Duplicate ZIP names")
        require(sum(item.file_size for item in entries) < 8_000_000, "Oversized ZIP")
        for item in entries:
            name = item.filename
            require(not PurePosixPath(name).is_absolute() and "\\" not in name
                    and ":" not in name and all(part not in ("", ".", "..")
                                               for part in name.split("/")), "Unsafe ZIP name")
            require(not item.is_dir() and not item.flag_bits & 1, "Unexpected ZIP entry")
        # zipfile.read verifies decompression, declared lengths and CRC for every entry.
        return {name: archive.read(name) for name in names}


def verify(receipt, evidence_root):
    require(receipt["schema"] == "chainlesschain.updater-arm64-diagnostic-readback.v1", "Schema")
    require(receipt["sourceSha"] == SOURCE, "Source identity")
    for key in ("releaseEligible", "productionChanges", "originalDeadlinesChanged"):
        require(receipt[key] is False, f"Invalid boundary: {key}")
    require(receipt["originalSourceAndTestsUnchanged"] is True, "Source claim")
    require(receipt["baseline"] == {
        "runId": 37098416042, "jobId": 111132972428, "sourceSha": BASELINE,
        "fiveFailuresRemainRecorded": True, "closed": False,
    }, "Historical failure boundary")
    require(len(receipt["attempts"]) == 2, "Both attempts required")
    reports = []
    for index, (record, pin) in enumerate(zip(receipt["attempts"], ATTEMPTS)):
        run, job, artifact, driver, size, sha, blobs_expected = pin
        require((record["runId"], record["jobId"]) == (run, job), "Run/job identity")
        require(record["artifact"] == {
            "id": artifact, "zipSha256": sha, "size": size, "apiDigestMatched": True,
        }, "Artifact identity")
        data = (evidence_root / f"arm64-run-{run}.zip").read_bytes()
        require(len(data) == size and digest(data) == sha, "ZIP bytes/hash")
        files = zip_files(data)
        extracted = evidence_root / ("arm64-artifact" if index == 0 else "arm64-artifact-second")
        extracted /= f"updater-arm64-diagnostic-1fe7-{driver}"
        for name, payload in files.items():
            require((extracted / name).read_bytes() == payload, f"Extracted bytes: {name}")
        read = lambda name: json.loads(files[name])
        identity, completion, host = read("identity.json"), read("completion.json"), read("host.json")
        require(record["identity"] == identity and record["host"] == host, "Identity/host projection")
        require(identity["sourceSha"] == SOURCE and identity["driverSha"] == driver, "Frozen identities")
        require(identity["sourceCleanBefore"] is True and completion["sourceCleanAfter"] is True, "Source cleanliness")
        require(completion["sourceSha"] == SOURCE, "Completion source")
        require(identity["sourceHashesBefore"] == completion["sourceHashesAfter"], "Source changed during run")
        require(set(identity["sourceHashesBefore"]) == SOURCES, "Source inventory")
        for name, expected in identity["sourceHashesBefore"].items():
            require(digest(git_blob(SOURCE, name)) == expected, f"Git source blob: {name}")
        expected_drivers = {"observer.mjs", "preload.mjs", "run.mjs", "shared.mjs"}
        if index == 1:
            expected_drivers.add("coordinator.mjs")
        require(set(identity["driverHashes"]) == expected_drivers, "Driver inventory")
        for name, expected in identity["driverHashes"].items():
            require(digest(git_blob(driver, f"scripts/diagnostics/updater-arm64/{name}")) == expected,
                    f"Git driver blob: {name}")
        require((identity["platform"], identity["arch"], identity["nodeVersion"],
                 identity["nodePeMachine"], identity["runnerArch"]) ==
                ("win32", "arm64", "v22.14.0", "0xaa64", "ARM64"), "Native Node identity")
        require(host["status"] == 0 and host["signal"] is None and host["errorCode"] is None, "Host probe")
        require(host["powershellPeMachine"] == host["cmdPeMachine"] == "0xaa64", "Native process architecture")
        require(json.loads(host["stdout"])["ProcessorArchitecture"] == 12, "Processor architecture")
        for item in (identity, completion, record, read("test-result.json")):
            require(item["releaseEligible"] is False, "Diagnostic promoted to release evidence")

        report = read("vitest.json")
        require([report[key] for key in ("numTotalTests", "numPassedTests", "numPendingTests", "numFailedTests")]
                == [69, 5, 64, 0] and report["success"] is True, "Original test verdicts")
        rows = [row for suite in report["testResults"] for row in suite["assertionResults"]]
        selected = [row for row in rows if row["status"] not in ("pending", "skipped")]
        require(len(selected) == 5 and all(row["status"] == "passed" for row in selected), "Five passing assertions")
        require(all(row["fullName"].endswith(name) for row, name in zip(selected, TESTS)), "Exact test names")
        require(all(row["duration"] < 60_000 and not row["failureMessages"] for row in selected), "Test duration/failures")
        result = read("test-result.json")
        require(result["status"] == 0 and result["signal"] is None and result["originalTestNames"] == TESTS, "Test subprocess")
        projected_tests = dict(result, cases=[{key: row[key] for key in
                                ("fullName", "status", "duration", "failureMessages")} for row in selected])
        require(record["tests"] == projected_tests, "Test summary projection")

        blobs = {name[6:]: payload for name, payload in files.items() if name.startswith("blobs/")}
        require(len(blobs) == blobs_expected and all(digest(payload) == name for name, payload in blobs.items()), "Blob inventory/digests")
        configs = sorted(name for name in files if name.endswith(".config.json"))
        require(len(configs) == len(record["transactions"]) == 6, "Transaction inventory")
        missing = []
        for name, transaction in zip(configs, record["transactions"]):
            config = read(name)
            tid = config["id"]
            require(transaction["id"] == tid, "Transaction order")
            for key in ("kind", "synchronous", "timeoutMs"):
                require(transaction[key] == config[key], f"Transaction projection: {key}")
            require(config["timeoutMs"] == (60_000 if config["synchronous"] else None), "Original subprocess deadline")
            require(transaction["target"] == config["paths"]["TARGET_EXE"], "Target projection")
            events = [json.loads(line) for line in files[f"{tid}.jsonl"].splitlines()]
            started = next(event for event in events if event["type"] == "native-call-start")
            require(transaction["setupElapsedMs"] == started["setupElapsedMs"], "Observer setup timing")
            done = f"{tid}.observer-done" in files
            if not done:
                missing.append(tid)
            if index == 1:
                require(done and any(event["type"] == "observation-ended" for event in events), "Observer completion")
                exit_record = read(f"{tid}.observer-exit.json")
                require(exit_record["status"] == 0 and exit_record["signal"] is None and exit_record["error"] is None, "Observer exit")
            returned = next((event for event in events if event["type"] == "native-sync-return"), None)
            if returned:
                rf = returned["files"]
                projection = {key: returned[key] for key in ("elapsedMs", "status", "signal", "error")}
                for key, label, field in (("lastJournalPhase", "JOURNAL_FILE", "phase"),
                                          ("retiredPhase", "JOURNAL_RETIRED", "phase"),
                                          ("resultStatus", "RESULT_FILE", "status")):
                    value = rf.get(label, {}).get("json", {}).get(field)
                    if value is not None:
                        projection[key] = value
                projection["lockAtReturn"] = bool(rf.get("LOCK_FILE", {}).get("sha256"))
                require(transaction["returned"] == projection, "Native return projection")
                require(returned["elapsedMs"] < 60_000 and returned["error"] is None
                        and returned["signal"] is None, "Native return boundary")
            else:
                require(transaction["returned"] is None and not config["synchronous"], "Missing native return")
            observed, lock_seen = {}, False
            for event in events:
                current = event.get("files", {})
                for state in current.values():
                    if "sha256" in state:
                        payload = blobs[state["sha256"]]
                        require(len(payload) == state["size"], "Snapshot byte count")
                        if "json" in state:
                            require(json.loads(payload) == state["json"], "Snapshot JSON projection")
                lock = current.get("LOCK_FILE", {})
                lock_seen |= bool(lock.get("sha256"))
                phase = current.get("JOURNAL_FILE", {}).get("json", {}).get("phase")
                values = [("ready", current.get("READY_FILE", {}).get("sha256")),
                          ("plan-after-verified-handshake", current.get("PLAN", {}).get("sha256")),
                          (phase, phase),
                          ("retired", current.get("JOURNAL_RETIRED", {}).get("json", {}).get("phase")),
                          ("result", current.get("RESULT_FILE", {}).get("json", {}).get("status"))]
                if lock_seen and lock.get("error") == "ENOENT":
                    values.append(("lock-absent-after-present", "ENOENT"))
                for key, value in values:
                    if key and value and key not in observed:
                        observed[key] = {"elapsedMs": event["at"] - started["at"], "value": value,
                                         "afterOriginalDeadline": event.get("afterOriginalDeadline")}
            # The first summary predates added plan/lock projections: verify all
            # its recorded observations without retroactively claiming completeness.
            for key, value in transaction["firstObserved"].items():
                require(observed.get(key) == value, f"First-observation projection: {tid}/{key}")
            if index == 1:
                require(observed == transaction["firstObserved"], "Incomplete second observation projection")
        require(record["integrity"] == {"sourceUnchanged": True, "allObserversCompleted": not missing,
                "missingObservers": missing, "blobCountVerified": blobs_expected, "driverHashesVerified": True}, "Integrity summary")
        require(len(missing) == (6 if index == 0 else 0), "Attempt completion boundary")
        require(sorted(completion["observers"]) == sorted(name for name in files if name.endswith(".observer-done")), "Completion inventory")
        if index == 1:
            require(completion["observationComplete"] is True, "Coordinator completion")
        reports.append({"runId": run, "zipEntries": len(files), "testsPassed": 5,
                        "testsSkipped": 64, "observerDone": 6 - len(missing), "blobs": len(blobs)})
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", required=True, type=Path)
    parser.add_argument("--receipt", type=Path, default=Path(__file__).with_name("updater-arm64-diagnostic-1fe7.json"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    receipt_bytes = args.receipt.read_bytes()
    receipt = json.loads(receipt_bytes)
    reports = verify(receipt, args.evidence_root)
    negatives = 0
    if args.self_test:
        mutations = [
            lambda r: r.update(releaseEligible=True),
            lambda r: r.update(originalDeadlinesChanged=True),
            lambda r: r["baseline"].update(closed=True),
            lambda r: r["attempts"][0]["artifact"].update(zipSha256="0" * 64),
            lambda r: r["attempts"][0]["identity"].update(arch="x64"),
            lambda r: r["attempts"][0]["integrity"].update(allObserversCompleted=True),
            lambda r: r["attempts"][1]["tests"]["cases"][0].update(status="failed"),
        ]
        for mutate in mutations:
            bad = copy.deepcopy(receipt)
            mutate(bad)
            try:
                verify(bad, args.evidence_root)
            except (ValueError, KeyError):
                negatives += 1
            else:
                raise ValueError("Invalid receipt accepted")
    print(json.dumps({"status": "offline-verified", "receiptSha256": digest(receipt_bytes),
                      "attempts": reports, "negativeChecks": negatives, "releaseEligible": False,
                      "limitations": ["API digest/origin statements are not independently authenticated offline.",
                                      "Diagnostics are instrumented five-test samples, not the native matrix or release gates.",
                                      "Baseline 13095 failure remains open; per-process timing/root cause and SLO remain unproven.",
                                      "Local x64 control is historical supporting metadata, outside these two ARM64 ZIPs."]}, indent=2))


if __name__ == "__main__":
    main()
