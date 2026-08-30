import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

// Generic CLI jobs do not install Chromium; the dedicated UI workflow opts in.
const browserE2E =
  process.env.CC_RECORD_REPLAY_BROWSER_E2E === "1" ? describe : describe.skip;

browserE2E("E2E: cc skill recording lifecycle", () => {
  let projectRoot;
  let configHome;
  let fixturePath;
  let automationPath;
  let assertionsPath;
  let exportPath;
  let policyPath;

  function run(args, { expectFailure = false } = {}) {
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CHAINLESSCHAIN_HOME: configHome,
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (!expectFailure && result.status !== 0) {
      throw new Error(
        `CLI failed (${result.status}): ${result.stderr || result.stdout}`,
      );
    }
    return result;
  }

  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "cc-record-cli-project-"));
    configHome = mkdtempSync(join(tmpdir(), "cc-record-cli-home-"));
    mkdirSync(join(projectRoot, ".chainlesschain"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".chainlesschain", "config.json"),
      "{}\n",
      "utf8",
    );
    fixturePath = join(projectRoot, "fixture.html");
    automationPath = join(projectRoot, "automation.json");
    assertionsPath = join(projectRoot, "assertions.json");
    exportPath = join(projectRoot, "recorded-export.json");
    policyPath = join(projectRoot, "recorded-policy.json");
    writeFileSync(
      fixturePath,
      `<!doctype html><html><body>
        <button id="go" onclick="document.querySelector('h1').textContent='ready'">Go</button>
        <input id="name">
        <select id="choice"><option value="one">One</option><option value="two">Two</option></select>
        <h1>idle</h1>
      </body></html>`,
      "utf8",
    );
    writeFileSync(
      automationPath,
      `${JSON.stringify([
        { kind: "click", target: "#go" },
        { kind: "type", target: "#name", value: "captured-name" },
        { kind: "select", target: "#choice", value: "two" },
      ])}\n`,
      "utf8",
    );
    writeFileSync(
      assertionsPath,
      `${JSON.stringify([{ target: "h1", value: "ready" }])}\n`,
      "utf8",
    );
    writeFileSync(
      policyPath,
      `${JSON.stringify({
        schema: "chainlesschain.recorded-skill-policy/v1",
        retentionDays: 90,
        maxRecords: 500,
        maxActions: 256,
        maxAuditEvents: 20_000,
        allowedCapabilities: ["ui.interact", "ui.observe"],
        allowGlobalInstall: false,
      })}\n`,
      "utf8",
    );
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  });

  it("records, reviews, replays, enables, revokes, exports, deletes, and imports", () => {
    const unapprovedPolicy = run(
      ["skill", "recording", "policy", "--set", policyPath, "--json"],
      { expectFailure: true },
    );
    expect(JSON.parse(unapprovedPolicy.stdout)).toMatchObject({
      code: "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
    });
    expect(
      JSON.parse(
        run([
          "skill",
          "recording",
          "policy",
          "--set",
          policyPath,
          "--approve",
          "--json",
        ]).stdout,
      ),
    ).toMatchObject({ allowGlobalInstall: false });

    const recorded = JSON.parse(
      run([
        "skill",
        "recording",
        "record",
        "cli-flow",
        "--fixture",
        fixturePath,
        "--automation",
        automationPath,
        "--observe",
        "h1",
        "--assertions",
        assertionsPath,
        "--failure",
        "the ready state is not reached",
        "--json",
      ]).stdout,
    );
    expect(recorded).toMatchObject({
      name: "cli-flow",
      state: "draft",
      revision: 1,
    });
    expect(recorded.actions.map((action) => action.kind)).toEqual([
      "click",
      "type",
      "select",
      "observe",
      "assert",
    ]);

    const readOnlyReview = run(
      [
        "skill",
        "recording",
        "review",
        "cli-flow",
        "--reviewer",
        "cli-reviewer",
        "--json",
      ],
      { expectFailure: true },
    );
    expect(readOnlyReview.status).toBe(1);
    expect(JSON.parse(readOnlyReview.stdout)).toMatchObject({
      code: "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
    });

    const approved = JSON.parse(
      run([
        "skill",
        "recording",
        "review",
        "cli-flow",
        "--reviewer",
        "cli-reviewer",
        "--approve",
        "--json",
      ]).stdout,
    );
    expect(approved).toMatchObject({ state: "approved", revision: 2 });

    const replayed = JSON.parse(
      run([
        "skill",
        "recording",
        "replay",
        "cli-flow",
        "--fixture",
        fixturePath,
        "--input",
        "name=runtime-name",
        "--input",
        "choice=two",
        "--settle-ms",
        "0",
        "--json",
      ]).stdout,
    );
    expect(replayed).toMatchObject({
      success: true,
      name: "cli-flow",
      state: "validated",
      actionCount: 5,
    });

    const enabled = JSON.parse(
      run(["skill", "recording", "enable", "cli-flow", "--approve", "--json"])
        .stdout,
    );
    expect(enabled).toMatchObject({
      success: true,
      state: "enabled",
      scope: "project",
    });
    const installedDir = join(
      projectRoot,
      ".chainlesschain",
      "skills",
      "cli-flow",
    );
    expect(existsSync(join(installedDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(installedDir, "recorded-skill.json"))).toBe(true);
    expect(
      run(["skill", "list", "--source", "workspace", "--json"]).stdout,
    ).toContain("cli-flow");

    const revoked = JSON.parse(
      run(["skill", "recording", "revoke", "cli-flow", "--approve", "--json"])
        .stdout,
    );
    expect(revoked).toMatchObject({ success: true, state: "revoked" });
    expect(existsSync(installedDir)).toBe(false);

    run([
      "skill",
      "recording",
      "export",
      "cli-flow",
      "--output",
      exportPath,
      "--json",
    ]);
    const exportedText = readFileSync(exportPath, "utf8");
    expect(exportedText).not.toContain("captured-name");
    expect(exportedText).not.toContain("runtime-name");

    run(["skill", "recording", "delete", "cli-flow", "--approve", "--json"]);
    const imported = JSON.parse(
      run(["skill", "recording", "import", exportPath, "--json"]).stdout,
    );
    expect(imported).toMatchObject({
      name: "cli-flow",
      state: "validated",
      revision: 1,
    });

    const audit = JSON.parse(
      run(["skill", "recording", "audit", "--name", "cli-flow", "--json"])
        .stdout,
    );
    expect(audit.events.map((event) => event.action)).toEqual([
      "created",
      "approved",
      "replayed",
      "enabled",
      "revoked",
      "exported",
      "deleted",
      "imported",
    ]);
  }, 120_000);
});
