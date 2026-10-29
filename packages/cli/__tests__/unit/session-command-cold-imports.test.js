import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliRoot = fileURLToPath(new URL("../../", import.meta.url));
const loader = pathToFileURL(
  join(cliRoot, "__tests__/fixtures/session-cold-import-guard.mjs"),
).href;
const store = pathToFileURL(
  join(cliRoot, "src/harness/jsonl-session-store.js"),
).href;
const deployment = pathToFileURL(
  join(cliRoot, "src/lib/evolution/evolution-deployment-loader.js"),
).href;
const roots = [];

function isolatedEnv() {
  const home = mkdtempSync(join(tmpdir(), "cc-session-cold-imports-"));
  roots.push(home);
  const env = { ...process.env, CHAINLESSCHAIN_HOME: home, NO_COLOR: "1" };
  for (const name of [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  ])
    delete env[name];
  return env;
}

function run(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: cliRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("session show cold dependency boundary", () => {
  it("reads a canonical session in the executable without loading deployment config or the broker", () => {
    const env = isolatedEnv();
    const fixture = run(
      [
        "--input-type=module",
        "-e",
        `import { appendEvent } from ${JSON.stringify(store)};
         appendEvent('cold-imports', 'session_start', { title: 'Cold imports' });
         appendEvent('cold-imports', 'user_message', { role: 'user', content: 'verified cold content' });`,
      ],
      env,
    );
    expect(fixture.status, fixture.stderr).toBe(0);
    const result = run(
      [
        "--loader",
        loader,
        join(cliRoot, "bin/chainlesschain.js"),
        "session",
        "show",
        "cold-imports",
        "--json",
      ],
      env,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "cold-imports",
      _store: "jsonl",
      message_count: 1,
      messages: [{ role: "user", content: "verified cold content" }],
    });
  });

  it("still requires the deployment config dependency for supported agent commands", () => {
    const result = run(
      [
        "--loader",
        loader,
        "--input-type=module",
        "-e",
        `import { loadEvolutionDeploymentCommandDependencies } from ${JSON.stringify(deployment)};
         try {
           await loadEvolutionDeploymentCommandDependencies('agent');
           process.exitCode = 1;
         } catch (error) {
           if (error.code !== 'CC_SESSION_COLD_IMPORT_GUARD') throw error;
           console.log(error.code);
         }`,
      ],
      isolatedEnv(),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("CC_SESSION_COLD_IMPORT_GUARD");
  });
});
