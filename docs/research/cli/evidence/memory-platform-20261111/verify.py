"""Offline receipt audit; requires the recorded commits in this Git clone."""
import gzip
import hashlib
import json
import math
import posixpath
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path):
    return json.loads(path.read_bytes())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def near(actual, expected):
    require(math.isfinite(actual) and abs(actual - expected) < 0.00001,
            f"inconsistent timing: {actual} != {expected}")


def source_bindings(report, kind):
    if kind in ("stop", "mixed"):
        return {posixpath.normpath("packages/cli/scripts/" + p): v
                for p, v in report["sourceDigests"].items()}
    if kind == "compound":
        identity = report["sourceIdentity"]
        return {**identity["localSha256"], **{
            "packages/context-memory-kernel/" + p: v
            for p, v in identity["kernel"]["sha256"].items()}}
    if kind == "query-index":
        def resolve(p):
            if p.startswith("kernel/"):
                return "packages/context-memory-kernel/lib/" + p[7:]
            return {
                "fixture-generator.mjs": "packages/cli/scripts/persistent-capacity-benchmark.mjs",
                "benchmark.mjs": "packages/cli/scripts/memory-query-index-benchmark.mjs",
                "with-file-lock.js": "packages/cli/src/lib/with-file-lock.js",
                "secure-file-identity.js": "packages/cli/src/lib/secure-file-identity.js",
            }.get(p, "packages/cli/src/lib/context-memory-kernel/" + p)
        return {resolve(p): v for p, v in report["implementationSha256"].items()}
    return {}


def verify_git_bindings(bindings):
    git = shutil.which("git") or "C:/Program Files/Git/cmd/git.exe"
    keys = sorted(bindings)
    for commit, name in keys:
        require(len(commit) == 40 and all(c in "0123456789abcdef" for c in commit), "invalid commit")
        require(name.startswith("packages/") and "\n" not in name and ".." not in name.split("/"), "invalid source path")
    specs = [(commit + ":" + name).encode() for commit, name in keys]
    raw = subprocess.check_output([git, "cat-file", "--batch"], cwd=REPO,
                                  input=b"\n".join(specs) + b"\n")
    offset = 0
    for key in keys:
        end = raw.index(b"\n", offset)
        header = raw[offset:end].split()
        require(len(header) == 3 and header[1] == b"blob", f"missing source: {key}")
        size = int(header[2])
        data = raw[end + 1:end + 1 + size]
        require(sha(data) == bindings[key].removeprefix("sha256:"), f"source mismatch: {key}")
        offset = end + size + 2
    return len(keys)


def audit_stop(report):
    require(report["providerCalls"] == 0, "unexpected provider calls")
    require(report["target"] == {"maximumStopDeliveryDelayMs": 500,
                                  "maximumStopAcknowledgementMs": 500}, "changed Stop limits")
    require([t["count"] for t in report["tiers"]] == [1000, 10000, 100000], "missing Stop tiers")
    cases = []
    for tier in report["tiers"]:
        require(set(tier["modes"]) == {"validate-disk", "verified-memory"}, "missing Stop mode")
        for mode, group in tier["modes"].items():
            samples = group["samples"]
            require(len(samples) == report["samplesPerCase"], "missing Stop samples")
            acknowledged = before = after = violations = late = 0
            for sample in samples:
                require(sample["lockReleased"] is True and sample["scheduledStopMs"] == 10, "Stop lock/deadline")
                outcome = sample["outcome"]
                require(outcome in ("aborted", "completed"), "unknown outcome")
                near(sample["stopDeliveryDelayMs"], max(0, sample["deliveredStopMs"] - 10))
                if outcome == "aborted":
                    acknowledged += 1
                    require(sample["resultCount"] is None and not sample["completedBeforeStopDelivery"], "false ACK")
                    require(sample["queryMs"] >= sample["deliveredStopMs"], "ACK predates Stop")
                    near(sample["stopAcknowledgementMs"], sample["queryMs"] - sample["deliveredStopMs"])
                else:
                    require(sample["resultCount"] == 20 and sample["stopAcknowledgementMs"] is None, "completion counted as ACK")
                    before += int(sample["completedBeforeStopDelivery"])
                    after += int(not sample["completedBeforeStopDelivery"])
                    late += int(sample["queryMs"] > 10)
                    # Clock ties cannot establish event ordering; use the captured signal state.
                    if sample["queryMs"] != sample["deliveredStopMs"]:
                        require(sample["completedBeforeStopDelivery"] == (sample["queryMs"] < sample["deliveredStopMs"]), "Stop ordering")
                require(sample["completedBeforeStopDeadline"] == (outcome == "completed" and sample["queryMs"] <= 10), "nominal deadline")
                violations += int(sample["stopDeliveryDelayMs"] > 500 or (sample["stopAcknowledgementMs"] or 0) > 500)
            for key, value in {"acknowledged": acknowledged, "completedBeforeStopDelivery": before,
                               "successfulCompletionAfterStopDelivery": after, "lateSuccessfulCompletion": late}.items():
                require(group[key] == value, "Stop counter: " + key)
            passed = after == 0 and violations == 0
            require(group["targetMet"] == passed and group["authorityUnchanged"] is True, "false Stop target")
            cases.append({"count": tier["count"], "mode": mode, "samples": len(samples),
                          "acknowledged": acknowledged, "beforeDelivery": before, "afterDelivery": after,
                          "limitViolations": violations, "targetMet": passed})
    require(report["targetMet"] == all(c["targetMet"] for c in cases), "false overall Stop target")
    return {"targetMet": report["targetMet"], "cases": cases}


