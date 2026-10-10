import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import identity from "./diagnostics/windows-node-private-v4-identity.cjs";
import {
  verifyPrivateV4DependencyManifest,
  readPrivateV4DependencyFile,
} from "./windows-node-private-v4-dependencies.mjs";

export const PRIVATE_V4_EXPERIMENT = "original-frozen-config-tests";
export const PRIVATE_V4_SOURCE_CLOSURE_DIGEST =
  "sha256:b8a63ab9af6e4d9be9469af2c07416d350b5a1f70301b40d8f89ffbc0f1ea658";
const sourceNames = [
  "windows-node-private-v4-broker.cpp",
  "windows-node-private-v4-adapter.cpp",
  "windows-node-private-v4-adapter.h",
  "windows-node-private-v4-paired.h",
  "windows-node-private-v4-protocol.h",
  "windows-esbuild-private-map-supervisor.cpp",
  "windows-esbuild-private-map-shim.cpp",
  "windows-node-private-v4-identity.cjs",
  "windows-node-private-v4-preload.cjs",
];
const outputNames = [
  "broker.exe",
  "windows-node-private-v4.node",
  "esbuild-private-shim.dll",
];
const basename = (value) =>
  typeof value === "string"
    ? value.replaceAll("\\", "/").split("/").at(-1)
    : "";
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const same = isDeepStrictEqual;
const hostTerminatedWorker = (row) =>
  row?.kind === "vitest-worker" &&
  row.exit === 1 &&
  row.terminationRequested === true &&
  row.terminationExitCode === 1 &&
  row.preTerminationWait === 258 &&
  row.preTerminationExit === 259 &&
  row.terminationCallSucceeded === true &&
  row.terminationCallError === 0 &&
  row.terminationWait === 0 &&
  row.actualExit === 1 &&
  row.terminationRequesterRegistrationId === row.parentRegistrationId &&
  positive(row.creationSequence) &&
  row.terminationChildSequence === row.creationSequence &&
  row.callerHandleObjectCompared === true;

