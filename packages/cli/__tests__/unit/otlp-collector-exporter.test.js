import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OtlpExporter,
  parseOtlpHeaders,
  resolveOtlpConfig,
} from "../../src/lib/observability/otlp-exporter.js";
import {
  ObservabilityRuntime,
  resolveOtlpEndpointFromArgv,
} from "../../src/lib/observability/index.js";
import { TraceContext } from "../../src/lib/execution-trace/trace-context.js";

const tempDirs = [];
const servers = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-otlp-"));
  tempDirs.push(dir);
  return dir;
}

async function collector(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function span(name = "test.span") {
  return {
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    name,
    startTime: 1_000,
    endTime: 1_001,
    attributes: { safe: "yes" },
  };
}

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

describe("OTLP Collector configuration", () => {
  it("uses standard signal endpoints, headers, resources and CLI endpoint forms", () => {
    const config = resolveOtlpConfig(
      { endpoint: "http://collector:4318/tenant" },
      {
        OTEL_SERVICE_NAME: "cc-test",
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=ci,team=runtime",
        OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20abc,x-tenant=a%2Cb",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-signal=trace",
      },
    );

    expect(config.enabled).toBe(true);
    expect(config.traces.endpoint).toBe(
      "http://collector:4318/tenant/v1/traces",
    );
    expect(config.metrics.endpoint).toBe(
      "http://collector:4318/tenant/v1/metrics",
    );
    expect(config.traces.headers).toEqual({
      authorization: "Bearer abc",
      "x-tenant": "a,b",
      "x-signal": "trace",
    });
    expect(config.resourceAttributes).toMatchObject({
      "service.name": "cc-test",
      "deployment.environment": "ci",
      team: "runtime",
    });
    expect(parseOtlpHeaders("broken,%ZZ=x,ok=v")).toEqual({ ok: "v" });
    expect(
      resolveOtlpEndpointFromArgv([
        "node",
        "cc",
        "agent",
        "--otlp-endpoint=http://collector:4318",
      ]),
    ).toBe("http://collector:4318");
  });

  it("honors signal-specific exact endpoints and OTEL_SDK_DISABLED", () => {
    const exact = resolveOtlpConfig(
      {},
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://ignored:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          "https://trace.example/custom/traces",
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
          "https://metric.example/custom/metrics",
      },
    );
    expect(exact.traces.endpoint).toBe("https://trace.example/custom/traces");
    expect(exact.metrics.endpoint).toBe(
      "https://metric.example/custom/metrics",
    );

    const disabled = resolveOtlpConfig(
      { endpoint: "http://collector:4318" },
      { OTEL_SDK_DISABLED: "true" },
    );
    expect(disabled.enabled).toBe(false);
  });

  it("resolves standard grpc protocol without appending HTTP signal paths", () => {
    const config = resolveOtlpConfig(
      { endpoint: "http://collector:4317" },
      { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
    );
    expect(config.traces).toMatchObject({
      protocol: "grpc",
      endpoint: "http://collector:4317/",
    });
    expect(config.metrics).toMatchObject({
      protocol: "grpc",
      endpoint: "http://collector:4317/",
    });
  });

  it("loads standard CA and mTLS files without putting credentials in the queue", () => {
    const reads = [];
    const config = resolveOtlpConfig(
      { endpoint: "https://collector:4318" },
      {
        OTEL_EXPORTER_OTLP_CERTIFICATE: "ca.pem",
        OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE: "client.pem",
        OTEL_EXPORTER_OTLP_CLIENT_KEY: "client.key",
      },
      {
        readFileSync(file) {
          reads.push(file);
          return Buffer.from(`bytes:${file}`);
        },
      },
    );
    expect(reads).toEqual([
      "ca.pem",
      "client.pem",
      "client.key",
      "ca.pem",
      "client.pem",
      "client.key",
    ]);
    expect(config.traces.tls.ca.toString()).toBe("bytes:ca.pem");
    expect(config.traces.tls.cert.toString()).toBe("bytes:client.pem");
    expect(config.traces.tls.key.toString()).toBe("bytes:client.key");
  });
});

describe("OTLP/HTTP export reliability", () => {
  it("batches standard trace and metric JSON onto Collector signal paths", async () => {
    const requests = [];
    const endpoint = await collector((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url,
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200);
        response.end();
      });
    });
    const exporter = new OtlpExporter({
      endpoint,
      headers: { "x-tenant": "team-a" },
      spoolDir: tempDir(),
      scheduleDelayMs: 300_000,
    });

    const modelSpan = span("agent.model");
    modelSpan.attributes.authorization =
      "Bearer sk-abcdef0123456789abcdef0123456789abcdef01";
    exporter.exportSpans([modelSpan, span("agent.tool")]);
    exporter.exportMetrics([
      {
        name: "chainlesschain.team.cost",
        type: "gauge",
        value: 0.25,
        unit: "USD",
      },
    ]);
    await exporter.flush({ force: true });

    expect(requests.map((item) => item.url).sort()).toEqual([
      "/v1/metrics",
      "/v1/traces",
    ]);
    const traces = requests.find((item) => item.url === "/v1/traces");
    expect(traces.headers["content-type"]).toBe("application/json");
    expect(traces.headers["x-tenant"]).toBe("team-a");
    expect(
      traces.body.resourceSpans[0].scopeSpans[0].spans.map((item) => item.name),
    ).toEqual(["agent.model", "agent.tool"]);
    expect(JSON.stringify(traces.body)).not.toContain(
      "sk-abcdef0123456789abcdef0123456789abcdef01",
    );
    const metrics = requests.find((item) => item.url === "/v1/metrics");
    expect(
      metrics.body.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge
        .dataPoints[0].asDouble,
    ).toBe(0.25);
    expect(exporter.getStats()).toMatchObject({
      exported: 2,
      queued: 0,
      protocol: "http/json",
    });
    await exporter.shutdown();
  });

  it("supports standard OTLP/HTTP protobuf payloads", async () => {
    let received;
    const endpoint = await collector((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        received = {
          url: request.url,
          contentType: request.headers["content-type"],
          body: Buffer.concat(chunks),
        };
        response.writeHead(200);
        response.end();
      });
    });
    const exporter = new OtlpExporter({
      endpoint,
      tracesProtocol: "http/protobuf",
      metricsProtocol: "http/protobuf",
      spoolDir: tempDir(),
      scheduleDelayMs: 300_000,
    });
    exporter.exportSpans([span("protobuf.span")]);
    await exporter.flush({ force: true });

    expect(received.url).toBe("/v1/traces");
    expect(received.contentType).toBe("application/x-protobuf");
    expect(received.body.length).toBeGreaterThan(20);
    // ExportTraceServiceRequest.resource_spans = protobuf field 1, wire type 2.
    expect(received.body[0]).toBe(0x0a);
    expect(exporter.getStats()).toMatchObject({
      protocol: "http/protobuf",
      queued: 0,
      exported: 1,
    });
    await exporter.shutdown();
  });

  it("supports standard OTLP/gRPC framing and service methods", async () => {
    let received;
    const server = http2.createServer();
    servers.push(server);
    server.on("stream", (stream, headers) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        received = {
          path: headers[":path"],
          contentType: headers["content-type"],
          body: Buffer.concat(chunks),
        };
        stream.respond({
          ":status": 200,
          "content-type": "application/grpc",
          "grpc-status": "0",
        });
        stream.end(Buffer.alloc(5));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const exporter = new OtlpExporter({
      endpoint,
      tracesProtocol: "grpc",
      metricsProtocol: "grpc",
      spoolDir: tempDir(),
      scheduleDelayMs: 300_000,
    });
    exporter.exportSpans([span("grpc.span")]);
    await exporter.flush({ force: true });

    expect(received.path).toBe(
      "/opentelemetry.proto.collector.trace.v1.TraceService/Export",
    );
    expect(received.contentType).toBe("application/grpc");
    expect(received.body[0]).toBe(0);
    expect(received.body.readUInt32BE(1)).toBe(received.body.length - 5);
    expect(received.body[5]).toBe(0x0a);
    expect(exporter.getStats()).toMatchObject({
      protocol: "grpc",
      queued: 0,
      exported: 1,
    });
    await exporter.shutdown();
  });

  it("retries transient Collector failures and honors the bounded queue", async () => {
    let calls = 0;
    const endpoint = await collector((_request, response) => {
      calls++;
      if (calls === 1) {
        response.writeHead(503, { "Retry-After": "0" });
      } else {
        response.writeHead(200);
      }
      response.end();
    });
    const exporter = new OtlpExporter({
      endpoint,
      spoolDir: tempDir(),
      maxQueueSize: 2,
      maxExportBatchSize: 10,
      maxAttempts: 3,
      scheduleDelayMs: 300_000,
    });

    exporter.exportSpans([span("one")]);
    exporter.exportSpans([span("two")]);
    exporter.exportSpans([span("three")]);
    expect(exporter.getStats()).toMatchObject({
      queued: 2,
      dropped: 1,
      queuePressure: "full",
    });
    await exporter.flush({ force: true });
    expect(exporter.getStats()).toMatchObject({ queued: 2, retried: 2 });
    await exporter.flush({ force: true });
    expect(exporter.getStats()).toMatchObject({ queued: 0, exported: 2 });
    expect(calls).toBe(2);
    await exporter.shutdown();
  });

  it("recovers an unsent crash spool in the next process instance", async () => {
    let available = false;
    const endpoint = await collector((_request, response) => {
      response.writeHead(available ? 200 : 503);
      response.end();
    });
    const spoolDir = tempDir();
    const first = new OtlpExporter({
      endpoint,
      spoolDir,
      maxAttempts: 5,
      scheduleDelayMs: 300_000,
    });
    first.exportSpans([span("survives-crash")]);
    expect(first.getStats().queued).toBe(1);
    await first.shutdown({ timeoutMs: 0 });
    expect(
      fs.readdirSync(spoolDir).some((name) => name.endsWith(".json")),
    ).toBe(true);

    available = true;
    const second = new OtlpExporter(
      {
        endpoint,
        spoolDir,
        maxAttempts: 5,
        scheduleDelayMs: 300_000,
      },
      { pid: process.pid + 10_000, isPidAlive: () => false },
    );
    expect(second.getStats()).toMatchObject({ recovered: 1, queued: 1 });
    await second.forceFlush();
    expect(second.getStats()).toMatchObject({ exported: 1, queued: 0 });
    await second.shutdown();
  });
});

