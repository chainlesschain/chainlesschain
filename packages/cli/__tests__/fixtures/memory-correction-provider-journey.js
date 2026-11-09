import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSignedAgentEvolutionDeployment } from "./agent-evolution-test-deployment.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { memoryRecordsToContextItems } from "../../src/lib/context-memory-kernel/message-adapter.js";
import { canonicalJson } from "@chainlesschain/context-memory-kernel";
import { computeEventHash } from "../../src/harness/transcript-integrity.js";

const cli = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const write = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

// No shell, model tools, IDE or descendant launcher: the handles below belong
// exclusively to this fresh fixture. Never enumerate/kill a user's processes.
export async function runMemoryCorrectionProviderJourney({ evidenceDir } = {}) {
  const root = fs.mkdtempSync(
    path.join(tmpdir(), "cc-memory-correction-provider-"),
  );
  const rootIdentity = fs.realpathSync(root);
  const home = path.join(root, "config");
  const workspace = path.join(root, "workspace");
  for (const dir of [
    home,
    workspace,
    path.join(root, "user"),
    path.join(root, "security"),
  ])
    fs.mkdirSync(dir);
  const output = evidenceDir
    ? path.resolve(evidenceDir)
    : path.join(root, "evidence");
  fs.mkdirSync(output, { recursive: true });
  const env = {
    ...process.env,
    ...createSignedAgentEvolutionDeployment(root),
    HOME: path.join(root, "user"),
    USERPROFILE: path.join(root, "user"),
    CHAINLESSCHAIN_HOME: home,
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security"),
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    CC_CONTEXT_MEMORY_KERNEL: "1",
    CC_MEMORY_SEMANTIC_REAL_TEST: "0",
    NO_COLOR: "1",
  };
  for (const key of Object.keys(env))
    if (
      /_API_KEY$/.test(key) ||
      /^(NODE_OPTIONS|CC_BARE|CLAUDE_CONFIG_DIR)$/.test(key)
    )
      delete env[key];
  const owned = new Set();
  const deadline = Date.now() + 180_000;
  const journalSnapshot = () => {
    const files = [];
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith(".jsonl"))
          files.push({ file, sha256: sha(fs.readFileSync(file)) });
      }
    };
    visit(home);
    return files.sort((a, b) => a.file.localeCompare(b.file));
  };
  const invocations = [];
  const bodies = [];
  let sequence = 0;
  const run = (args, input = "", fault = false) =>
    new Promise((resolve, reject) => {
      if (Date.now() >= deadline)
        return reject(
          new Error("Memory provider fixture total deadline exceeded"),
        );
      const nodeArgs = fault
        ? [
            "--import",
            new URL(
              "./memory-correction-post-publish-fault.mjs",
              import.meta.url,
            ).href,
          ]
        : [];
      const child = spawn(process.execPath, [...nodeArgs, cli, ...args], {
        cwd: workspace,
        env: {
          ...env,
          ...(fault
            ? {
                CC_MEMORY_CORRECTION_FAULT_RECEIPT: path.join(
                  output,
                  "post-publish-fault.txt",
                ),
              }
            : {}),
        },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      owned.add(child);
      const number = ++sequence;
      let stdout = "",
        stderr = "",
        timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          child.kill();
        },
        Math.min(60_000, deadline - Date.now()),
      );
      child.stdout.on("data", (b) => {
        stdout += b;
        if (stdout.length > 8 * 1024 * 1024) child.kill();
      });
      child.stderr.on("data", (b) => {
        stderr += b;
        if (stderr.length > 2 * 1024 * 1024) child.kill();
      });
      child.on("error", reject);
      child.on("close", (status, signal) => {
        clearTimeout(timer);
        owned.delete(child);
        const receipt = {
          number,
          pid: child.pid,
          args,
          nodeArgs,
          status,
          signal,
          timedOut,
          stdout,
          stderr,
        };
        invocations.push(receipt);
        write(path.join(output, `process-${number}.json`), receipt);
        resolve(receipt);
      });
      child.stdin.end(input);
    });
  const json = async (args, status = 0, fault = false) => {
    const beforeRead = args[0] === "session" ? journalSnapshot() : null;
    const result = await run(args, "", fault);
    assert.equal(result.status, status, result.stderr || result.stdout);
    if (beforeRead)
      assert.deepEqual(
        journalSnapshot(),
        beforeRead,
        "read-only session diagnostic command changed its journal",
      );
    return JSON.parse(result.stdout);
  };
  const server = createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on("data", (b) => {
      size += b.length;
      if (size > 4 * 1024 * 1024) request.destroy();
      else chunks.push(b);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const entry = {
        index: bodies.length,
        path: request.url,
        sha256: sha(raw),
        body: JSON.parse(raw),
      };
      bodies.push(entry);
      write(path.join(output, `physical-${entry.index}.json`), entry);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          message: {
            role: "assistant",
            content: "Fixture transport acknowledged.",
          },
          done: true,
          prompt_eval_count: 10,
          eval_count: 4,
        }),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const memoryFile = path.join(home, "context-memory", "kernel-v1.json");
  const service = new CliCanonicalMemoryService({
    env,
    memoryFilePath: memoryFile,
  });
  const prepare = (query) =>
    prepareCanonicalProviderContext([{ role: "user", content: query }], {
      contextMemoryEnv: env,
      contextMemoryFilePath: memoryFile,
      provider: "ollama",
      model: "test",
      sessionId: "memory-prepared",
      contextMemoryModelWindowTokens: 32768,
      maxOutputTokens: 128,
    });
  const cases = [
    {
      query: "What is the observatory recovery color?",
      old: "The observatory recovery color is obsolete-magenta",
      next: "The observatory recovery color is verified-cobalt",
      category: "fact",
    },
    {
      query: "发布规则",
      old: "发布规则要求使用旧版红色发布通道",
      next: "发布规则要求使用新版绿色发布通道",
      category: "rule",
    },
  ];
  const results = [];
  let completedReceipt = null;
  try {
    for (const [index, sample] of cases.entries()) {
      // English starts through public add. The Chinese record uses the actual
      // Kernel proposal API to cover legacy summary/contentRef, which public add
      // cannot express; correction/inspection/deletion still use public CLI.
      const seeded =
        index === 1
          ? await service.runtime.kernel.proposeMemory({
              scope: "user",
              scopeId: "local-user",
              category: sample.category,
              content: sample.old,
              summary: "obsolete-summary-sentinel",
              contentRef: {
                store: "fixture",
                objectId: "obsolete-ref-sentinel",
                digest: `sha256:${"a".repeat(64)}`,
                byteLength: 10,
                summary: "obsolete-ref-summary-sentinel",
                recoverable: false,
              },
              provenance: {
                source: "fixture",
                actor: "local-user",
                observedAt: new Date().toISOString(),
              },
              evidenceRefs: [
                { store: "fixture", id: "rule-correction-source" },
              ],
              confidence: 0.8,
              importance: 1,
              tags: [],
              sensitivity: "personal",
              allowedSinks: ["provider.ollama"],
              retentionPolicy: { mode: "durable" },
              activate: true,
            })
          : null;
      const added = seeded
        ? { id: seeded.record.memoryId }
        : await json([
            "memory",
            "add",
            sample.old,
            "--category",
            sample.category,
            "--importance",
            "5",
            "--json",
          ]);
      const before = await json(["memory", "inspect", added.id, "--json"]);
      const snapshot = await prepare(sample.query);
      assert.ok(
        JSON.stringify(snapshot.messages).includes(sample.old),
        "prepared snapshot must contain the old memory",
      );
      const correctionOutcome = await json(
        [
          "memory",
          "correct",
          added.id,
          sample.next,
          "--expected-revision",
          String(before.revision),
          "--json",
        ],
        index === 1 ? 2 : 0,
        index === 1,
      );
      if (index === 1) {
        assert.equal(
          fs.readFileSync(path.join(output, "post-publish-fault.txt"), "utf8"),
          "published-maintenance-entered\n",
          "unknown publication must not automatically replay",
        );
        assert.equal(
          correctionOutcome.error.code,
          "CONTEXT_MEMORY_COMMIT_PUBLISHED",
        );
        assert.equal(correctionOutcome.committed, true);
        assert.equal(correctionOutcome.noAutomaticReplay, true);
        assert.equal(correctionOutcome.cleanupComplete, false);
      }
      await assert.rejects(snapshot.assertCurrent(), /revision|changed/i);
      const stale = await json(
        [
          "memory",
          "correct",
          added.id,
          sample.old,
          "--expected-revision",
          String(before.revision),
          "--json",
        ],
        1,
      );
      assert.ok(stale.error);
      const inspected = await json(["memory", "inspect", added.id, "--json"]);
      const corrected = inspected;
      assert.equal(inspected.revision, before.revision + 1);
      if (index === 0) assert.equal(inspected.digest, correctionOutcome.digest);
      assert.equal(inspected.content, sample.next);
      const sessionId = `memory-correction-${index}-${randomUUID()}`;
      const priorCalls = bodies.length;
      const response = await run(
        [
          "agent",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--provider",
          "ollama",
          "--model",
          "test",
          "--base-url",
          baseUrl,
          "--session",
          sessionId,
          "--no-mcp",
          "--no-project-memory",
          "--sandbox-mode",
          "off",
          "--max-turns",
          "1",
          "--max-output-tokens",
          "128",
        ],
        JSON.stringify({
          type: "user",
          message: { role: "user", content: sample.query },
        }) + "\n",
      );
      assert.equal(response.status, 0, response.stderr || response.stdout);
      const events = response.stdout.trim().split(/\r?\n/).map(JSON.parse);
      assert.ok(
        events.some((e) => e.type === "result" && e.subtype === "success"),
        "stream must finish successfully",
      );
      assert.equal(bodies.length, priorCalls + 1);
      const physical = bodies.at(-1);
      assert.ok(
        JSON.stringify(physical.body).includes(sample.next),
        "corrected content missing at physical provider boundary",
      );
      assert.ok(
        !JSON.stringify(physical.body).includes(sample.old),
        "old content leaked into provider body",
      );
      const report = await json([
        "session",
        "show",
        sessionId,
        "--model-inputs",
        "--json",
      ]);
      write(path.join(output, `model-inputs-${index}.json`), report);
      assert.equal(report.total, 2);
      const wire = report.records
        .map((r) => r.diagnostic)
        .find((d) => d.stage === "fetch-body");
      assert.equal(wire.bodyDigest, physical.sha256);
      assert.equal(wire.sourceMapping.covered, true);
      const logical = report.records
        .map((r) => r.diagnostic)
        .find((d) => d.phase === "logical-input");
      assert.equal(logical.planning.covered, true);
      const rawRecord = await service.runtime.memoryPort.read(added.id);
      assert.equal(rawRecord.summary, undefined);
      assert.equal(rawRecord.contentRef, undefined);
      for (const sentinel of [
        "obsolete-summary-sentinel",
        "obsolete-ref-sentinel",
        "obsolete-ref-summary-sentinel",
      ])
        assert.ok(!JSON.stringify(physical.body).includes(sentinel));
      const memorySources = logical.planning.sources.filter(
        (s) => s.kind === "memory" && s.disposition === "selected",
      );
      assert.equal(memorySources.length, 1);
      // Transport adds its own system prefix after planning. Count the actual
      // mapped message slots, not that unplanned transport prefix.
      const plannedMessageSlots = new Set(
        wire.sourceMapping.sources
          .flatMap((s) => s.fragments)
          .map((f) => /^\/messages\/(\d+)$/.exec(f.path)?.[1])
          .filter(Boolean),
      );
      const item = memoryRecordsToContextItems([rawRecord], {
        insertionSequence: plannedMessageSlots.size - memorySources.length - 1,
      })[0];
      assert.equal(item.sourceRef.revision, corrected.revision);
      assert.equal(item.sourceRef.digest, corrected.digest);
      assert.equal(
        memorySources[0].digest,
        item.digest,
        "journal source digest must bind the actual corrected record revision",
      );
      const mapping = wire.sourceMapping.sources.find(
        (s) => s.ordinal === memorySources[0].ordinal,
      );
      for (const fragment of mapping.fragments) {
        const value = fragment.path
          .split("/")
          .slice(1)
          .reduce((v, key) => v[key], physical.body);
        assert.equal(sha(canonicalJson(value)), fragment.digest);
        assert.ok(canonicalJson(value).includes(sample.next));
      }
      const beforeDelete = await prepare(sample.query);
      const deletion = await run(["memory", "delete", added.id]);
      assert.equal(deletion.status, 0, deletion.stderr);
      let dispatched = false;
      await assert.rejects(
        beforeDelete.dispatchResource.withLock(() => {
          dispatched = true;
        }),
        /revision|changed/i,
      );
      assert.equal(dispatched, false);
      const deletedResponse = await run(
        [
          "agent",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--provider",
          "ollama",
          "--model",
          "test",
          "--base-url",
          baseUrl,
          "--session",
          sessionId,
          "--no-mcp",
          "--no-project-memory",
          "--sandbox-mode",
          "off",
          "--max-turns",
          "1",
          "--max-output-tokens",
          "128",
        ],
        JSON.stringify({
          type: "user",
          message: { role: "user", content: sample.query },
        }) + "\n",
      );
      assert.equal(deletedResponse.status, 0, deletedResponse.stderr);
      assert.ok(
        deletedResponse.stdout
          .trim()
          .split(/\r?\n/)
          .map(JSON.parse)
          .some((e) => e.type === "result" && e.subtype === "success"),
      );
      assert.equal(bodies.length, priorCalls + 2);
      assert.ok(!JSON.stringify(bodies.at(-1).body).includes(sample.next));
      assert.ok(!JSON.stringify(bodies.at(-1).body).includes(sample.old));
      const afterRestart = await json([
        "session",
        "show",
        sessionId,
        "--model-inputs",
        "--json",
      ]);
      assert.equal(afterRestart.total, 4);
      const restartedWire = afterRestart.records
        .map((r) => r.diagnostic)
        .filter((d) => d.stage === "fetch-body")
        .at(-1);
      assert.equal(restartedWire.bodyDigest, bodies.at(-1).sha256);
      assert.equal(restartedWire.sourceMapping.covered, true);
      assert.equal(
        afterRestart.records
          .map((r) => r.diagnostic)
          .filter((d) => d.phase === "logical-input")
          .at(-1)
          .planning.sources.filter((s) => s.kind === "memory").length,
        0,
      );
      results.push({
        memoryId: added.id,
        before,
        corrected,
        correctionOutcome,
        sessionId,
        sourceRef: item.sourceRef,
        sourceItemDigest: item.digest,
        physicalSha256: physical.sha256,
        report,
        afterRestart,
      });
    }
    const journalFiles = journalSnapshot().map((row) => row.file);
    const journalRows = [];
    const journals = journalFiles.map((file, index) => {
      const raw = fs.readFileSync(file);
      const rows = raw
        .toString("utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(JSON.parse);
      let previous = null;
      for (const row of rows.filter((row) => row.hash)) {
        assert.equal(row.prevHash, previous);
        assert.equal(computeEventHash(previous, row), row.hash);
        previous = row.hash;
      }
      journalRows.push(...rows);
      fs.writeFileSync(path.join(output, `journal-${index}.jsonl`), raw);
      return { name: `journal-${index}.jsonl`, sha256: sha(raw) };
    });
    for (const result of results)
      for (const record of result.afterRestart.records) {
        const row = journalRows.find((row) => row.hash === record.eventHash);
        assert.ok(
          row,
          "CLI diagnostics must reference a real persisted journal event",
        );
        assert.equal(row.type, "model_input_diagnostic");
        assert.deepEqual(row.data, record.diagnostic);
      }
    assert.equal(
      bodies.length,
      4,
      "correction and diagnostic reads must not dispatch additional provider requests",
    );
    const receipt = {
      passed: false,
      assertionsPassed: true,
      cleanupComplete: false,
      scope:
        "fresh public CLI + loopback fixture provider + stream journal; no model quality claim; Chinese initial summary/ref uses Kernel proposal API",
      providerCalls: bodies.length,
      results,
      journals,
      processCount: invocations.length,
    };
    completedReceipt = receipt;
    write(path.join(output, "receipt.json"), receipt);
    return receipt;
  } catch (error) {
    write(path.join(output, "failure.json"), {
      message: error.message,
      stack: error.stack,
      root,
      providerCalls: bodies.length,
    });
    throw error;
  } finally {
    for (const child of owned) child.kill();
    await Promise.all(
      [...owned].map(
        (child) => new Promise((resolve) => child.once("close", resolve)),
      ),
    );
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(fs.realpathSync(root), rootIdentity);
    assert.ok(rootIdentity.startsWith(fs.realpathSync(tmpdir()) + path.sep));
    const check = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        assert.ok(
          !fs.lstatSync(file).isSymbolicLink(),
          "refuse cleanup through symlink",
        );
        if (entry.isDirectory()) check(file);
      }
    };
    check(root);
    fs.rmSync(root, { recursive: true, force: true });
    if (completedReceipt) {
      completedReceipt.cleanupComplete = true;
      completedReceipt.passed = true;
      if (evidenceDir)
        write(path.join(output, "receipt.json"), completedReceipt);
    }
  }
}