// Diagnostic consistency only. This never grants sandbox admission or verifies
// a full external review. readArtifact is injectable for contract fixtures.
function inspectPrivateV4(
  report,
  {
    readArtifact = fs.readFileSync,
    settlementOnly = false,
    expectedRootExit = 0,
  } = {},
) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const parse = (text, label) => {
    try {
      if (typeof text !== "string" || Buffer.byteLength(text) > 8 * 1024 * 1024)
        throw Error("bounded text required");
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("JSON object required");
      return value;
    } catch {
      errors.push(label + " is not bounded JSON");
      return {};
    }
  };
  const capture = (value, label) => {
    try {
      if (
        !value ||
        typeof value.path !== "string" ||
        !positive(value.bytes) ||
        value.bytes > 128 * 1024 * 1024 ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.digest)
      )
        throw Error("capture fields");
      const bytes = readArtifact(value.path);
      if (
        !Buffer.isBuffer(bytes) ||
        bytes.length !== value.bytes ||
        "sha256:" + identity.digest(bytes) !== value.digest
      )
        throw Error("capture bytes");
      return bytes;
    } catch {
      errors.push(label + " capture differs from retained bytes");
      return null;
    }
  };
  const expectedMode = settlementOnly
    ? expectedRootExit === 1
      ? "review-mutant"
      : "review-baseline"
    : "original";
  const expectedExperiment = settlementOnly
    ? expectedRootExit === 1
      ? "external-locked-review-mutant"
      : "external-locked-review-baseline"
    : PRIVATE_V4_EXPERIMENT;
  require([0, 1].includes(expectedRootExit) &&
    report?.mode ===
      expectedMode, "diagnostic mode differs from requested settlement");
  require(report?.schema ===
    "chainlesschain.windows-private-v4-diagnostic/v1" &&
    report.experimentKind ===
      expectedExperiment, "experiment identity differs");
  require(report?.status === "NOT_ADMITTED" &&
    report.experimental === true &&
    report.admissionEligible === false &&
    report.formalSample === false &&
    report.fullFrozenReviewCompleted === false, "diagnostic scope differs");
  require(!report?.error &&
    report?.execution?.status === (expectedRootExit === 1 ? 2 : 0) &&
    report.execution.signal === null &&
    report.execution.error === null, "outer execution failed or incomplete");
  const host = parse(report?.execution?.stdout, "host result");
  require(host.guardNodeLimit === 48000 &&
    positive(host.guardNodeCount) &&
    host.guardNodeCount <=
      host.guardNodeLimit, "native guard count or fixed limit differs");
  require(host.schema === "chainlesschain.windows-private-broker/v4" &&
    host.status === "NOT_ADMITTED" &&
    host.completed === (expectedRootExit === 0) &&
    host.stage === (expectedRootExit === 1 ? "root-settlement" : "completed") &&
    host.error === expectedRootExit, "host experiment incomplete");
  require(host.cleanupConfirmed === true &&
    host.jobActiveProcesses === 0 &&
    host.profileDeleted === true &&
    host.loopbackExemptionAbsent === true &&
    host.hostMapUnchanged ===
      true, "host cleanup or namespace boundary unconfirmed");
  require(positive(host.hostPid) &&
    positive(host.rootPid) &&
    host.hostPid !== host.rootPid &&
    host.rootWait === 0 &&
    host.rootExit === expectedRootExit &&
    host.rootTokenAndSameJobProven === true &&
    host.rootMapInstalled === true, "root creation evidence differs");
  const sources = Array.isArray(report?.sources) ? report.sources : [];
  const outputs = Array.isArray(report?.outputs) ? report.outputs : [];
  for (const [list, names, kind] of [
    [sources, sourceNames, "source"],
    [outputs, outputNames, "output"],
  ]) {
    for (const name of names) {
      const matches = list.filter((row) => basename(row?.path) === name);
      require(matches.length === 1, `${kind} ${name} must occur once`);
      if (matches.length === 1) capture(matches[0], `${kind} ${name}`);
    }
  }
  capture(report?.driver, "driver");
  capture(report?.validatorSource, "result validator");
  if (report?.dependencyValidatorSource) {
    capture(report.dependencyValidatorSource, "dependency validator");
    require(basename(report.dependencyValidatorSource.path) ===
      "windows-node-private-v4-dependencies.mjs", "dependency validator source differs");
  }
  require(Array.isArray(report?.outputsAfter) &&
    same(
      report.outputsAfter,
      report.outputs,
    ), "native output snapshots changed after execution");
  require(Array.isArray(report?.commands) &&
    report.commands.length === 3 &&
    report.commands.every(
      (row) => row?.status === 0 && !row.error,
    ), "native compilation incomplete");
  const frozen = report?.frozenInputs;
  require(report?.sourceClosure?.digest ===
    PRIVATE_V4_SOURCE_CLOSURE_DIGEST, "source closure differs from immutable frozen digest");
  const closureBytes = capture(report?.sourceClosure, "frozen source closure");
  const closure = closureBytes
    ? parse(closureBytes.toString("utf8"), "source closure")
    : {};
  const testRelative = "packages/cli/__tests__/unit/model-capabilities.test.js";
  const kernelPrefix = "packages/context-memory-kernel/";
  const closureRows = Array.isArray(closure.files)
    ? closure.files.filter(
        (row) =>
          settlementOnly ||
          row?.path === testRelative ||
          row?.path?.startsWith(kernelPrefix),
      )
    : [];
  const stagedRows = Array.isArray(report?.frozenGitFiles)
    ? report.frozenGitFiles
    : [];
  require(closure.projectCommit ===
    "b2aa3aba082873570e85dce39b00754e5504ff37" &&
    closureRows.length > 1 &&
    (settlementOnly
      ? stagedRows.length >= closureRows.length
      : stagedRows.length ===
        closureRows.length), "frozen Git source closure incomplete");
  require(new Set(closureRows.map((row) => row.path)).size ===
    closureRows.length, "duplicate frozen Git paths");
  for (const row of closureRows) {
    const staged = stagedRows.filter((entry) => entry?.path === row.path);
    const relative =
      settlementOnly || row.path === testRelative
        ? row.path
        : "node_modules/@chainlesschain/context-memory-kernel/" +
          row.path.slice(kernelPrefix.length);
    require(row.path
      .split("/")
      .every((part) => part && part !== "." && part !== "..") &&
      !row.path.includes("\\") &&
      /^[a-f0-9]{40}$/u.test(row.gitBlob) &&
      ["100644", "100755"].includes(row.mode) &&
      positive(row.bytes) &&
      /^sha256:[a-f0-9]{64}$/u.test(row.digest), "frozen Git row malformed");
    const allowedPaths =
      typeof report?.root === "string"
        ? [path.win32.join(report.root, "workspace/tree", relative)]
        : [];
    if (settlementOnly && Array.isArray(closure.workspaceLinks))
      for (const link of closure.workspaceLinks) {
        if (
          typeof link?.source !== "string" ||
          typeof link.nodeModulesPath !== "string" ||
          !row.path.startsWith(link.source + "/")
        )
          continue;
        const suffix = row.path.slice(link.source.length + 1);
        if (
          !/^(?:__tests__|tests?|scripts|docs|examples|benchmarks|\.github)\//u.test(
            suffix,
          )
        )
          allowedPaths.push(
            path.win32.join(
              report.root,
              "workspace/tree",
              link.nodeModulesPath,
              suffix,
            ),
          );
      }
    require(staged.length === allowedPaths.length &&
      new Set(staged.map((entry) => entry.staged)).size === staged.length &&
      staged.every(
        (entry) =>
          ["path", "gitBlob", "mode", "bytes", "digest"].every(
            (key) => entry[key] === row[key],
          ) && allowedPaths.includes(entry.staged),
      ), "staged Git file differs from retained closure");
    if (row.path === testRelative)
      require(row.bytes === frozen?.test?.bytes &&
        row.digest ===
          frozen?.test?.digest, "test input differs from frozen Git blob");
  }
  require(closureRows.filter((row) => row.path === testRelative).length ===
    1, "frozen test source missing");
  const configs = Array.isArray(closure.files)
    ? closure.files.filter(
        (row) => row?.path === "packages/cli/vitest.config.js",
      )
    : [];
  require(configs.length === 1 &&
    configs[0].bytes === frozen?.config?.bytes &&
    configs[0].digest ===
      frozen?.config?.digest, "config input differs from frozen Git blob");
  for (const [key, relative] of [
    ["config", "packages/cli/vitest.config.js"],
    ["test", "packages/cli/__tests__/unit/model-capabilities.test.js"],
  ]) {
    capture(frozen?.[key], `frozen ${key}`);
    const staged = report?.stagedInputs?.[key];
    for (const phase of ["before", "after"])
      require(typeof report?.root === "string" &&
        staged?.[phase]?.path ===
          path.win32.join(report.root, "workspace/tree", relative) &&
        positive(staged[phase].bytes) &&
        staged[phase].bytes === frozen?.[key]?.bytes &&
        staged[phase].digest ===
          frozen?.[key]
            ?.digest, `staged frozen ${key} ${phase} differs from retained input`);
  }
  const ledger = Array.isArray(host.creationLedger) ? host.creationLedger : [];
  const roles = new Map([
    ["root", "root"],
    ["vitest-worker", "worker"],
    ["report-helper", "report-helper"],
  ]);
  require(ledger.length >= 2 &&
    ledger.length <= 128, "creation ledger incomplete");
  require(new Set(ledger.map((row) => row?.pid)).size === ledger.length &&
    new Set(ledger.map((row) => row?.registrationId)).size ===
      ledger.length, "duplicate creation identities");
  require(ledger.filter((row) => row?.kind === "root").length === 1 &&
    ledger.some(
      (row) => row?.kind === "vitest-worker",
    ), "real root and Vitest worker required");
  const manifests = Array.isArray(report?.manifests) ? report.manifests : [];
  const receipts = Array.isArray(report?.receipts) ? report.receipts : [];
  const nodes = ledger.filter((row) => roles.has(row?.kind));
  const terminatedWorkers = ledger.filter(hostTerminatedWorker);
  require(manifests.length === nodes.length &&
    receipts.length >= nodes.length * 2 - terminatedWorkers.length &&
    receipts.length <= nodes.length * 2 &&
    receipts.every((receipt) =>
      nodes.some((row) => row.pid === receipt?.pid),
    ), "actor manifest or receipt set incomplete");
  const rootRow = ledger.find((row) => row?.kind === "root");
  const services = ledger.filter((row) => row?.kind === "esbuild-service");
  if (!settlementOnly || services.length)
    require((settlementOnly || services.length === 1) &&
      services.at(-1)?.pid === host.servicePid &&
      host.serviceTokenAndSameJobProven === true &&
      host.serviceMapInstalled === true &&
      host.serviceMapStatus === 0 &&
      host.serviceWait === 0 &&
      host.serviceExit === 0 &&
      host.serviceParent ===
        "host-custodian", "same-session esbuild service required");
  for (const row of ledger) {
    if (!row || !positive(row.pid)) {
      errors.push("invalid creation record");
      continue;
    }
    require(roles.has(row.kind) ||
      row.kind === "esbuild-service", "unknown creation kind");
    require(row.jobAssigned === true &&
      row.tokenAndSameJobProven === true &&
      row.mapInstalled === true &&
      row.mapStatus === 0 &&
      row.wait === 0 &&
      row.exitKnown === true &&
      (row.exit === (row.kind === "root" ? expectedRootExit : 0) ||
        hostTerminatedWorker(
          row,
        )), `creation ${row.pid} did not settle successfully`);
    require(row.callerOriginalHandleRetained ===
      (row.kind !==
        "root"), `creation ${row.pid} original handle not retained`);
    if (row.kind === "root")
      require(row.pid === host.rootPid &&
        row.parentRegistrationId === null &&
        row.commandKind === "trusted-root-checker" &&
        row.stdioCount === 3, "root actor differs");
    else
      require(ledger.some(
        (parent) =>
          parent?.registrationId === row.parentRegistrationId &&
          roles.has(parent?.kind) &&
          parent.kind !== "report-helper",
      ), `creation ${row.pid} parent registration unknown`);
    if (row.kind === "vitest-worker")
      require(row.commandKind === "frozen-vitest-forks-entry" &&
        row.stdioCount === 4 &&
        row.parentRegistrationId ===
          rootRow?.registrationId, `creation ${row.pid} is not the fixed Vitest fork`);
    if (row.kind === "report-helper")
      require(row.commandKind === "fixed-node-report-header" &&
        row.stdioCount === 3 &&
        row.launchRequests === 0, `creation ${row.pid} helper command differs`);
    if (row.kind === "esbuild-service")
      require(row.commandKind === "fixed-esbuild-service" &&
        row.stdioCount === 3 &&
        row.registered === false &&
        row.launchRequests === 0 &&
        (settlementOnly ||
          row.parentRegistrationId ===
            rootRow?.registrationId), "esbuild service launch differs");
    require(row.inheritedHandleCount ===
      {
        root: 9,
        "vitest-worker": 10,
        "report-helper": 9,
        "esbuild-service": 5,
      }[row.kind], `creation ${row.pid} inheritance count differs`);
    if (!roles.has(row.kind)) continue;
    require(row.registered ===
      true, `creation ${row.pid} broker registration missing`);
    const actorReceipts = receipts.filter(
      (receipt) => receipt?.pid === row.pid,
    );
    const hostTerminated = hostTerminatedWorker(row);
    require((hostTerminated
      ? [1, 2].includes(actorReceipts.length)
      : actorReceipts.length === 2) &&
      actorReceipts.filter((receipt) => receipt.phase === "installed")
        .length === 1 &&
      actorReceipts.filter((receipt) => receipt.phase === "exit").length ===
        actorReceipts.length -
          1, `creation ${row.pid} requires installed and exit receipts or exact host termination attestation`);
    const role = roles.get(row.kind);
    const expectedPath =
      role === "root"
        ? identity.MANIFEST_PATH
        : `X:\\control\\windows-node-private-v4.${role}-${row.registrationId}.manifest.json`;
    const selected = manifests.filter((item) => item?.path === expectedPath);
    require(selected.length ===
      1, `creation ${row.pid} manifest missing or duplicated`);
    if (selected.length !== 1) continue;
    let manifest;
    try {
      if (typeof selected[0].raw !== "string")
        throw Error("manifest raw text required");
      manifest = identity.validateManifest(selected[0].raw);
      identity.validateManifestPath(expectedPath, manifest);
    } catch {
      errors.push(`creation ${row.pid} manifest invalid`);
      continue;
    }
    const retainedManifest = capture(
      selected[0].capture,
      `creation ${row.pid} manifest`,
    );
    require(retainedManifest?.equals(
      Buffer.from(selected[0].raw),
    ), `creation ${row.pid} retained manifest differs`);
    require(manifest.stage === "frozen-forks" &&
      manifest.root.physical === report.root &&
      manifest.sessionId === host.sessionId &&
      manifest.generation === host.generation &&
      manifest.appContainerSid ===
        host.appContainerSid, `creation ${row.pid} manifest session differs`);
    require(manifest.role === role &&
      manifest.actor?.pid === row.pid &&
      manifest.actor.registrationId === row.registrationId &&
      manifest.actor.parentRegistrationId ===
        row.parentRegistrationId, `creation ${row.pid} manifest registration differs`);
    for (const [key, name] of [
      ["identity", sourceNames[7]],
      ["preload", sourceNames[8]],
      ["addon", outputNames[1]],
    ]) {
      const artifact = [...sources, ...outputs].find(
        (entry) => basename(entry?.path) === name,
      );
      require(artifact?.digest === "sha256:" + manifest.files[key].sha256 &&
        artifact?.bytes ===
          manifest.files[key]
            .bytes, `creation ${row.pid} ${key} source binding differs`);
    }
    for (const receipt of actorReceipts) {
      require(receipt.schema ===
        "chainlesschain.windows-node-private-preload/v4" &&
        receipt.status === "NOT_ADMITTED" &&
        receipt.trusted === false &&
        receipt.admissionEligible === false &&
        receipt.stage === "frozen-forks" &&
        receipt.role === role &&
        receipt.ppid === host.hostPid &&
        receipt.parentage ===
          "host-broker-created", `creation ${row.pid} receipt scope differs`);
      require(receipt.manifestPath === expectedPath &&
        receipt.manifestSha256 ===
          identity.digest(Buffer.from(selected[0].raw)) &&
        receipt.sessionId === host.sessionId &&
        receipt.generation === host.generation &&
        same(
          receipt.actor,
          manifest.actor,
        ), `creation ${row.pid} receipt binding differs`);
      try {
        require(same(
          identity.inspectPrivateIdentity(receipt.paired?.native, manifest),
          receipt.paired,
        ), `creation ${row.pid} paired proof differs`);
      } catch {
        errors.push(`creation ${row.pid} native paired proof invalid`);
      }
      require(receipt.adapter?.pid === row.pid &&
        receipt.adapter.appContainerSid === host.appContainerSid &&
        receipt.adapter.state === 2 &&
        receipt.adapter.patches === 6 &&
        receipt.adapter.installError === 0 &&
        receipt.adapter.capabilityCount === 0 &&
        receipt.adapter.inJob ===
          true, `creation ${row.pid} adapter receipt invalid`);
      if (receipt.phase === "exit")
        require(hostTerminated
          ? receipt.exitDisposition === "process-exit-intent" &&
              receipt.exitCode === 0
          : receipt.exitCode ===
              row.exit, `creation ${row.pid} receipt exit differs`);
    }
    if (actorReceipts.length === 2)
      require(same(
        actorReceipts[0].paired,
        actorReceipts[1].paired,
      ), `creation ${row.pid} paired identity changed`);
  }
  if (settlementOnly) {
    const review = report?.review;
    const reviewConfigBytes = capture(review?.config, "review config");
    capture(review?.specs, "review specs");
    capture(review?.runtime, "review runtime");
    require(Array.isArray(review?.tests) &&
      review.tests.length > 0 &&
      new Set(review.tests).size === review.tests.length &&
      Array.isArray(review?.taskIds) &&
      review.taskIds.length > 0, "review test selection missing");
    const configText = reviewConfigBytes?.toString("utf8");
    let config = {};
    if (configText?.startsWith("export default ") && configText.endsWith(";\n"))
      config = parse(configText.slice(15, -2), "review config data");
    else errors.push("review config format differs");
    require(config.test?.root === "X:/workspace/tree" &&
      config.test.pool === "forks" &&
      config.test.maxWorkers === 1 &&
      same(
        config.test.include,
        review?.tests,
      ), "review config selection differs");
    const supportSources = [
      [
        "globalSetup",
        "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
      ],
      ["setup", "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js"],
      ["setup", "packages/cli/test/setup/agent-evolution-test-boundary.js"],
    ];
    require(Array.isArray(review?.support) &&
      same(
        review.support.map(({ kind, source }) => [kind, source]),
        supportSources,
      ), "frozen review support missing");
    require(same(
      config.test?.globalSetup,
      supportSources
        .filter(([kind]) => kind === "globalSetup")
        .map(([, source]) => "X:/workspace/tree/" + source),
    ) &&
      same(
        config.test?.setupFiles,
        supportSources
          .filter(([kind]) => kind === "setup")
          .map(([, source]) => "X:/workspace/tree/" + source),
      ), "review config support differs");
    for (const support of Array.isArray(review?.support)
      ? review.support
      : []) {
      capture(support?.capture, "review support");
      const locked = closureRows.find((row) => row.path === support?.source);
      require(locked &&
        locked.bytes === support.capture?.bytes &&
        locked.digest ===
          support.capture
            ?.digest, "review support differs from frozen closure");
    }
    if (report?.dependencies) {
      const manifestBytes = capture(
        report.dependencies,
        "review dependency manifest",
      );
      require(Boolean(
        report.dependencyValidatorSource,
      ), "dependency validator source missing");
      try {
        const workspaceRoots = [
          "packages/cli",
          ...(closure.workspaceLinks ?? []).map((link) => link.source),
        ];
        const manifest = parse(
          manifestBytes?.toString("utf8"),
          "review dependency manifest",
        );
        const verified = verifyPrivateV4DependencyManifest(manifest, {
          workspaceRoots,
        });
        const files = report.dependencyFiles;
        require(Array.isArray(files) &&
          files.length === verified.fileCount &&
          new Set(files.map((row) => row?.path)).size ===
            files.length, "dependency staged file set differs");
        const indexed = new Map(
          (Array.isArray(files) ? files : []).map((row) => [row?.path, row]),
        );
        for (const row of verified.files) {
          const evidence = indexed.get(row.path);
          const bytes = readPrivateV4DependencyFile(
            report.dependencyTree,
            row,
            { workspaceRoots },
          );
          const actualDigest = "sha256:" + identity.digest(bytes);
          require(evidence?.bytes === bytes.length &&
            evidence.digest ===
              actualDigest, "dependency staged descriptor differs");
          for (const phase of ["source", "before", "after"]) {
            const expectedPath =
              phase === "source"
                ? path.join(report.dependencyTree, ...row.path.split("/"))
                : path.win32.join(report.root, "workspace/tree", row.path);
            require(evidence?.[phase]?.path === expectedPath &&
              evidence[phase].bytes === bytes.length &&
              evidence[phase].digest ===
                actualDigest, `dependency ${phase} differs from retained file`);
          }
        }
      } catch (error) {
        errors.push("dependency byte custody invalid: " + error.message);
      }
    } else
      require(!report?.dependencyFiles &&
        !report?.dependencyTree, "dependency files have no retained manifest");
    require(stagedRows.every((entry) =>
      closureRows.some((row) => row.path === entry?.path),
    ), "unknown staged review source");
    if (expectedRootExit === 1) {
      const mutation = report?.mutation;
      const locked = closureRows.find(
        (row) => row.path === mutation?.sourcePath,
      );
      require(locked &&
        mutation.before?.bytes === locked.bytes &&
        mutation.before?.digest === locked.digest &&
        mutation.before?.path ===
          path.win32.join(report.root, "workspace/tree", locked.path) &&
        mutation.after?.path === mutation.before.path &&
        mutation.after?.digest !== mutation.before.digest &&
        positive(mutation.after?.bytes) &&
        typeof mutation.name === "string" &&
        review?.taskIds?.length === 1 &&
        mutation.taskId ===
          review.taskIds[0], "review mutation binding missing");
      const afterBytes = capture(mutation?.snapshot, "review mutation result");
      require(afterBytes?.length === mutation?.after?.bytes &&
        "sha256:" + identity.digest(afterBytes ?? Buffer.alloc(0)) ===
          mutation?.after?.digest, "review mutation snapshot differs");
    }
  } else {
    const journalBlob = report?.["journal.jsonl"];
    const evidenceText = (name) => {
      const value = report?.[name];
      require(typeof value?.text === "string" &&
        value.digest === "sha256:" + identity.digest(value.text), name +
        " digest differs");
      return typeof value?.text === "string" ? value.text : "";
    };
    const service = parse(evidenceText("service.json"), "esbuild result");
    require(service.invalidRejected === true &&
      service.transform?.code === "const answer = 42;\n" &&
      Array.isArray(service.build?.errors) &&
      service.build.errors.length === 0 &&
      Array.isArray(service.configBundle) &&
      service.configBundle.length === 1 &&
      typeof service.configBundle[0]?.text === "string" &&
      service.configBundle[0].text.includes('pool: "forks"') &&
      service.configBundle[0].text.includes(
        "maxWorkers: 2",
      ), "esbuild transform, config bundle or invalid TypeScript rejection incomplete");
    const traces = Object.keys(report ?? {}).filter((key) =>
      /^esbuild-trace-[0-9]+\.jsonl$/u.test(key),
    );
    require(traces.length === 1, "esbuild trace set incomplete");
    const trace =
      traces.length === 1
        ? evidenceText(traces[0])
            .trim()
            .split(/\r?\n/u)
            .map((line) => parse(line, "esbuild trace row"))
        : [];
    require(trace.length >= 10 &&
      trace.every(
        (row, index) =>
          row.sequence === index + 1 &&
          row.pid === host.servicePid &&
          row.overflow === 0,
      ), "esbuild trace identity or sequence differs");
    for (const api of [
      "identity-accepted",
      "device-map-handle-access",
      "device-map-supervisor-handle",
      "device-map-root-proven",
      "device-map-file-id-proven",
      "namespace-host-root-denied",
      "namespace-workspace-write-denied",
      "namespace-traversal-confined",
      "installed",
      "exit",
    ]) {
      const rows = trace.filter((row) => row.api === api);
      require(rows.length === 1 &&
        rows[0].success === true &&
        rows[0].error ===
          (api.endsWith("-denied")
            ? 5
            : 0), "esbuild trace missing successful " + api);
    }
    require(trace.find((row) => row.api === "installed")?.patches === 2 &&
      trace.at(-1)?.api === "exit", "esbuild instrumentation or exit absent");
    const rootIdentity = receipts.find(
      (row) => row?.pid === host.rootPid && row.phase === "installed",
    )?.paired?.native?.root?.physical;
    if (
      rootIdentity &&
      /^[a-f0-9]{32}$/u.test(rootIdentity.fileId) &&
      /^[1-9][0-9]{0,19}$/u.test(rootIdentity.volumeSerial)
    ) {
      const fileId = Buffer.from(rootIdentity.fileId, "hex");
      const traceId = [
        Number(BigInt(rootIdentity.volumeSerial) & 0xffffffffn),
        fileId.readUInt32LE(4),
        fileId.readUInt32LE(0),
      ]
        .map((part) => part.toString(16).padStart(8, "0"))
        .join(":");
      const traceNt = rootIdentity.ntPath;
      require(trace.find((row) => row.api === "device-map-file-id-proven")
        ?.requestedPath === traceId &&
        ["device-map-root-proven", "namespace-traversal-confined"].every(
          (api) =>
            trace.find((row) => row.api === api)?.requestedPath === traceNt,
        ), "esbuild private root differs from Node paired identity");
    } else errors.push("esbuild root comparison has no valid Node identity");
    require(typeof journalBlob?.text === "string" &&
      journalBlob.digest ===
        "sha256:" +
          identity.digest(journalBlob.text), "journal digest differs");
    const journal =
      typeof journalBlob?.text === "string"
        ? journalBlob.text
            .trim()
            .split(/\r?\n/u)
            .map((line) => parse(line, "journal row"))
        : [];
    require(journal.length > 0 &&
      journal.every(
        (row, i) => row.sequence === i + 1 && row.pid === host.rootPid,
      ) &&
      !journal.some(
        (row) => row.phase === "failed",
      ), "journal sequence incomplete or failed");
    const config = journal.filter((row) => row.phase === "config-loaded");
    const completed = journal.filter((row) => row.phase === "completed");
    const esbuildCompleted = journal.filter(
      (row) => row.phase === "esbuild-completed",
    );
    require(esbuildCompleted.length === 1 &&
      esbuildCompleted[0].invalidRejected === true &&
      esbuildCompleted[0].servicePid ===
        host.servicePid, "esbuild journal binding differs");
    const tests = journal.filter((row) => row.phase === "test-results");
    require(config.length === 1 &&
      config[0].pool === "forks" &&
      config[0].maxWorkers === 2 &&
      Array.isArray(config[0].unhandled) &&
      config[0].unhandled.length ===
        0, "original frozen pool configuration unproven");
    require(completed.length === 1 &&
      positive(completed[0].tests) &&
      tests.length === 1 &&
      tests[0].count === completed[0].tests &&
      Array.isArray(tests[0].states) &&
      tests[0].states.length === tests[0].count &&
      tests[0].states.every(
        (state) => state === "passed",
      ), "nonempty passing test results required");
  }
  return Object.freeze({
    schema: settlementOnly
      ? "chainlesschain.windows-private-v4-settlement/v1"
      : "chainlesschain.windows-private-v4-result/v1",
    status: "NOT_ADMITTED",
    admissionEligible: false,
    fullFrozenReviewCompleted: false,
    experimentKind: expectedExperiment,
    ...(settlementOnly
      ? { nativeSettlementConfirmed: errors.length === 0, expectedRootExit }
      : { diagnosticVerified: errors.length === 0 }),
    errors: Object.freeze(errors),
  });
}

export function inspectPrivateV4Result(
  report,
  { readArtifact = fs.readFileSync } = {},
) {
  return inspectPrivateV4(report, { readArtifact });
}
export function inspectPrivateV4Settlement(
  report,
  { readArtifact = fs.readFileSync, expectedRootExit } = {},
) {
  return inspectPrivateV4(report, {
    readArtifact,
    expectedRootExit: expectedRootExit ?? -1,
    settlementOnly: true,
  });
}
