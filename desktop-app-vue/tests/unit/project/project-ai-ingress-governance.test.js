import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("project AI ingress governance", () => {
  it("blocks the opaque backend before axios and retains the local fallback", () => {
    const source = fs.readFileSync(
      path.resolve("src/main/project/project-ai-ipc-chat.js"),
      "utf8",
    );
    const guard = source.indexOf("assertGovernedProjectAiIngress();");
    const externalPost = source.indexOf(
      "const response = await axios.post(",
      guard,
    );
    const localFallback = source.indexOf("useLocalLLM = true;", externalPost);

    expect(guard).toBeGreaterThan(-1);
    expect(externalPost).toBeGreaterThan(guard);
    expect(localFallback).toBeGreaterThan(externalPost);
    expect(source).toContain(
      'error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED"',
    );
  });

  it("blocks project creation streaming before the AI backend request", () => {
    const source = fs.readFileSync(
      path.resolve("src/main/project/http-client.js"),
      "utf8",
    );
    const method = source.indexOf("async createProjectStream(");
    const guard = source.indexOf("assertGovernedProjectAiIngress();", method);
    const request = source.indexOf("this.client.post(", guard);

    expect(method).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(method);
    expect(request).toBeGreaterThan(guard);
    expect(source).toContain(
      'error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED"',
    );
  });
});