describe("process observability bridge", () => {
  it("exports ended W3C spans, recorder payloads, metrics and team aggregates", async () => {
    const exporter = {
      enabled: true,
      exportSpans: vi.fn(() => true),
      exportTracePayload: vi.fn(() => true),
      exportMetrics: vi.fn(() => true),
      shutdown: vi.fn(async () => ({ exported: 4 })),
      getStats: vi.fn(() => ({ enabled: true })),
    };
    const context = new TraceContext();
    const metrics = {
      collect: () => ({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "cli.calls",
                    type: "counter",
                    value: 3,
                    labels: { command: "agent" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    };
    const runtime = new ObservabilityRuntime(
      {},
      { exporter, traceContext: context, metricsCollector: metrics },
    );
    const root = context.startRootSpan("cli.command");
    context.endSpan(root);
    runtime.exportRecorder({
      toOtlp: () => ({ resourceSpans: [{ scopeSpans: [] }] }),
    });
    runtime.exportTeamSummary({
      workflowRunId: "run-1",
      workflowName: "tasks.json",
      summary: { executions: 4, stats: { completed: 3, failed: 1 } },
      budget: { status: () => ({ tasks: 4, tokens: 120, spentUsd: 0.5 }) },
    });
    await runtime.shutdown();

    expect(exporter.exportSpans).toHaveBeenCalledTimes(1);
    expect(exporter.exportTracePayload).toHaveBeenCalledTimes(1);
    expect(exporter.exportMetrics).toHaveBeenCalledTimes(2);
    const teamMetrics = exporter.exportMetrics.mock.calls[0][0];
    expect(
      Object.fromEntries(
        teamMetrics.map((metric) => [metric.name, metric.value]),
      ),
    ).toMatchObject({
      "chainlesschain.team.tokens": 120,
      "chainlesschain.team.cost": 0.5,
      "chainlesschain.team.failures": 1,
    });
    expect(exporter.shutdown).toHaveBeenCalledTimes(1);
  });
});
