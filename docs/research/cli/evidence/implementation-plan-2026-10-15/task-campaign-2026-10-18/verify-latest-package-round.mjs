#!/usr/bin/env node
/** Offline latest-package evidence validation; never executes candidates or providers. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const parsed = (bytes) => JSON.parse(bytes.toString("utf8"));
const sorted = (items) => [...items].sort();
function relativeName(name) {
  assert.equal(typeof name, "string");
  assert.ok(name.length && !name.includes("\\") && !name.includes(":"));
  assert.ok(
    !path.posix.isAbsolute(name) &&
      name.split("/").every((p) => p && p !== "." && p !== ".."),
    "unsafe evidence path",
  );
  return name;
}
function unique(items, label) {
  assert.equal(new Set(items).size, items.length, `duplicate ${label}`);
  return items;
}

export function validateDocumentReceipt(task, receipt, body, plan, planDigest) {
  assert.equal(task.id, "verify-34");
  assert.equal(receipt.taskId, task.id);
  assert.equal(receipt.stage, "check");
  assert.equal(receipt.pass, true);
  assert.deepEqual(task.expectedFiles, [
    "docs/development/verify-34-outcome-runbook.md",
  ]);
  assert.ok(body.trim().length >= 300);
  for (const expression of [
    "task-outcome-report\\.mjs",
    "--fingerprint",
    "INSUFFICIENT_EVIDENCE",
    "(?:null|unknown|未知)",
    "(?:退出|exit|code)[^\\n]{0,40}2",
    "(?:不得|禁止|not|never)[^\\n]{0,60}(?:PASS|改善)",
  ])
    assert.match(body, new RegExp(expression, "iu"));
  assert.deepEqual(receipt.document, {
    fingerprint: planDigest,
    missingTaskSamples: 36,
    missingFirstRunSamples: 9,
  });
  const command = [
    "node",
    "packages/cli/scripts/task-outcome-report.mjs",
    "--plan",
    "/review/plan.json",
  ];
  const executions = receipt.executions.filter((e) =>
    e.command?.includes(command[1]),
  );
  assert.equal(executions.length, 2);
  const [fingerprint, empty] = executions;
  assert.deepEqual(fingerprint.command, [...command, "--fingerprint"]);
  assert.deepEqual(empty.command, [...command, "--plan-digest", planDigest]);
  for (const e of executions) {
    assert.equal(e.setup, false);
    assert.equal(e.error, null);
    assert.equal(e.signal, null);
  }
  assert.equal(fingerprint.exitCode, 0);
  assert.equal(fingerprint.stdout.trim(), planDigest);
  assert.equal(empty.exitCode, 2);
  const report = JSON.parse(empty.stdout);
  assert.equal(report.schema, "chainlesschain.outcome-report/v1");
  assert.equal(report.planDigest, planDigest);
  assert.equal(report.commitSha, plan.commitSha);
  assert.equal(report.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.improvementVerdict, "NOT_EVALUATED");
  assert.equal(report.productionAttested, false);
  for (const [key, count] of [
    ["task", 36],
    ["firstRun", 9],
  ]) {
    assert.equal(report[key].planned, count);
    assert.equal(report[key].observed, 0);
    assert.equal(report[key].missing, count);
    assert.equal(report[key].succeeded, 0);
    assert.equal(report[key].totalCost, null);
    assert.equal(report[key].costPerSuccess, null);
  }
  assert.deepEqual(
    sorted(report.rows.map((s) => s.sampleId)),
    sorted(plan.samples.map((s) => s.id)),
  );
  for (const row of report.rows) {
    assert.equal(row.observed, false);
    assert.equal(row.succeeded, false);
    assert.equal(row.cost, null);
    assert.ok(row.reasons.includes("missing_observation"));
  }
}

export function verifyLatestPackageRound(options = {}) {
  const root = path.resolve(options.root ?? here);
  const repository = path.resolve(
    options.repository ??
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
  );
  const prefix = path.relative(repository, root).replaceAll("\\", "/");
  relativeName(prefix);
  const cache = new Map();
  function repositoryRead(name) {
    relativeName(name);
    if (cache.has(name)) return cache.get(name);
    let bytes;
    if (options.readRepository) bytes = options.readRepository(name);
    else if (options.gitHead) {
      const mode = execFileSync("git", ["ls-tree", "HEAD", "--", name], {
        cwd: repository,
        encoding: "utf8",
      });
      assert.match(mode, /^100(?:644|755) blob /u, "regular Git blob required");
      bytes = execFileSync("git", ["show", `HEAD:${name}`], {
        cwd: repository,
        maxBuffer: 64 * 1024 * 1024,
      });
    } else {
      const target = path.join(repository, name);
      const resolved = fs.realpathSync(target);
      const rel = path.relative(repository, resolved);
      assert.ok(
        rel && !rel.startsWith("..") && !path.isAbsolute(rel),
        "file escapes repository",
      );
      assert.ok(fs.lstatSync(target).isFile(), "regular file required");
      bytes = fs.readFileSync(target);
    }
    cache.set(name, bytes);
    return bytes;
  }
  const read = (name) => {
    relativeName(name);
    if (!options.readEvidence && !options.gitHead) {
      const rel = path.relative(
        fs.realpathSync(root),
        fs.realpathSync(path.join(root, name)),
      );
      assert.ok(
        rel && !rel.startsWith("..") && !path.isAbsolute(rel),
        "file escapes evidence root",
      );
    }
    return options.readEvidence
      ? options.readEvidence(name)
      : repositoryRead(prefix + "/" + name);
  };
  const json = (name) => parsed(read(name));
  function archive(entry) {
    const bytes = read(entry.path);
    assert.equal(
      hash(bytes),
      entry.storedDigest,
      `stored digest ${entry.path}`,
    );
    const raw = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
    assert.equal(
      hash(raw),
      entry.originalDigest,
      `original digest ${entry.path}`,
    );
    assert.equal(
      raw.length,
      entry.originalBytes,
      `original length ${entry.path}`,
    );
    return raw;
  }
  const data = json("latest-package-round.json");
  assert.equal(data.schema, "chainlesschain.latest-package-task-round/v1");
  assert.equal(data.billingAssessed, false);
  const planRoot = "docs/research/cli/verify01-plan-2026-10-13-volcengine/";
  const plan = parsed(repositoryRead(planRoot + "plan.json"));
  const catalog = parsed(repositoryRead(planRoot + "tasks.json"));
  const planDigest = repositoryRead(planRoot + "plan.sha256")
    .toString("utf8")
    .trim();
  assert.equal(data.frozenProjectCommit, plan.commitSha);
  const expected = new Map(plan.samples.map((s) => [s.id, s]));
  assert.equal(expected.size, 45);
  const audit = json("native45-independent-audit.json");
  assert.deepEqual(
    sorted(
      unique(
        audit.samples45.map((s) => s.sampleId),
        "audit samples",
      ),
    ),
    sorted(expected.keys()),
  );
  const samples = new Map(data.samples.map((s) => [s.sampleId, s]));
  assert.equal(data.samples.length, 45);
  assert.equal(samples.size, 45);
  assert.deepEqual(sorted(samples.keys()), sorted(expected.keys()));
  for (const s of samples.values()) {
    const p = expected.get(s.sampleId);
    assert.equal(s.taskId, p.taskId);
    assert.equal(s.kind, p.kind);
    assert.equal(s.group, p.stratum.replace(/-volcengine$/u, ""));
    const a = audit.samples45.find((x) => x.sampleId === s.sampleId);
    assert.equal(a.taskId, p.taskId);
    assert.equal(a.kind, p.kind);
    assert.equal(a.stratum, p.stratum);
  }
  assert.equal(data.samples.filter((s) => s.kind === "task").length, 36);
  assert.equal(data.samples.filter((s) => s.kind === "first-run").length, 9);
  const pinnedBytes = repositoryRead(data.packageSetPath);
  assert.equal(hash(pinnedBytes), data.packageSetDigest);
  const pinned = parsed(pinnedBytes);
  assert.equal(pinned.schema, "chainlesschain.native-package-set/v1");
  assert.deepEqual(pinned.versions, data.versions);
  assert.deepEqual(
    sorted(Object.keys(data.versions)),
    sorted(["cli", "vscode", "jetbrains", "vscodeHost", "jetbrainsHost"]),
  );
  for (const [key, value] of Object.entries(data.versions))
    assert.match(
      value,
      key === "jetbrainsHost" ? /^\d+\.\d+(?:\.\d+)?$/u : /^\d+\.\d+\.\d+$/u,
    );
  const registry = new Map(
    data.registryEvidence.map((e) => [
      path.posix.basename(e.path),
      parsed(archive(e)),
    ]),
  );
  assert.equal(registry.size, 3);
  const npm = registry.get("npm-latest.json.gz"),
    vs = registry.get("openvsx-latest.json.gz"),
    jb = registry.get("jetbrains-updates.json.gz");
  assert.equal(npm.name, "chainlesschain");
  assert.equal(npm.version, data.versions.cli);
  assert.equal(
    pinned.origin.cli.url,
    "https://registry.npmjs.org/chainlesschain/latest",
  );
  assert.equal(npm.dist.integrity, pinned.origin.cli.integrity);
  assert.equal(npm.dist.tarball, pinned.origin.cli.tarball);
  assert.equal(vs.namespace, "chainlesschain");
  assert.equal(vs.name, "chainlesschain-ide");
  assert.equal(vs.version, data.versions.vscode);
  assert.ok(vs.versionAlias.includes("latest"));
  assert.equal(vs.files.download, pinned.origin.vscode.download);
  const approved = jb.filter(
    (r) => r.approve === true && r.listed === true && r.hidden === false,
  );
  assert.ok(approved.length);
  const versionCompare = (a, b) => {
    assert.match(a.version, /^\d+\.\d+\.\d+$/u);
    assert.match(b.version, /^\d+\.\d+\.\d+$/u);
    const aa = a.version.split(".").map(Number),
      bb = b.version.split(".").map(Number);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  };
  approved.sort(versionCompare);
  const latestJb = approved.at(-1);
  assert.equal(latestJb.version, data.versions.jetbrains);
  assert.equal(latestJb.id, pinned.origin.jetbrains.updateId);
  assert.equal(latestJb.file, pinned.origin.jetbrains.file);
  assert.equal(latestJb.pluginId, 32208);

  const deliveries = json("native-verified-deliveries.json");
  const acceptedIds = new Set(
    deliveries
      .filter((d) => d.candidateAcceptancePassed === true)
      .map((d) => d.sampleId),
  );
  assert.equal(acceptedIds.size, 20);
  assert.equal(data.reusedAcceptedSamples, 20);
  assert.equal(data.plannedNewSamples, 25);
  const oldResults = json("results.json");
  const oldRaw = new Map();
  function oldBatch(batch) {
    assert.ok(batch, "historical bound summary missing");
    if (!oldRaw.has(batch.rawSummary.originalDigest))
      oldRaw.set(
        batch.rawSummary.originalDigest,
        parsed(archive(batch.rawSummary)),
      );
    return oldRaw.get(batch.rawSummary.originalDigest);
  }
  function validateReceipts(row, getFile, getCandidate) {
    for (const stage of ["setup", "check"]) {
      const step = row[stage];
      if (!step) continue;
      assert.ok(step.receiptPath, "checker stage requires its receipt");
      relativeName(step.receiptPath);
      const raw = getFile(step.receiptPath);
      assert.equal(hash(raw), step.receiptDigest);
      const receipt = parsed(raw);
      assert.equal(receipt.taskId, row.taskId);
      assert.equal(receipt.stage, stage);
      assert.equal(receipt.pass, step.pass);
      for (const key of ["tests", "mutations"])
        if (key in step) assert.deepEqual(step[key], receipt[key]);
      if (receipt.pass) {
        assert.ok(
          receipt.tests?.some((t) => t.kind === "baseline" && t.total > 0),
        );
        for (const t of receipt.tests) {
          assert.ok(t.total > 0);
          assert.equal(t.failed, 0);
          assert.equal(t.passed, t.total);
        }
        if (stage === "check" && row.taskId === "verify-34") {
          const task = catalog.tasks.find((t) => t.id === row.taskId);
          validateDocumentReceipt(
            task,
            receipt,
            getCandidate(task.expectedFiles[0]).toString("utf8"),
            plan,
            planDigest,
          );
        } else if (stage === "check") {
          assert.ok(
            receipt.tests.some((t) => t.kind === "candidate" && t.total > 0),
          );
          assert.ok(receipt.mutations?.length);
          for (const m of receipt.mutations)
            assert.ok(
              m.total > 0 && m.failed > 0,
              "passing candidate must reject behavioral mutants",
            );
        }
      }
    }
    const candidatePassed =
      row.setup?.pass === true && row.check?.pass === true;
    assert.equal(row.candidateAcceptancePassed, candidatePassed);
    assert.equal(row.passed, row.generationPassed === true && candidatePassed);
  }
  for (const sample of samples.values()) {
    assert.equal(
      sample.newModelGenerationRequired,
      !acceptedIds.has(sample.sampleId),
    );
    if (sample.newModelGenerationRequired) {
      assert.equal(sample.reusedDelivery, undefined);
      continue;
    }
    assert.equal(sample.status, "REUSED_ACCEPTED_DELIVERABLE");
    assert.equal(sample.latestPackageGenerationObserved, false);
    assert.equal(sample.latestGenerationRunId, undefined);
    const reuse = sample.reusedDelivery;
    const matches = deliveries.filter(
      (d) =>
        d.sampleId === sample.sampleId &&
        d.generationRun === reuse.generationRun &&
        d.acceptanceRun === reuse.acceptanceRun &&
        d.sourceSummaryDigest === reuse.sourceSummaryDigest,
    );
    assert.equal(matches.length, 1);
    const delivery = matches[0];
    for (const key of Object.keys(reuse))
      assert.deepEqual(reuse[key], delivery[key]);
    assert.equal(reuse.candidateAcceptancePassed, true);
    const genBatch = oldResults.native45.results.find(
      (b) =>
        b.stage === "generation" &&
        b.runId === reuse.generationRun &&
        b.rawSummary.originalDigest === reuse.sourceSummaryDigest,
    );
    const gen = oldBatch(genBatch);
    assert.equal(gen.executionSourceCommit, reuse.deliverySourceCommit);
    const accBatch = oldResults.native45.results.find(
      (b) =>
        b.stage === "acceptance" &&
        b.runId === reuse.acceptanceRun &&
        b.sourceSummaryDigest === reuse.sourceSummaryDigest,
    );
    const acc = oldBatch(accBatch);
    assert.equal(acc.sourceSummaryDigest, reuse.sourceSummaryDigest);
    assert.equal(
      acc.deliverySourceCommit ?? acc.executionSourceCommit,
      reuse.deliverySourceCommit,
    );
    const native = gen.samples.find((s) => s.sampleId === sample.sampleId),
      checked = acc.samples.find((s) => s.sampleId === sample.sampleId);
    assert.ok(native && checked);
    assert.equal(checked.candidateAcceptancePassed, true);
    assert.equal(checked.passed, reuse.endToEndPassed);
    const fileMap = new Map();
    for (const file of reuse.files) {
      relativeName(file.originalArtifactPath);
      assert.equal(file.sampleId, sample.sampleId);
      assert.equal(
        file.runId,
        file.stage === "generation" ? reuse.generationRun : reuse.acceptanceRun,
      );
      assert.ok(["generation", "acceptance"].includes(file.stage));
      const raw = read(file.path);
      assert.equal(hash(raw), file.digest);
      const key = file.stage + "/" + file.originalArtifactPath;
      assert.ok(!fileMap.has(key));
      fileMap.set(key, raw);
    }
    for (const candidate of native.candidates) {
      const raw = fileMap.get("generation/" + candidate.path);
      assert.ok(raw);
      assert.equal(hash(raw), candidate.digest);
      assert.equal(raw.length, candidate.bytes);
    }
    validateReceipts(
      checked,
      (p) => {
        const raw = fileMap.get("acceptance/" + p);
        assert.ok(raw);
        return raw;
      },
      (p) => fileMap.get(`generation/${sample.sampleId}/candidate/${p}`),
    );
  }
  assert.equal(data.runs.length, 9);
  unique(
    data.runs.map((r) => r.runId),
    "run IDs",
  );
  unique(
    data.runs.map((r) => r.group),
    "groups",
  );
  const selectedIds = unique(
    data.runs.flatMap((r) => r.selectedSampleIds),
    "selected samples",
  );
  assert.deepEqual(
    sorted(selectedIds),
    sorted(
      data.samples
        .filter((s) => s.newModelGenerationRequired)
        .map((s) => s.sampleId),
    ),
  );
  assert.equal(selectedIds.length, 25);
  const counts = {
    newGenerationRecordsCollected: 0,
    newAcceptanceRecordsCollected: 0,
    newCandidateAcceptancePassed: 0,
    newEndToEndPassed: 0,
    cumulativeAcceptedDeliverables: 20,
  };
  for (const run of data.runs) {
    assert.match(run.sourceCommit, /^[a-f0-9]{40}$/u);
    assert.match(run.runId, /^\d+$/u);
    for (const id of run.selectedSampleIds) {
      assert.equal(samples.get(id)?.group, run.group);
      assert.ok(!acceptedIds.has(id));
    }
    const evidence = new Map();
    for (const item of run.evidence ?? []) {
      assert.ok(["generation", "acceptance"].includes(item.stage));
      relativeName(item.originalArtifactPath);
      const key = item.stage + "/" + item.originalArtifactPath;
      assert.ok(!evidence.has(key));
      evidence.set(key, archive(item.archived));
    }
    const getFile = (stage, member) => {
      relativeName(member);
      const raw = evidence.get(stage + "/" + member);
      assert.ok(raw, `missing ${stage}/${member}`);
      return raw;
    };
    const rawStages = {};
    for (const stage of ["generation", "acceptance"]) {
      if (!run[stage]) continue;
      const ref = run[stage];
      assert.ok(Number.isSafeInteger(ref.artifactId) && ref.artifactId > 0);
      assert.equal(
        ref.artifactName,
        `verify01-native-subset-${stage === "generation" ? "delivery" : "acceptance"}-${run.group}-${run.sourceCommit}`,
      );
      const raw = parsed(archive(ref.rawSummary));
      rawStages[stage] = raw;
      assert.equal(
        raw.schema,
        `chainlesschain.verify01-native-task-${stage === "generation" ? "campaign" : "acceptance"}/v1`,
      );
      assert.equal(raw.executionSourceCommit, run.sourceCommit);
      assert.equal(raw.group, run.group);
      assert.equal(raw.projectCommit, data.frozenProjectCommit);
      assert.equal(raw.planDigest, planDigest);
      assert.deepEqual(raw.versions, data.versions);
      assert.equal(raw.packageSetDigest, data.packageSetDigest);
      assert.equal(raw.selectionScope, "operator-subset");
      assert.deepEqual(
        sorted(
          unique(
            raw.samples.map((s) => s.sampleId),
            "raw samples",
          ),
        ),
        sorted(run.selectedSampleIds),
      );
      assert.deepEqual(
        sorted(raw.selectedSampleIds),
        sorted(run.selectedSampleIds),
      );
      assert.deepEqual(
        ref.sampleIds,
        raw.samples.map((s) => s.sampleId),
      );
      for (const row of raw.samples) {
        assert.deepEqual(row.versions, data.versions);
        assert.equal(row.packageSetDigest, data.packageSetDigest);
        const sample = samples.get(row.sampleId);
        assert.equal(row.taskId, sample.taskId);
        assert.equal(row.kind, sample.kind);
      }
    }
    const gen = rawStages.generation,
      acc = rawStages.acceptance;
    const [platform, entry] = run.group.split("-");
    if (gen) {
      assert.equal(gen.actualPlatform, platform);
      assert.equal(gen.actualEntry, entry);
    }
    if (acc) {
      assert.equal(acc.acceptanceHost, "linux-docker");
      assert.equal(acc.actualGenerationHost.platform, platform);
      assert.equal(acc.actualGenerationHost.entry, entry);
    }
    if (acc) {
      assert.ok(gen);
      assert.equal(
        acc.sourceSummaryDigest,
        run.generation.rawSummary.originalDigest,
      );
      assert.equal(acc.deliverySourceCommit, run.sourceCommit);
    }
    if (gen) {
      assert.deepEqual(getFile("generation", "package-set.json"), pinnedBytes);
      counts.newGenerationRecordsCollected += gen.samples.length;
      assert.equal(
        gen.generationPassed,
        gen.samples.every((s) => s.generationPassed),
      );
      for (const row of gen.samples) {
        assert.equal(row.executionSourceCommit, run.sourceCommit);
        assert.equal(row.projectCommit, data.frozenProjectCommit);
        assert.equal(row.planDigest, planDigest);
        const task = catalog.tasks.find((t) => t.id === row.taskId);
        assert.ok(task);
        for (const candidate of row.candidates ?? []) {
          assert.ok(task.expectedFiles.includes(candidate.file));
          assert.equal(
            candidate.path,
            `${row.sampleId}/candidate/${candidate.file}`,
          );
          const bytes = getFile("generation", candidate.path);
          assert.equal(hash(bytes), candidate.digest);
          assert.equal(bytes.length, candidate.bytes);
        }
        const sample = samples.get(row.sampleId);
        assert.equal(sample.latestPackageGenerationObserved, true);
        assert.equal(sample.latestGenerationRunId, run.runId);
        assert.equal(
          sample.sourceSummaryDigest,
          run.generation.rawSummary.originalDigest,
        );
        for (const key of ["generationPassed", "host", "brokerStatus"])
          assert.deepEqual(sample[key], row[key]);
        assert.equal(
          sample.modelFailureCategory,
          row.model?.failureCategory ?? null,
        );
        if (!acc) {
          assert.equal(sample.status, "AWAITING_LATEST_ACCEPTANCE");
          assert.equal(sample.candidateAcceptancePassed, undefined);
          assert.equal(sample.endToEndPassed, undefined);
        }
      }
    } else
      for (const id of run.selectedSampleIds) {
        const s = samples.get(id);
        assert.equal(s.status, "PENDING_LATEST_EXECUTION");
        assert.equal(s.latestPackageGenerationObserved, false);
        for (const key of [
          "latestGenerationRunId",
          "sourceSummaryDigest",
          "generationPassed",
          "candidateAcceptancePassed",
          "endToEndPassed",
        ])
          assert.equal(s[key], undefined);
      }
    if (acc) {
      counts.newAcceptanceRecordsCollected += acc.samples.length;
      for (const row of acc.samples) {
        validateReceipts(
          row,
          (member) => getFile("acceptance", member),
          (p) => getFile("generation", `${row.sampleId}/candidate/${p}`),
        );
        const native = gen.samples.find((s) => s.sampleId === row.sampleId);
        assert.equal(
          row.originalGenerationPassed,
          native.generationPassed === true,
        );
        if (row.passed) {
          assert.equal(native.host.passed, true);
          assert.equal(native.sourceScopePassed, true);
          assert.notEqual(row.frozenSourceAssessment?.exact, false);
        }
        const s = samples.get(row.sampleId);
        assert.equal(
          s.candidateAcceptancePassed,
          row.candidateAcceptancePassed,
        );
        assert.equal(s.endToEndPassed, row.passed);
        assert.equal(
          s.status,
          row.candidateAcceptancePassed
            ? "LATEST_CANDIDATE_ACCEPTED"
            : "LATEST_ATTEMPT_FAILED",
        );
        counts.newCandidateAcceptancePassed += Number(
          row.candidateAcceptancePassed,
        );
        counts.newEndToEndPassed += Number(row.passed);
      }
      assert.equal(
        acc.passed,
        acc.samples.every((s) => s.passed),
      );
    }
    const complete = run.remoteStatus === "completed" && Boolean(gen && acc);
    if (complete)
      for (const raw of [gen, acc])
        assert.ok(
          typeof raw.finishedAt === "string" &&
            Number.isFinite(Date.parse(raw.finishedAt)),
          "completed summary needs finish time",
        );
    assert.equal(run.status, complete ? "COMPLETED" : "IN_PROGRESS");
  }
  counts.cumulativeAcceptedDeliverables += counts.newCandidateAcceptancePassed;
  assert.deepEqual(data.counts, counts);
  const complete = data.runs.every((r) => r.status === "COMPLETED");
  assert.equal(data.status, complete ? "COMPLETED" : "IN_PROGRESS");
  if (complete || options.requireComplete) {
    assert.equal(complete, true, "latest package round incomplete");
    assert.equal(counts.newGenerationRecordsCollected, 25);
    assert.equal(counts.newAcceptanceRecordsCollected, 25);
  }
  return {
    status: data.status,
    reusedAcceptedDeliverables: 20,
    plannedNewSamples: 25,
    counts,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const arg of process.argv.slice(2))
    assert.ok(
      ["--git-head", "--require-complete"].includes(arg),
      `unknown option ${arg}`,
    );
  console.log(
    JSON.stringify(
      verifyLatestPackageRound({
        gitHead: process.argv.includes("--git-head"),
        requireComplete: process.argv.includes("--require-complete"),
      }),
    ),
  );
}
