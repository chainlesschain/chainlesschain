import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
  CODEX_APP_SERVER_SCHEMA_PROBE_VERSION,
  CODEX_APP_SERVER_SUPPORT,
  codexAppServerCiMatrices,
  getCodexAppServerSupport,
} from "../../src/lib/codex-app-server-support.js";
import {
  CodexAppServerAdapter,
  isCodexAppServerVersionCompatible,
} from "../../src/lib/codex-app-server-adapter.js";
import { PROBE_VERSION } from "../../scripts/codex-app-server-turn-probe.mjs";
import { renderCodexAppServerSupport } from "../../scripts/codex-app-server-support.mjs";
import { verifyGeneratedCodexSchemas } from "../../scripts/verify-codex-app-server-schema.mjs";

const script = fileURLToPath(
  new URL("../../scripts/codex-app-server-support.mjs", import.meta.url),
);
const repositoryUrl = new URL("../../../../", import.meta.url);
const readRepo = (path) => readFileSync(new URL(path, repositoryUrl), "utf8");
const temporaryDirs = [];
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "cc-codex-support-"));
  temporaryDirs.push(path);
  return path;
}
afterEach(() => {
  for (const path of temporaryDirs.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("cc-codex-support-")
    )
      throw new Error("Refusing cleanup outside test temp directory");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("shared external Codex support boundary", () => {
  it("keeps configured probes separate from experimental and production admission", () => {
    const support = getCodexAppServerSupport("codex-cli 0.160.0");
    expect(support).toMatchObject({
      upstreamVersion: "0.160.0",
      knownVersion: true,
      defaultEnabled: false,
      productionAdmitted: false,
      experimentalAllowed: false,
      compatibilityProbeConfigured: false,
      schemaAndTurnProbeConfigured: true,
    });
    expect(
      isCodexAppServerVersionCompatible(
        "0.160.0",
        CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
      ),
    ).toBe(false);
    expect(
      Object.keys(support).some((key) => /passed|verified/i.test(key)),
    ).toBe(false);
    expect(PROBE_VERSION).toBe(CODEX_APP_SERVER_SCHEMA_PROBE_VERSION);
    expect(
      CODEX_APP_SERVER_SUPPORT.versions.filter(
        (entry) => entry.schemaAndTurnProbeConfigured,
      ),
    ).toHaveLength(1);
  });

  it.each([
    "0.164.0",
    "0.165.0",
    "0.154.1",
    "0.154.0-beta.1",
    "0.154.0+local",
    "0.154.00",
    "codex-cli 0.154.0 unexpected",
    "unknown",
    undefined,
  ])("never admits unlisted or ambiguous version %s", (version) => {
    expect(getCodexAppServerSupport(version)).toMatchObject({
      knownVersion: false,
      defaultEnabled: false,
      productionAdmitted: false,
      experimentalAllowed: false,
      compatibilityProbeConfigured: false,
      schemaAndTurnProbeConfigured: false,
    });
    expect(
      isCodexAppServerVersionCompatible(
        version,
        CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
      ),
    ).toBe(false);
  });

  it("derives all CI cells from the manifest without silently losing an allowed version", () => {
    const matrices = codexAppServerCiMatrices();
    expect(matrices.compatibility.include).toHaveLength(12);
    expect(matrices.schema.include).toHaveLength(3);
    for (const entry of CODEX_APP_SERVER_COMPATIBILITY_MATRIX) {
      const cells = matrices.compatibility.include.filter(
        (cell) => cell.codex_version === entry.version,
      );
      expect(new Set(cells.map((cell) => cell.platform))).toEqual(
        new Set(["linux", "windows", "macos"]),
      );
    }
    for (const cells of Object.values(matrices)) {
      expect(
        new Set(cells.include.map((cell) => JSON.stringify(cell))).size,
      ).toBe(cells.include.length);
    }
    expect(Object.isFrozen(CODEX_APP_SERVER_SUPPORT.versions[0])).toBe(true);
    expect(Object.isFrozen(CODEX_APP_SERVER_COMPATIBILITY_MATRIX)).toBe(true);
  });

  it("shows the actual exec fallback and probe-only support without contacting App Server", async () => {
    const client = { request: vi.fn() };
    const fallback = vi.fn(async () => ({
      terminal: "completed",
      output: "exec result",
      protocol: "misleading",
      support: { productionAdmitted: true },
    }));
    const adapter = new CodexAppServerAdapter({
      client,
      fallback,
      enabled: true,
      upstreamVersion: "codex-cli 0.160.0",
    });
    expect(adapter.runtimeClaims()).toMatchObject({
      compatibilitySource: "manifest",
      versionCompatible: false,
    });
    await expect(
      adapter.execute({ prompt: "one submission" }),
    ).resolves.toMatchObject({
      protocol: "codex-exec-jsonl-v1",
      fallback: true,
      fallbackReason: "version_incompatible",
      support: {
        productionAdmitted: false,
        schemaAndTurnProbeConfigured: true,
      },
    });
    expect(fallback).toHaveBeenCalledExactlyOnceWith({
      prompt: "one submission",
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("labels a probe override without promoting its version in the support manifest", async () => {
    const client = new EventEmitter();
    client.running = true;
    client.request = vi.fn(async () => ({
      turn: { id: "probe-turn", status: "completed", items: [] },
    }));
    const adapter = new CodexAppServerAdapter({
      client,
      enabled: true,
      upstreamVersion: PROBE_VERSION,
      compatibilityMatrix: [{ version: PROBE_VERSION }],
    });
    expect(adapter.runtimeClaims()).toMatchObject({
      compatibilitySource: "override",
      versionCompatible: true,
      support: { experimentalAllowed: false, productionAdmitted: false },
    });
    await expect(
      adapter.execute({ threadId: "probe-thread" }),
    ).resolves.toMatchObject({
      protocol: "codex-app-server-experimental-v1",
      fallback: false,
      support: { experimentalAllowed: false, productionAdmitted: false },
    });
    expect(getCodexAppServerSupport(PROBE_VERSION).experimentalAllowed).toBe(
      false,
    );
  });

  it("preserves protocol diagnostics when turn submission is unknown and never retries via exec", async () => {
    const client = new EventEmitter();
    client.running = true;
    client.request = vi.fn(async () => {
      throw new Error("connection reset after write");
    });
    const fallback = vi.fn();
    const adapter = new CodexAppServerAdapter({
      client,
      fallback,
      enabled: true,
      upstreamVersion: "0.154.0",
    });
    await expect(
      adapter.execute({ threadId: "existing" }),
    ).rejects.toMatchObject({
      code: "CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN",
      protocol: "codex-app-server-experimental-v1",
      fallbackSuppressed: true,
      support: { upstreamVersion: "0.154.0", productionAdmitted: false },
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(client.listenerCount("notification")).toBe(0);
  });

  it("keeps an admitted turn on its original protocol when the terminal event never arrives", async () => {
    vi.useFakeTimers();
    try {
      const client = new EventEmitter();
      client.running = true;
      client.request = vi.fn(async () => ({
        turn: { id: "accepted", status: "inProgress" },
      }));
      const fallback = vi.fn();
      const adapter = new CodexAppServerAdapter({
        client,
        fallback,
        enabled: true,
        upstreamVersion: "0.154.0",
        timeoutMs: 10,
      });
      const pending = expect(
        adapter.execute({ threadId: "existing" }),
      ).rejects.toMatchObject({
        code: "CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION",
        protocol: "codex-app-server-experimental-v1",
        fallbackSuppressed: true,
        support: { upstreamVersion: "0.154.0", productionAdmitted: false },
      });
      await vi.advanceTimersByTimeAsync(10);
      await pending;
      expect(fallback).not.toHaveBeenCalled();
      expect(client.request).toHaveBeenCalledTimes(1);
      expect(client.listenerCount("notification")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds the schema verifier to the manifest version and still refuses modified upstream bytes", () => {
    const path = temporaryDirectory();
    const files = {
      "ClientRequest.json": "request",
      "ServerNotification.json": "notification",
      "ServerRequest.json": "server-request",
      "CommandExecutionRequestApprovalResponse.json": "approval-response",
    };
    for (const [file, kind] of Object.entries(files)) {
      writeFileSync(
        join(path, file),
        readRepo(
          `packages/cli/__tests__/fixtures/external-agent/codex-app-server-${PROBE_VERSION}-${kind}.schema.json`,
        ),
      );
    }
    expect(verifyGeneratedCodexSchemas(path)).toMatchObject({
      upstreamVersion: PROBE_VERSION,
      schemaMatches: true,
      productionAdmission: false,
    });
    writeFileSync(
      join(path, "ClientRequest.json"),
      `${readFileSync(join(path, "ClientRequest.json"), "utf8")}\n`,
    );
    expect(() => verifyGeneratedCodexSchemas(path)).toThrow(/schema differs/);
  });

  it("makes GitHub output and the JSON matrix agree and rejects unsupported arguments", () => {
    const outputPath = join(temporaryDirectory(), "output");
    const json = JSON.parse(
      execFileSync(process.execPath, [script, "--ci"], { encoding: "utf8" }),
    );
    execFileSync(process.execPath, [script, "--github-output"], {
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });
    const actual = Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [
            line.slice(0, separator),
            JSON.parse(line.slice(separator + 1)),
          ];
        }),
    );
    expect(actual).toEqual(json);
    expect(spawnSync(process.execPath, [script, "--ci", "extra"]).status).toBe(
      1,
    );
    const inspected = JSON.parse(
      execFileSync(
        process.execPath,
        [script, "--version", "codex-cli 0.160.0"],
        { encoding: "utf8" },
      ),
    );
    expect(inspected).toMatchObject({
      knownVersion: true,
      experimentalAllowed: false,
    });
  });

  it("detects support documentation drift while accepting Windows line endings", () => {
    const document = renderCodexAppServerSupport();
    expect(
      readRepo("docs/cli/CODEX_APP_SERVER_SUPPORT.generated.md").replaceAll(
        "\r\n",
        "\n",
      ),
    ).toBe(document);
    const outputPath = join(temporaryDirectory(), "support.md");
    execFileSync(process.execPath, [script, "--out", outputPath]);
    expect(readFileSync(outputPath, "utf8")).toBe(document);
    writeFileSync(outputPath, document.replaceAll("\n", "\r\n"));
    execFileSync(process.execPath, [script, "--check", outputPath]);
    writeFileSync(outputPath, `${document}\nunsupported claim`);
    expect(
      spawnSync(process.execPath, [script, "--check", outputPath]).status,
    ).toBe(1);
  });

  it("keeps the workflow wired to generated matrices and requires every job in its final gate", () => {
    const workflow = yaml.safeLoad(
      readRepo(".github/workflows/codex-app-server-compatibility.yml"),
    );
    for (const [job, output] of [
      ["compatibility", "compatibility"],
      ["upstream-schema", "schema"],
    ]) {
      expect(workflow.jobs[job].needs).toBe("support-config");
      expect(workflow.jobs[job].strategy.matrix).toBe(
        `\${{ fromJSON(needs.support-config.outputs.${output}) }}`,
      );
    }
    expect(workflow.jobs.aggregate.needs).toEqual(
      expect.arrayContaining([
        "support-config",
        "contracts",
        "compatibility",
        "upstream-schema",
      ]),
    );
    expect(
      workflow.jobs["support-config"].steps.some((step) =>
        step.run?.includes(
          "--check docs/cli/CODEX_APP_SERVER_SUPPORT.generated.md",
        ),
      ),
    ).toBe(true);
    for (const trigger of ["push", "pull_request"]) {
      expect(workflow.on[trigger].paths).toContain(
        "packages/cli/src/lib/codex-app-server-support.js",
      );
    }
  });
});
