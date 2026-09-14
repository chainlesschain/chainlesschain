import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const roots = [];
const children = [];

function runProcess({ fixturePath, phase, root, input }) {
  return new Promise((resolve, reject) => {
    const configRoot = path.join(root, "config");
    const securityRoot = path.join(root, "security");
    const child = spawn(process.execPath, [fixturePath, phase], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHAINLESSCHAIN_HOME: configRoot,
        CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: securityRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function events(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("headless deferred questions across OS processes", () => {
  it("restores, resolves, and consumes an answer through the real JSONL store", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-headless-deferred-process-"),
    );
    roots.push(root);
    const fixturePath = fileURLToPath(
      new URL(
        "../fixtures/headless-deferred-resume-process.mjs",
        import.meta.url,
      ),
    );

    const initial = await runProcess({
      fixturePath,
      phase: "request",
      root,
      input: `${JSON.stringify({ type: "user", text: "start" })}\n`,
    });
    expect(initial).toMatchObject({ code: 0, signal: null, stderr: "" });
    const requested = events(initial.stdout).find(
      (event) => event.type === "question_request",
    );
    expect(requested).toMatchObject({
      id: expect.any(String),
      question: "Pick a color",
      purpose: "preference",
      binding: expect.any(Object),
    });

    const resumed = await runProcess({
      fixturePath,
      phase: "resume",
      root,
      input:
        `${JSON.stringify({
          type: "answer",
          id: requested.id,
          answer: "Blue",
          binding: requested.binding,
        })}\n` + `${JSON.stringify({ type: "user", text: "continue" })}\n`,
    });
    expect(resumed).toMatchObject({ code: 0, signal: null, stderr: "" });
    const resumedEvents = events(resumed.stdout);
    expect(resumedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "question_request",
          id: requested.id,
          restored: true,
        }),
        expect.objectContaining({
          type: "question_resolved",
          id: requested.id,
          via: "user-answer",
        }),
        expect.objectContaining({
          type: "result",
          result: expect.stringContaining('"answer":"Blue"'),
        }),
      ]),
    );
  }, 30_000);
});
