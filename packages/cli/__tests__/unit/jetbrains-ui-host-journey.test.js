import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeCliEnvironment,
  parseArgs,
  prependPath,
  readPluginVersion,
} from "../../../../packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("JetBrains real-host journey driver", () => {
  it("accepts exact host coordinates and a loopback robot endpoint", () => {
    expect(
      parseArgs([
        "--ide-version",
        "2025.2",
        "--artifact-dir",
        "reports/2025.2",
        "--robot-url",
        "http://127.0.0.1:8082",
      ]),
    ).toMatchObject({
      ideVersion: "2025.2",
      artifactDir: "reports/2025.2",
      robotUrl: "http://127.0.0.1:8082",
    });
  });

  it("rejects host aliases and non-loopback robot endpoints", () => {
    expect(() =>
      parseArgs([
        "--ide-version",
        "current",
        "--artifact-dir",
        "reports/current",
      ]),
    ).toThrow(/exact IntelliJ version/);
    expect(() =>
      parseArgs([
        "--artifact-dir",
        "reports/current",
        "--robot-url",
        "https://example.com:8082",
      ]),
    ).toThrow(/HTTP loopback/);
  });

  it("requires one unambiguous plugin version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-jb-host-driver-"));
    temporaryRoots.push(root);
    const pluginXml = path.join(root, "plugin.xml");
    fs.writeFileSync(
      pluginXml,
      "<idea-plugin><version>0.4.76</version></idea-plugin>",
      "utf8",
    );
    expect(readPluginVersion(pluginXml)).toBe("0.4.76");

    fs.writeFileSync(
      pluginXml,
      "<idea-plugin><version>1</version><version>2</version></idea-plugin>",
      "utf8",
    );
    expect(() => readPluginVersion(pluginXml)).toThrow(/exactly one/);
  });

  it("prepends an isolated fixture CLI without duplicating the PATH key", () => {
    const environment = prependPath(
      { Path: "original-bin", KEEP: "yes" },
      "fixture-bin",
    );
    expect(environment.Path.split(path.delimiter)).toEqual([
      "fixture-bin",
      "original-bin",
    ]);
    expect(environment).not.toHaveProperty("PATH");
    expect(environment.KEEP).toBe("yes");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-jb-fake-cli-"));
    temporaryRoots.push(root);
    const fakeEnvironment = createFakeCliEnvironment(root, process.env);
    const pathKey = Object.keys(fakeEnvironment).find(
      (key) => key.toUpperCase() === "PATH",
    );
    const fakeBin = fakeEnvironment[pathKey].split(path.delimiter)[0];
    expect(fs.existsSync(path.join(fakeBin, "cc"))).toBe(true);
    expect(fs.existsSync(path.join(fakeBin, "cc.cmd"))).toBe(true);

    const version =
      process.platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/s", "/c", "cc --version"], {
            env: fakeEnvironment,
            encoding: "utf8",
            windowsHide: true,
          })
        : spawnSync(path.join(fakeBin, "cc"), ["--version"], {
            env: fakeEnvironment,
            encoding: "utf8",
          });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("0.999.0-ui-journey");
  });

  it("fixture peer streams, settles controls, and advertises resume state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-jb-peer-"));
    temporaryRoots.push(root);
    const script = path.resolve(
      "tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
    );
    const statePath = path.join(root, "state.json");
    const environment = {
      ...process.env,
      CC_UI_FIXTURE_STATE: statePath,
      CC_UI_FIXTURE_TRACE: path.join(root, "trace.jsonl"),
    };

    const first = startFixture(script, environment);
    await waitForEvent(first.events, (event) => event.type === "system");
    first.send({ type: "user", text: "journey:stream" });
    await waitForEvent(
      first.events,
      (event) => event.type === "result" && event.turn === 1,
    );
    first.send({ type: "user", text: "journey:plan" });
    await waitForEvent(
      first.events,
      (event) => event.type === "plan_update" && event.active === true,
    );
    first.send({ type: "plan", action: "approve" });
    await waitForEvent(
      first.events,
      (event) => event.type === "result" && event.turn === 2,
    );
    await first.close();

    const resumed = startFixture(script, environment);
    const init = await waitForEvent(
      resumed.events,
      (event) => event.type === "system",
    );
    expect(init.session_id).toBe("fixture-session");
    expect(init.resumed_messages).toBe(4);
    await resumed.close();
  });
});

function startFixture(script, environment) {
  const child = spawn(
    process.execPath,
    [
      script,
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--resume",
      "fixture-session",
    ],
    { env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  const events = [];
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line));
    }
  });
  return {
    child,
    events,
    send(event) {
      child.stdin.write(`${JSON.stringify(event)}\n`);
    },
    async close() {
      child.stdin.end();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("fixture peer did not exit"));
        }, 2_000);
        child.once("error", reject);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function waitForEvent(events, predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`fixture event not observed: ${JSON.stringify(events)}`);
}
