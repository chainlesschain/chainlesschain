import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  reliabilityResultFailure,
  readReliabilityFetchDiagnostics,
  readReliabilityFetchRuntime,
} from "../../scripts/cli-reliability-fetch-diagnostics.mjs";

const roots = [];
const canonicalTemp = realpathSync.native(tmpdir());
const schema = "chainlesschain.fetch-diagnostics/v1";
function file(records = []) {
  const root = mkdtempSync(join(canonicalTemp, "cc-soak-fetch-diagnostic-"));
  roots.push(root);
  const path = join(root, "diagnostics.jsonl");
  writeFileSync(
    path,
    records.map((record) => JSON.stringify({ schema, ...record })).join("\n"),
  );
  return path;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(dirname(resolve(root))).toBe(canonicalTemp);
    expect(basename(root).startsWith("cc-soak-fetch-diagnostic-")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("reliability fetch diagnostics", () => {
  it("reads versions from the shared binary and CLI resolution coordinate without paths", () => {
    const runtime = readReliabilityFetchRuntime();
    expect(runtime).toEqual({
      coordinate: "parent-shared-binary-and-cli-module-resolution",
      node: process.versions.node,
      uv: process.versions.uv,
      bundledUndici: process.versions.undici || null,
      ollamaUndici: expect.stringMatching(/^\d+\.\d+\.\d+$/u),
    });
    expect(JSON.stringify(runtime)).not.toContain("node_modules");
  });

  it("projects missing or invalid resolved package versions as null", () => {
    const require = createRequire(
      new URL("../../src/lib/ollama-provider-fetch.js", import.meta.url),
    );
    const metadata = require("undici/package.json");
    const original = metadata.version;
    try {
      for (const value of [
        undefined,
        null,
        7,
        {},
        "secret-url",
        "7.30.1\nsecret",
      ]) {
        metadata.version = value;
        expect(readReliabilityFetchRuntime().ollamaUndici).toBeNull();
      }
    } finally {
      metadata.version = original;
    }
  });
  it("does not execute accessors or proxy traps during failure projection", () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("secret");
        },
      },
    );
    expect(reliabilityResultFailure(hostile, 1)).toEqual({
      turn: 1,
      subtype: "unknown",
      errorDetails: null,
    });
    const details = {
      kind: "transport",
      get code() {
        throw new Error("secret");
      },
    };
    expect(
      reliabilityResultFailure(
        { is_error: true, subtype: "error", error_details: details },
        2,
      ),
    ).toEqual({ turn: 2, subtype: "error", errorDetails: null });
  });
  it("retains only fixed failure fields and the observed turn", () => {
    const result = reliabilityResultFailure(
      {
        is_error: true,
        subtype: "error",
        turn: "secret-turn",
        error: "secret-message",
        error_details: {
          kind: "transport",
          name: "TypeError",
          causeCode: "ECONNREFUSED",
          endpoint: "secret-host",
        },
      },
      6,
    );
    expect(result).toEqual({
      turn: 6,
      subtype: "error",
      errorDetails: {
        kind: "transport",
        name: "TypeError",
        causeCode: "ECONNREFUSED",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(reliabilityResultFailure({ is_error: false }, 7)).toBeNull();
  });

  it("does not copy unknown subtype or transport fields", () => {
    expect(
      reliabilityResultFailure(
        {
          is_error: true,
          subtype: "secret-subtype",
          error_details: {
            kind: "transport",
            name: "secret-name",
            code: "secret-code",
            causeCode: "secret-cause",
          },
        },
        -1,
      ),
    ).toEqual({ turn: null, subtype: "unknown", errorDetails: null });
  });

  it("retains bounded storage cause codes while keeping the original failure classification", () => {
    const failure = reliabilityResultFailure(
      {
        is_error: true,
        subtype: "error_evolution_ingress",
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        error:
          "private error text/path [storage_cause_codes: CC_EVOLUTION_ARTIFACT_STORE_FAILED -> EPERM]",
      },
      17,
    );
    expect(failure).toEqual({
      turn: 17,
      subtype: "unknown",
      errorDetails: null,
      storageCauseCodes: ["CC_EVOLUTION_ARTIFACT_STORE_FAILED", "EPERM"],
    });
    expect(JSON.stringify(failure)).not.toContain("private");
    expect(
      reliabilityResultFailure(
        { is_error: false, error: " [storage_cause_codes: EPERM]" },
        18,
      ),
    ).toBeNull();
  });

  it("does not accept arbitrary storage markers or execute an error accessor", () => {
    const base = {
      is_error: true,
      subtype: "error_evolution_ingress",
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    };
    for (const error of [
      "private [storage_cause_codes: UNKNOWN_PRIVATE_KEY]",
      {
        toString() {
          throw new Error("private");
        },
      },
    ])
      expect(
        reliabilityResultFailure({ ...base, error }, 1),
      ).not.toHaveProperty("storageCauseCodes");
    const hostile = { ...base };
    Object.defineProperty(hostile, "error", {
      get() {
        throw new Error("must not access error getter");
      },
    });
    expect(reliabilityResultFailure(hostile, 1)).not.toHaveProperty(
      "storageCauseCodes",
    );
    expect(
      reliabilityResultFailure(
        { ...base, code: "unknown", error: " [storage_cause_codes: EPERM]" },
        1,
      ),
    ).not.toHaveProperty("storageCauseCodes");
  });

  it("reprojects preload records without messages, endpoints, or private data", () => {
    const path = file([
      { event: "enabled", passive: true },
      {
        event: "undici:request:error",
        endpoint: "loopback-broker",
        error: {
          name: "TypeError",
          code: "UND_ERR_SOCKET",
          causeCode: "ECONNRESET",
          message: "secret-message",
        },
        url: "secret-url",
      },
      {
        event: "undici:client:connectError",
        endpoint: "secret-endpoint",
        error: { name: "secret-name", code: "secret-code" },
      },
      { event: "secret-event", endpoint: "other" },
    ]);
    const result = readReliabilityFetchDiagnostics(path);
    expect(result).toEqual({
      available: true,
      enabled: true,
      truncated: false,
      events: [
        {
          event: "undici:request:error",
          endpoint: "loopback-broker",
          error: {
            kind: "transport",
            name: "TypeError",
            code: "UND_ERR_SOCKET",
            causeCode: "ECONNRESET",
          },
        },
        {
          event: "undici:client:connectError",
          endpoint: "unknown",
          error: null,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("bounds both records and bytes and tolerates incomplete or absent files", () => {
    const path = file(
      Array.from({ length: 200 }, () => ({
        event: "undici:request:error",
        endpoint: "other",
      })),
    );
    expect(readReliabilityFetchDiagnostics(path)).toMatchObject({
      truncated: true,
      events: expect.any(Array),
    });
    expect(readReliabilityFetchDiagnostics(path).events).toHaveLength(128);
    writeFileSync(
      path,
      JSON.stringify({ schema, event: "enabled", passive: true }) +
        "\n" +
        "x".repeat(100_000),
    );
    expect(readReliabilityFetchDiagnostics(path)).toEqual({
      available: true,
      enabled: true,
      truncated: true,
      events: [],
    });
    writeFileSync(path, "{unfinished\nnull\n{}");
    expect(readReliabilityFetchDiagnostics(path)).toEqual({
      available: true,
      enabled: false,
      truncated: false,
      events: [],
    });
    expect(readReliabilityFetchDiagnostics(join(path, "missing"))).toEqual({
      available: false,
      enabled: false,
      truncated: false,
      events: [],
    });
  });

  it("honors the preload truncation marker", () => {
    expect(
      readReliabilityFetchDiagnostics(
        file([{ event: "truncated", reason: "record-limit" }]),
      ),
    ).toMatchObject({ truncated: true });
  });

  it("captures a real loopback failure through the unchanged passive preload", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    await new Promise((resolve) => server.close(resolve));
    const path = join(file(), "..", "fresh.jsonl");
    const preload = fileURLToPath(
      new URL(
        "../../scripts/verify01-fetch-diagnostics-preload.cjs",
        import.meta.url,
      ),
    );
    const child = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "-e",
        `fetch(${JSON.stringify(url)}).then(()=>{process.exitCode=2},()=>process.stdout.write('expected failure'));`,
      ],
      {
        env: {
          ...process.env,
          CC_VERIFY01_FETCH_DIAGNOSTICS_FILE: path,
          CC_VERIFY01_FETCH_BROKER_ORIGIN: url,
        },
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout).toBe("expected failure");
    expect(child.stderr).toBe("");
    const result = readReliabilityFetchDiagnostics(path);
    expect(result.enabled).toBe(true);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        event: "undici:request:error",
        endpoint: "loopback-broker",
        error: expect.objectContaining({ code: "ECONNREFUSED" }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(url);
  });
});