def audit_report(report, kind, commit):
    if kind == "stop":
        return audit_stop(report)
    if kind == "file-identity":
        return {"scope": "raw diagnostic only"}
    require(report["complete"] is True, "incomplete " + kind)
    require([t["count"] for t in report["tiers"]] == [1000, 10000, 100000], "missing tiers")
    samples = report.get("samples", report.get("roundsPerTier"))
    if kind in ("query-index", "compound"):
        require(report["sourceHead"] == commit and report["workingTree"] == "clean", "source identity")
    if kind == "compound":
        require(all(report[k] is True for k in ("cleanupComplete", "gitStable", "sourceStable")), "compound final audit")
        require(report["sampleMatrixComplete"] == (samples >= 100), "compound full-sample claim")
        require(report["performanceAccepted"] is False, "unexpected SLO admission")
    total = 0
    for tier in report["tiers"]:
        if kind == "mixed":
            require(tier["complete"] and tier["finalAuditVerified"] and tier["lockReleased"] and tier["finalDeletionVisibilityVerified"], "mixed final audit")
            require(len(tier["rounds"]) == samples and report["concurrency"] == 8, "mixed coverage")
            for round_ in tier["rounds"]:
                require(round_["generationsVerified"] and len(round_["results"]) == 8, "mixed round")
            total += samples
            continue
        groups = tier["groups"]
        expected_groups = {"baseline", "cold", "hot", "rebuild", "corrupt"} if kind == "query-index" else {"category-narrow", "tag-narrow", "cold-continuation"}
        require(set(groups) == expected_groups, "missing query scenarios")
        if kind == "compound":
            require(tier["complete"] and tier["finalAuditVerified"] and tier["oracle"]["fullAuthorityVerified"], "compound tier")
            require(tier["semantics"]["allPages"]["noDuplicates"] and tier["semantics"]["allPages"]["fullOracleVerified"], "compound pagination")
        for group in groups.values():
            require(group["complete"] and len(group["samples"]) == samples, "query coverage")
            for sample in group["samples"]:
                expected = tier["expectedDigest"] if kind == "query-index" else group["expectedDigest"]
                require(sample["rowsDigest"] == expected, "oracle digest")
                if kind == "compound":
                    require(sample["oracleVerified"] and sample["manifestUnchanged"] and sample["initialCompiledIndexCount"] == 0, "cold query semantics")
                    rows = json.dumps(sample["entries"], ensure_ascii=False, separators=(",", ":")).encode()
                    require("sha256:" + sha(rows) == expected, "compound row bytes")
            total += samples
    return {"samplesPerCase": samples, "observations": total, "complete": True}


def audit_archive(directory, expected_samples, include_local, bindings):
    manifest = read_json(directory / "manifest.json")
    require(manifest["hostedSamplesPerCase"] == expected_samples, "archive sample scale")
    require(len(manifest["records"]) == 13 + int(include_local), "missing original reports")
    for entry in manifest["metadata"]:
        require(sha((directory / entry["path"]).read_bytes()) == entry["sha256"], "metadata bytes")
    jobs = read_json(directory / "jobs.json")["jobs"]
    require(len(jobs) == 12 and all(j["conclusion"] == "success" and j["run_id"] == manifest["hostedRunId"] for j in jobs), "hosted job verdicts")
    artifacts = {a["id"]: a for a in read_json(directory / "artifacts.json")["artifacts"]}
    require(len(artifacts) == 13, "missing hosted artifacts")
    require(set(artifacts) == {r["artifactId"] for r in manifest["records"] if "artifactId" in r}, "artifact coverage")
    summaries = []
    for entry in manifest["records"]:
        path = (directory / entry["path"]).resolve()
        require(path.is_relative_to(directory), "unsafe archive path")
        compressed = path.read_bytes()
        require(sha(compressed) == entry["archiveSha256"], "archive bytes: " + entry["path"])
        raw = gzip.decompress(compressed)
        require(sha(raw) == entry["rawSha256"], "raw bytes: " + entry["path"])
        report = json.loads(raw)
        if "artifactId" in entry:
            artifact = artifacts[entry["artifactId"]]
            require(artifact["workflow_run"]["head_sha"] == entry["matchedSourceCommit"] == manifest["hostedSourceCommit"], "artifact source")
            require(artifact["workflow_run"]["id"] == manifest["hostedRunId"], "artifact run")
            require(artifact["digest"] == entry["upstreamZipDigestNotLocallyRecomputed"], "upstream digest metadata")
            if entry["kind"] != "file-identity":
                require(report.get("samplesPerCase", report.get("samples", report.get("roundsPerTier"))) == expected_samples, "hosted sample scale")
        result = audit_report(report, entry["kind"], entry["matchedSourceCommit"])
        if entry["kind"] == "stop":
            require(result["targetMet"] == ("artifactId" in entry), "Stop verdict differs from recorded outcome")
        for name, digest in source_bindings(report, entry["kind"]).items():
            digest = digest.removeprefix("sha256:")
            key = (entry["matchedSourceCommit"], name)
            require(key not in bindings or bindings[key] == digest, f"conflicting source bytes: {key}")
            bindings[key] = digest
        summaries.append({"record": path.relative_to(HERE).as_posix(), **result})
    return summaries


def main():
    bindings = {}
    summaries = audit_archive(HERE, 11, True, bindings)
    summaries += audit_archive(HERE / "full-100", 100, False, bindings)
    count = verify_git_bindings(bindings)
    print(json.dumps({"recordsVerified": len(summaries), "sourceByteBindingsVerified": count,
                      "summaries": summaries, "fullDependencyClosureVerified": False,
                      "paidReady": False}, indent=2))


if __name__ == "__main__":
    main()
