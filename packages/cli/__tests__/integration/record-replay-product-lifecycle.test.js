import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RecordedSkillStore,
  assertRecordedSkillBrowserBinding,
  inspectRecordedSkillPackage,
  installRecordedSkillPackage,
  launchPlaywrightRecordedSkillDriver,
  launchPlaywrightRecordedSkillRecorder,
  replayRecordedSkill,
  resolveRecordedSkillInstallTarget,
  reviewRecordedSkillDraft,
  stageRecordedSkillPackageRevocation,
} from "../../src/lib/record-replay/index.js";

const FIXTURE = `<!doctype html>
<html lang="en">
  <body>
    <button data-testid="open" onclick="document.querySelector('h1').textContent='ready'">Open</button>
    <input id="password" type="password">
    <select name="choice">
      <option value="one">One</option>
      <option value="two">Two</option>
    </select>
    <h1>idle</h1>
  </body>
</html>`;

const roots = [];
// Generic CLI jobs do not install Chromium; the dedicated UI workflow opts in.
const bt = process.env.CC_RECORD_REPLAY_BROWSER_E2E === "1" ? it : it.skip;

function temporaryRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("Record & Replay product lifecycle", () => {
  bt("captures real DOM events, validates replay, installs, revokes, exports, and imports", async () => {
    const recorder = await launchPlaywrightRecordedSkillRecorder({
      html: FIXTURE,
      headless: true,
    });
    let draft;
    try {
      await recorder.runAutomation([
        { kind: "click", target: "[data-testid='open']" },
        { kind: "type", target: "#password", value: "private-passphrase" },
        { kind: "select", target: "select[name='choice']", value: "two" },
      ]);
      draft = await recorder.finish({
        name: "captured-login",
        description: "Captured local login fixture",
        observations: ["h1"],
        assertions: [{ target: "h1", value: "ready" }],
        failureConditions: ["the reviewed ready state is not reached"],
      });
    } finally {
      await recorder.close();
    }

    expect(draft.actions.map((action) => action.kind)).toEqual([
      "click",
      "type",
      "select",
      "observe",
      "assert",
    ]);
    expect(JSON.stringify(draft)).not.toContain("private-passphrase");
    expect(draft.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "password", sensitive: true }),
      ]),
    );

    const root = temporaryRoot("cc-record-product-");
    const store = new RecordedSkillStore({
      rootDir: join(root, "store"),
      secure: false,
    });
    let entry = store.create({
      draft,
      source: {
        adapter: "self-contained-html",
        targetDigest: recorder.targetDigest,
        browserVersion: recorder.browserVersion,
      },
      actor: "test-recorder",
    });
    const approved = reviewRecordedSkillDraft(entry.skill, {
      reviewerId: "test-reviewer",
      approvedCapabilities: entry.skill.capabilityManifest,
      acceptedFailureConditions: true,
    });
    entry = store.approve({
      name: entry.name,
      expectedRevision: entry.revision,
      skill: approved,
      actor: "test-reviewer",
    });

    const driver = await launchPlaywrightRecordedSkillDriver({
      html: FIXTURE,
      settleMs: 0,
    });
    let report;
    try {
      report = await replayRecordedSkill(entry.skill, {
        inputs: { password: "runtime-secret", choice: "two" },
        environment: entry.skill.environment.requirements,
        executor: driver.executor,
      });
      entry = store.recordReplay({
        name: entry.name,
        expectedRevision: entry.revision,
        report,
        targetDigest: driver.targetDigest,
        browserVersion: driver.browserVersion,
        durationMs: 1,
        actor: "test-replay",
      });
    } finally {
      await driver.close();
    }
    expect(entry.state).toBe("validated");
    expect(JSON.stringify(report)).not.toContain("runtime-secret");

    const projectRoot = join(root, "project");
    mkdirSync(join(projectRoot, ".chainlesschain"), { recursive: true });
    const installed = installRecordedSkillPackage(entry, {
      scope: "project",
      projectRoot,
    });
    entry = store.enable({
      name: entry.name,
      expectedRevision: entry.revision,
      scope: "project",
      packageDigest: installed.packageDigest,
      actor: "test-enable",
    });
    expect(
      inspectRecordedSkillPackage({
        name: entry.name,
        scope: "project",
        projectRoot,
      }),
    ).toMatchObject({ packageDigest: installed.packageDigest });

    const staged = stageRecordedSkillPackageRevocation({
      name: entry.name,
      scope: "project",
      expectedPackageDigest: installed.packageDigest,
      projectRoot,
    });
    entry = store.revoke({
      name: entry.name,
      expectedRevision: entry.revision,
      actor: "test-revoke",
    });
    staged.commit();
    expect(entry.state).toBe("revoked");
    expect(
      inspectRecordedSkillPackage({
        name: entry.name,
        scope: "project",
        projectRoot,
      }),
    ).toBeNull();

    const exported = store.export(entry.name, { actor: "test-export" });
    const importedStore = new RecordedSkillStore({
      rootDir: join(root, "imported-store"),
      secure: false,
    });
    const imported = importedStore.import(exported, { actor: "test-import" });
    expect(imported).toMatchObject({
      name: entry.name,
      state: "validated",
      revision: 1,
    });
    const tampered = JSON.parse(JSON.stringify(exported));
    tampered.entry.skill.actions[0].target = "#tampered";
    expect(() =>
      new RecordedSkillStore({
        rootDir: join(root, "tampered-store"),
        secure: false,
      }).import(tampered),
    ).toThrowError(
      expect.objectContaining({ code: "CC_REPLAY_DRAFT_INTEGRITY" }),
    );

    expect(
      store.audit({ name: entry.name }).map((event) => event.action),
    ).toEqual([
      "created",
      "approved",
      "replayed",
      "enabled",
      "revoked",
      "exported",
    ]);
  }, 30_000);

  bt("enforces revision CAS across concurrent reviewers", async () => {
    const root = temporaryRoot("cc-record-cas-");
    const store = new RecordedSkillStore({
      rootDir: join(root, "store"),
      secure: false,
    });
    const draft = await (async () => {
      const recorder = await launchPlaywrightRecordedSkillRecorder({
        html: FIXTURE,
        headless: true,
      });
      try {
        await recorder.runAutomation([
          { kind: "click", target: "[data-testid='open']" },
        ]);
        return await recorder.finish({
          name: "cas-flow",
          failureConditions: ["the click does not complete"],
        });
      } finally {
        await recorder.close();
      }
    })();
    const entry = store.create({
      draft,
      source: {
        adapter: "self-contained-html",
        targetDigest: draft.environment.requirements.targetDigest,
        browserVersion: "test",
      },
    });
    const approved = reviewRecordedSkillDraft(entry.skill, {
      reviewerId: "reviewer",
      approvedCapabilities: entry.skill.capabilityManifest,
      acceptedFailureConditions: true,
    });
    store.approve({
      name: entry.name,
      expectedRevision: entry.revision,
      skill: approved,
      actor: "reviewer",
    });
    expect(() =>
      store.approve({
        name: entry.name,
        expectedRevision: entry.revision,
        skill: approved,
        actor: "stale-reviewer",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_REVISION_CONFLICT" }),
    );
  }, 30_000);

  bt("records and replays a credential-bound URL while denying network escape", async () => {
    const cookieValue = "session-value-that-must-not-persist";
    const server = createServer((request, response) => {
      if (
        !String(request.headers.cookie || "").includes(`session=${cookieValue}`)
      ) {
        response.writeHead(401, { "content-type": "text/html" });
        response.end("<!doctype html><title>unauthorized</title>");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html><body>
        <button id="safe" onclick="document.querySelector('h1').textContent='ready'">Safe</button>
        <button id="escape" onclick="fetch('https://outside.invalid/escape').catch(() => {})">Escape</button>
        <input id="password" type="password">
        <select id="choice"><option value="one">One</option><option value="two">Two</option></select>
        <h1>idle</h1>
      </body></html>`);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const storageState = {
      cookies: [
        {
          name: "session",
          value: cookieValue,
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    };

    try {
      const recorder = await launchPlaywrightRecordedSkillRecorder({
        url: `${origin}/workflow`,
        allowedOrigins: [origin],
        identity: "integration.account",
        storageState,
        headless: true,
      });
      let draft;
      try {
        await recorder.runAutomation([
          { kind: "click", target: "#safe" },
          { kind: "type", target: "#password", value: "captured-password" },
          { kind: "select", target: "#choice", value: "two" },
        ]);
        draft = await recorder.finish({
          name: "url-workflow",
          observations: ["h1"],
          assertions: [{ target: "h1", value: "ready" }],
          sensitiveParameters: ["choice"],
          failureConditions: ["the target account does not reach ready state"],
        });
      } finally {
        await recorder.close();
      }

      expect(draft.environment.requirements).toMatchObject({
        adapter: "url-origin",
        identity: "integration.account",
        networkPolicy: { mode: "allowlist", allowedOrigins: [origin] },
      });
      expect(JSON.stringify(draft)).not.toContain(cookieValue);
      expect(JSON.stringify(draft)).not.toContain("captured-password");
      expect(draft.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "choice", sensitive: true }),
        ]),
      );

      const root = temporaryRoot("cc-record-url-");
      const store = new RecordedSkillStore({
        rootDir: join(root, "store"),
        secure: false,
      });
      let entry = store.create({
        draft,
        source: {
          adapter: recorder.adapter,
          targetDigest: recorder.targetDigest,
          browserVersion: recorder.browserVersion,
        },
        actor: "url-recorder",
      });
      entry = store.approve({
        name: entry.name,
        expectedRevision: entry.revision,
        skill: reviewRecordedSkillDraft(entry.skill, {
          reviewerId: "url-reviewer",
          approvedCapabilities: entry.skill.capabilityManifest,
          acceptedFailureConditions: true,
        }),
        actor: "url-reviewer",
      });

      const driver = await launchPlaywrightRecordedSkillDriver({
        url: `${origin}/workflow`,
        allowedOrigins: [origin],
        identity: "integration.account",
        storageState,
        settleMs: 25,
      });
      try {
        expect(
          assertRecordedSkillBrowserBinding(driver, {
            source: entry.source,
            environment: entry.skill.environment.requirements,
          }),
        ).toBe(true);
        const isolation = {
          sandboxed: true,
          network: "allowlist",
          allowedOrigins: [origin],
        };
        const report = await replayRecordedSkill(entry.skill, {
          inputs: { password: "runtime-password", choice: "two" },
          environment: entry.skill.environment.requirements,
          isolation,
          executor: driver.executor,
        });
        entry = store.recordReplay({
          name: entry.name,
          expectedRevision: entry.revision,
          report,
          targetDigest: driver.targetDigest,
          browserVersion: driver.browserVersion,
          durationMs: 1,
          actor: "url-replay",
        });
        expect(entry.state).toBe("validated");
        expect(JSON.stringify(report)).not.toContain(cookieValue);
        expect(JSON.stringify(report)).not.toContain("runtime-password");
        expect(
          readFileSync(join(root, "store", "state.json"), "utf8"),
        ).not.toContain(cookieValue);

        await expect(
          driver.executor.execute(
            { kind: "click", target: "#escape" },
            { isolation, capability: "ui.interact" },
          ),
        ).rejects.toMatchObject({ code: "CC_REPLAY_UI_NETWORK_ATTEMPT" });
      } finally {
        await driver.close();
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 30_000);

  it("rejects a generated Skill path that crosses a symbolic-link ancestor", () => {
    const root = temporaryRoot("cc-record-package-link-");
    const projectRoot = join(root, "project");
    const redirected = join(root, "redirected-chainlesschain");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(redirected, { recursive: true });
    symlinkSync(redirected, join(projectRoot, ".chainlesschain"), "junction");

    expect(() =>
      resolveRecordedSkillInstallTarget({
        name: "linked-flow",
        scope: "project",
        projectRoot,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_PACKAGE_PATH_UNSAFE" }),
    );
  });
});
