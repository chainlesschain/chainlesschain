"""Read-only audit of the original digest-bound native delivery archive."""
import argparse
import hashlib
import json
import pathlib
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--archive", type=pathlib.Path, required=True)
parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path.cwd())
args = parser.parse_args()
root = args.root.resolve()
round_dir = root / "docs/research/cli/verify01-openai-140-frozen-four-20261103"
report = json.loads((round_dir / "public-802c51a9f2/results.json").read_text(encoding="utf-8"))
artifact = next(a for a in report["artifacts"] if "delivery-darwin-vscode-" in a["name"])
sha = lambda b: "sha256:" + hashlib.sha256(b).hexdigest()
archive_bytes = args.archive.read_bytes()
assert len(archive_bytes) == artifact["sizeInBytes"]
assert sha(archive_bytes) == artifact["digest"]
archive = zipfile.ZipFile(args.archive)
assert len(archive.infolist()) < 5000
assert sum(i.file_size for i in archive.infolist()) < 128 * 1024 * 1024
summary_name = "summary.json"
summary_bytes = archive.read(summary_name)
assert sha(summary_bytes) == artifact["summaryDigest"]
summary = json.loads(summary_bytes)
decoder = json.JSONDecoder()
samples = []
for sample in summary["samples"]:
    sid = sample["sampleId"]
    raw = {e["id"]: e for e in sample["model"]["toolResults"]}
    calls = {e["id"]: {"name": e["tool"], "arguments": e.get("args", {})}
             for e in sample["model"]["tools"]}
    requests = []
    reads = {}
    facts = {}
    for number in range(1, 22):
        prefix = sid + "/broker/request-" + str(number)
        original_bytes = archive.read(prefix + ".original.json")
        effective_bytes = archive.read(prefix + ".effective.json")
        original, effective = json.loads(original_bytes), json.loads(effective_bytes)
        assert original["input"] == effective["input"]
        requests.append({"request": number, "originalDigest": sha(original_bytes),
                         "effectiveDigest": sha(effective_bytes), "inputUnchangedByBroker": True})
        for item in effective["input"]:
            if item.get("type") == "function_call":
                calls[item["call_id"]] = {"name": item["name"], "arguments": item.get("arguments")}
        for item in effective["input"]:
            if item.get("type") != "function_call_output":
                continue
            call_id = item["call_id"]
            call = calls.get(call_id, {})
            try:
                # Runtime budget notices can follow the JSON tool value.
                value, end = decoder.raw_decode(item.get("output", ""))
            except (ValueError, TypeError):
                continue
            if not isinstance(value, dict):
                continue
            path = str(value.get("path", ""))
            content = value.get("content", "")
            if not isinstance(content, str):
                content = ""
            if (call.get("name") == "read_file" and
                    path.endswith("repair137-verify-08.test.js") and "range" in value):
                key = (call_id, sha(content.encode("utf-8")))
                if key not in reads:
                    host = raw.get(call_id, {}).get("result", {})
                    host_content = host.get("content", "")
                    reads[key] = {
                        "callId": call_id, "requests": [], "path": path,
                        "fileVersion": value.get("fileVersion"), "range": value.get("range"),
                        "readSpan": value.get("readSpan"), "outboundChars": len(content),
                        "outboundContentDigest": sha(content.encode("utf-8")),
                        "outboundContentOmitted": value.get("contentOmitted") is True,
                        "outboundOmissionText": content if content.startswith("Text omitted") else None,
                        "rawHostChars": len(host_content) if isinstance(host_content, str) else None,
                        "rawHostContentDigest": sha(host_content.encode("utf-8")) if isinstance(host_content, str) else None,
                        "budgetNoticeFollowsJson": bool(item.get("output", "")[end:].strip()),
                    }
                reads[key]["requests"].append(number)
            if call.get("name") not in ("read_file", "search_files") or path.endswith("repair137-verify-08.test.js"):
                continue
            evidence = content if not value.get("contentOmitted") else ""
            evidence += "\n".join(str(m.get("text", "")) + "\n" + str(m.get("context", ""))
                                   for m in value.get("matches", []) if isinstance(m, dict))
            for label, marker in (("correctSessionInitializer", "store.startSession"),
                                  ("targetSessionDisplayId", "id: `${sessionId}")):
                pos = evidence.find(marker)
                if pos >= 0:
                    key = (label, call_id)
                    if key not in facts:
                        facts[key] = {"fact": label, "callId": call_id, "requests": [], "path": path,
                                      "excerpt": evidence[max(0, pos - 70):pos + 180]}
                    facts[key]["requests"].append(number)
    unique_omissions = {e["callId"] for e in reads.values() if e["outboundContentOmitted"] or e["outboundOmissionText"]}
    assert unique_omissions
    samples.append({"sampleId": sid, "requestBindings": requests,
                    "candidateReadbacks": list(reads.values()), "visibleSourceFacts": list(facts.values()),
                    "uniqueCandidateReadsOmitted": len(unique_omissions),
                    "rawHostReadIsNotProofOfOutboundVisibility": True,
                    "reviewMetadata": sample.get("changeReview"),
                    "modelFinalAccount": sample["model"]["final"]["result"]})
result = {"schema": 1, "executionSource": report["source"], "projectSource": report["projectSource"],
          "artifactId": artifact["id"], "artifactDigest": artifact["digest"],
          "archiveDigestVerified": True, "summaryDigestVerified": True,
          "externalModelRequests": 0, "samples": samples,
          "causalLimit": "Actual read projection failures are proven; effect on a new model task outcome remains unmeasured. Original candidate mistakes and failed scores remain."}
serialized = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
assert not re.search(rb"\bsk-[A-Za-z0-9_-]{20,}\b", serialized)
(round_dir / "harness-audit-20261104/outbound-read-evidence.json").write_bytes(serialized)
print(json.dumps({"requestsAudited": 42, "samples": [
    {"sampleId": s["sampleId"], "omittedReadCalls": s["uniqueCandidateReadsOmitted"]} for s in samples
], "externalModelRequests": 0}))
