"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { app } = require("electron");
const profile = process.env.CC_GOAL_ELECTRON_PROBE_PROFILE;
const resultFile = process.env.CC_GOAL_ELECTRON_PROBE_RESULT;
app.setPath("userData", profile);
fs.mkdirSync(path.join(profile, "logs"), { recursive: true });
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let wrapper, controller;
  try {
    const {
      SQLCipherWrapper,
    } = require("../../../database/sqlcipher-wrapper.js");
    const {
      createProjectGoalMonitoringController,
    } = require("../../project-goal-monitoring-host.js");
    const {
      currentProjectGoalDatabase,
    } = require("../../project-goal-native-database.js");
    const {
      PersonalProjectGoalService,
    } = require("@chainlesschain/session-core/project-goal-service");
    const file = path.join(profile, "encrypted-project.sqlite");
    wrapper = new SQLCipherWrapper(file, {
      key: randomBytes(32).toString("hex"),
    });
    wrapper.open();
    const native = wrapper.db;
    native.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    const actor = "did:chainless:encrypted-electron-probe";
    native
      .prepare("INSERT INTO projects VALUES (?,?,?,?,0)")
      .run("p1", actor, "active", Date.now());
    assert.throws(
      () =>
        new PersonalProjectGoalService({ db: wrapper, getActor: () => actor }),
      /GOAL_NATIVE_DATABASE_REQUIRED/,
    );
    assert.equal(
      currentProjectGoalDatabase({ getDatabase: () => wrapper }),
      native,
    );
    controller = createProjectGoalMonitoringController({
      featurePolicy:
        require("../../project-goal-feature-policy.js").createProjectGoalFeaturePolicy(
          { enabled: true },
        ),
      database: { getDatabase: () => wrapper },
      getCurrentUserDid: () => actor,
      graphMode: () => "canonical",
      autoStart: false,
    });
    const engine = await controller.initialize();
    assert.equal(engine.state.db, native);
    const goal = engine.state.goals.create({
      projectId: "p1",
      objective: "Verify encrypted native Graph composition",
      budgetPolicy: { maxRuns: 5 },
    });
    const first = await engine.checkNow({
      id: goal.id,
      expectedRevision: 1,
      requestId: "encrypted-native-check",
    });
    assert.equal(first.status, "succeeded");
    const repeated = await engine.checkNow({
      id: goal.id,
      expectedRevision: 1,
      requestId: "encrypted-native-check",
    });
    assert.equal(repeated.occurrenceId, first.occurrenceId);
    assert.equal(
      engine.state.goals.get({ id: goal.id }).schema,
      "chainlesschain.goal/v2",
    );
    assert.equal(
      native
        .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_graph_occurrences")
        .get().n,
      1,
    );
    const graph = engine.graphAuthority.authority.eventStore.rolloutStore.db;
    const files = {
      project: file,
      scheduler: engine.store.file,
      graph: graph.name,
    };
    assert.equal(new Set(Object.values(files)).size, 3);
    await controller.close();
    wrapper.close();
    assert.notEqual(
      fs.readFileSync(file).subarray(0, 16).toString("ascii"),
      "SQLite format 3\0",
    );
    let noKey;
    try {
      noKey = new native.constructor(file, { readonly: true });
      assert.throws(() =>
        noKey.prepare("SELECT count(*) FROM sqlite_master").get(),
      );
    } finally {
      noKey?.close();
    }
    assert.throws(
      () => currentProjectGoalDatabase(wrapper),
      /GOAL_NATIVE_DATABASE_REQUIRED/,
    );
    assert.equal(wrapper.db, null);
    wrapper.open();
    assert.notEqual(wrapper.db, native);
    assert.equal(
      wrapper.db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
      1,
    );
    fs.writeFileSync(
      resultFile,
      JSON.stringify(
        {
          schema: "chainlesschain.encrypted-goal-electron-probe/v1",
          passed: true,
          platform: process.platform,
          versions: process.versions,
          databasePackage:
            require("better-sqlite3-multiple-ciphers/package.json").version,
          checks: {
            originalWrapperRejectedByNativeContract: true,
            actualEncryptedProject: true,
            noKeyReadRejected: true,
            canonicalGraphResult: true,
            repeatedRequestRetainsOccurrence: true,
            separateStorageDomains: true,
            participatingGoalV2: true,
            closedWrapperNotReopenedByResolver: true,
            explicitReopenRetainsGoal: true,
            nativeWindowsAclGuardsUsed: process.platform === "win32",
          },
          files,
          boundaries: [
            "real Electron main process and actual encrypted native SQLite",
            "trusted synthetic identity and project",
            "no real product login, renderer journey or native confirmation interaction",
          ],
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await controller?.close();
    wrapper?.close();
    app.exit(process.exitCode || 0);
  }
});
