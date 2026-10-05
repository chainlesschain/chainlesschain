"""Read-only artifact verification; --write creates the adjacent metadata receipt.

python docs/research/cli/evidence/updater-journal-diagnostic-03980/verify.py \
  --artifact-root .work/astra-updater-journal-03980 \
  --zip .work/astra-updater-journal-03980.zip [--write]
No network access and no production/test modifications.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
SOURCE = "b2aa3aba082873570e85dce39b00754e5504ff37"
DRIVER = "03980cf9a715c439039366b2278e496a2067e5b5"
ZIP_SHA = "331310345851b29a3b6f6ac05583aefe4afa0de292a621f011d0189dd4d1b24a"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf8")


def project(artifact, archive):
    files = {p.relative_to(artifact).as_posix(): p.read_bytes()
             for p in sorted(artifact.rglob("*")) if p.is_file()}
    require(sha(archive.read_bytes()) == ZIP_SHA, "API-reported ZIP digest")
    with zipfile.ZipFile(archive) as zipped:
        raw = {p.filename: zipped.read(p) for p in zipped.infolist() if not p.is_dir()}
    require(raw == files, "extracted artifact matches every ZIP member")
    for name, data in files.items():
        if name.startswith("blobs/"):
            require(sha(data) == name.split("/", 1)[1], "content-addressed blob " + name)
    read = lambda name: json.loads(files[name])
    identity, completion = read("identity.json"), read("completion.json")
    require(identity["sourceSha"] == completion["sourceSha"] == SOURCE, "source identity")
    require(identity["driverSha"] == DRIVER, "driver identity")
    require(identity["sourceCleanBefore"] and completion["sourceCleanAfter"], "clean checkout")
    require(identity["sourceHashesBefore"] == completion["sourceHashesAfter"], "unchanged source")
    bindings = {}
    for name, expected in identity["sourceHashesBefore"].items():
        blob = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", SOURCE + ":" + name])
        checkout = blob.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") if name.endswith(".ps1") else blob
        require(sha(checkout) == expected, "source hash " + name)
        bindings[name] = {"gitBlobSha256": sha(blob), "checkoutSha256": expected}
    attributes = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", SOURCE + ":.gitattributes"])
    require(b"*.ps1 text eol=crlf" in attributes, "PowerShell checkout CRLF policy")
    for name, expected in identity["driverHashes"].items():
        blob = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", DRIVER + ":scripts/diagnostics/updater-arm64/" + name])
        require(sha(blob) == expected, "driver hash " + name)
    require((identity["platform"], identity["arch"], identity["nodePeMachine"], identity["runnerArch"]) ==
            ("win32", "arm64", "0xaa64", "ARM64"), "native ARM64 identity")
    context = identity["executionContext"]
    require(context["gateContext"] and context["generatedJournalTimingInstrumentation"] and
            context["launchShell"] == "bash" and context["msystem"] == "CLANGARM64", "traced gate context")
    report, result = read("vitest.json"), read("test-result.json")
    require([report[k] for k in ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"]] ==
            [69, 69, 0, 0, 0], "69 original verdicts")
    require(report["success"] and result["status"] == 0 and completion["observationComplete"], "successful completion")
    cases = [{k: row[k] for k in ["fullName", "status", "duration"]}
             for suite in report["testResults"] for row in suite["assertionResults"]]
    require(len(cases) == 69 and all(c["status"] == "passed" for c in cases), "all cases passed")
    historical = [c for c in cases if any(n in c["fullName"] for n in result["originalTestNames"])]
    require(len(historical) == 5, "five historical failure names")
    installer = read("installer-result.json")
    require(installer["status"] == 0 and installer["diagnosticPreload"] is False, "installer predecessor")
    require(b"18 passed" in files["installer.stdout.log"] and b"53 skipped" in files["installer.stdout.log"], "installer verdicts")
    host = read("host.json")
    require(host["status"] == 0 and host["powershellPeMachine"] == host["cmdPeMachine"] == "0xaa64", "native hosts")
    probes = read("powershell-probes.json")
    require(all(p["status"] == 0 and p["errorCode"] is None for p in probes["results"]), "post-test probe verdicts")
    traces, durations, outputs = [], {}, {}
    for name in sorted(files):
        if not name.endswith(".config.json"):
            continue
        config = read(name)
        instrumentation = config.get("journalTrace")
        if not instrumentation:
            continue
        events = [json.loads(line) for line in files[config["id"] + ".jsonl"].splitlines()]
        snapshots = [r["files"]["JOURNAL_TRACE"] for r in events
                     if "sha256" in r.get("files", {}).get("JOURNAL_TRACE", {})]
        trace = {"id": config["id"], "originalHelperSha256": instrumentation["originalSha256"],
                 "instrumentedHelperSha256": instrumentation["instrumentedSha256"],
                 "observedTrace": bool(snapshots)}
        if snapshots:
            last = snapshots[-1]
            data = files["blobs/" + last["sha256"]]
            require(sha(data) == last["sha256"], "content-addressed trace hash")
            markers = [json.loads(line) for line in data.splitlines()]
            require(all(set(m) == {"at", "pid", "stage"} for m in markers), "metadata-only markers")
            trace.update({"markerCount": len(markers), "lastObservedBlobSha256": sha(data),
                          "helperProcesses": len({m["pid"] for m in markers})})
            outputs[config["id"] + ".trace.jsonl"] = data
            before = {}
            for marker in markers:
                stage = marker["stage"]
                if stage.endswith("-before"):
                    before[(marker["pid"], stage[:-7])] = marker["at"]
                elif stage.endswith("-after"):
                    label = stage[:-6]
                    start = before.pop((marker["pid"], label), None)
                    if start is not None:
                        durations.setdefault(label, []).append(marker["at"] - start)
        traces.append(trace)
    require(traces and durations, "instrumented traces present")
    timing = {k: {"count": len(v), "minMs": min(v), "medianMs": statistics.median(v), "maxMs": max(v)}
              for k, v in sorted(durations.items())}
    for name in ["identity.json", "completion.json", "installer-result.json", "test-result.json", "powershell-probes.json"]:
        outputs[name] = files[name]
    outputs["original-test-verdicts.json"] = encode(cases)
    outputs["artifact-file-sha256.json"] = encode({k: sha(v) for k, v in sorted(files.items())})
    receipt = {
        "schema": "chainlesschain.updater-journal-diagnostic-readback.v1",
        "sourceSha": SOURCE, "driverSha": DRIVER, "runId": 37198163580, "jobId": 111424214791,
        "url": "https://github.com/chainlesschain/chainlesschain/actions/runs/37198163580/job/111424214791",
        "releaseEligible": False, "productionCheckoutUnchanged": True, "originalDeadlinesChanged": False,
        "generatedHelperInstrumented": True,
        "artifact": {"id": 11302288213, "sizeInBytes": len(archive.read_bytes()),
                     "zipSha256": ZIP_SHA, "zipDigestLocallyVerified": True,
                     "allExtractedMembersMatchZip": True, "extractedFileCount": len(files)},
        "sourceBindings": bindings, "executionContext": context,
        "platform": {k: identity[k] for k in ["platform", "arch", "nodeVersion", "nodePeMachine", "runnerArch", "os"]},
        "host": {"elapsedMs": host["elapsedMs"], "facts": json.loads(host["stdout"]),
                 "powershellPeMachine": host["powershellPeMachine"], "cmdPeMachine": host["cmdPeMachine"]},
        "verdicts": {"total": 69, "passed": 69, "failed": 0, "skipped": 0,
                     "updaterElapsedMs": result["elapsedMs"], "historicalFailures": historical,
                     "installer": {"passed": 18, "skipped": 53, "elapsedMs": installer["elapsedMs"]}},
        "journalTraces": traces, "pairedMarkerTiming": timing, "postTestProbes": probes,
        "interpretation": {
            "rootCauseEstablished": False, "reproducedSlowJournalFailure": False,
            "result": "All original 69 assertions passed on the pre-optimization source, with generated helper timing markers enabled.",
            "causalityLimit": "This run did not reproduce the historical 22-23 second journal phases. Fast post-test probes and instrumented traces cannot establish module discovery, PSModulePath or MSYSTEM as the cause of that historical slowdown.",
            "probeLimit": "Single sequential probes ran after tests; environment variants never affected original test calls. Cache, runner state, instrumentation and ordering are not independently controlled.",
            "traceLimit": "Markers time script sections after helper entry, not OS process creation/startup. Flush markers cover their named flush calls only; millisecond wall-clock samples do not measure all durable I/O or establish live process stacks. Last observed traces may omit events after test cleanup.",
            "acceptanceLimit": "Diagnostic only, with no native pack/build predecessor. Source b2aa3aba predates production fix 0fc6e7a0c2 and is not a main-commit native release gate.",
            "productionFixReview": "0fc6e7a0c2 changes JSON/file/path cmdlet usage to inbox .NET APIs; synchronous staging and final Flush(true), atomic replacement, ownership/schema validation and phase checks remain. Test deadlines are unchanged; ten additional journal metadata assertions were added."
        },
        "readbackFiles": {"updater-journal-diagnostic-03980/" + k: sha(v) for k, v in sorted(outputs.items())},
    }
    return receipt, outputs


parser = argparse.ArgumentParser()
parser.add_argument("--artifact-root", type=Path, required=True)
parser.add_argument("--zip", type=Path, required=True)
parser.add_argument("--write", action="store_true")
args = parser.parse_args()
receipt, outputs = project(args.artifact_root, args.zip)
destination = HERE.with_suffix(".json")
if args.write:
    for name, data in outputs.items():
        (HERE / name).write_bytes(data)
    destination.write_bytes(encode(receipt))
else:
    require(destination.read_bytes() == encode(receipt), "receipt projection")
    for name, data in outputs.items():
        require((HERE / name).read_bytes() == data, "readback " + name)
print(json.dumps({"verified": True, "passed": 69, "releaseEligible": False,
                  "pairedMarkerTiming": receipt["pairedMarkerTiming"]}))
