import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const servers = [];
const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise((resolve) => server.close(() => resolve(undefined))),
      ),
  );
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve("bin/chainlesschain.js"), ...args],
      {
        cwd: path.resolve("."),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("published CLI OTLP lifecycle", () => {
  it("sends a real eval run through --otlp-endpoint before process exit", async () => {
    const requests = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200);
        response.end();
      });
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-otlp-cli-"));
    tempDirs.push(home);

    const result = await runCli(
      ["--otlp-endpoint", endpoint, "eval", "--dry-run", "--json"],
      {
        CHAINLESSCHAIN_HOME: home,
        CC_OTEL_SPOOL_DIR: path.join(home, "spool"),
        CC_EVENT_RUNTIME_DURABLE: "0",
        OTEL_SDK_DISABLED: "false",
      },
    );

    // A no-op agent intentionally fails the self-checking eval tasks, so the
    // eval gate exits 1; telemetry must still flush on that normal failure.
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).total).toBeGreaterThan(0);
    const traceRequest = requests.find((item) => item.url === "/v1/traces");
    expect(traceRequest).toBeDefined();
    const spans = traceRequest.body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((item) => item.name === "eval.task")).toBe(true);
    expect(
      fs.existsSync(path.join(home, "spool")) &&
        fs
          .readdirSync(path.join(home, "spool"))
          .some((name) => name.endsWith(".json")),
    ).toBe(false);
  }, 30_000);

  it("exports content-free legacy and replacement command usage", async () => {
    const requests = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200);
        response.end();
      });
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-otlp-lifecycle-"));
    tempDirs.push(home);
    const env = {
      CHAINLESSCHAIN_HOME: home,
      CC_OTEL_SPOOL_DIR: path.join(home, "spool"),
      CC_EVENT_RUNTIME_DURABLE: "0",
      OTEL_SDK_DISABLED: "false",
    };

    const legacy = await runCli(
      ["--otlp-endpoint", endpoint, "dao", "config-v2", "--json"],
      env,
    );
    const replacement = await runCli(
      ["--otlp-endpoint", endpoint, "lab", "dao", "config-v2", "--json"],
      env,
    );

    expect(legacy.code, legacy.stderr).toBe(0);
    expect(replacement.code, replacement.stderr).toBe(0);
    const metrics = requests
      .filter((item) => item.url === "/v1/metrics")
      .flatMap(
        (item) =>
          item.body.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics || [],
      )
      .filter(
        (metric) =>
          metric.name === "chainlesschain.cli.command.lifecycle.invocations",
      );
    const routes = metrics.map((metric) =>
      Object.fromEntries(
        metric.sum.dataPoints[0].attributes.map((attribute) => [
          attribute.key,
          attribute.value.stringValue,
        ]),
      ),
    );
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "command.name": "dao",
          "command.route": "legacy",
          "command.outcome": "completed",
        }),
        expect.objectContaining({
          "command.name": "dao",
          "command.route": "replacement",
          "command.outcome": "completed",
        }),
      ]),
    );
    expect(metrics).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain("config-v2");
  }, 30_000);
});
