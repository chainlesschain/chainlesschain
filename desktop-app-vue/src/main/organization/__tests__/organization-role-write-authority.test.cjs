"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const Module = require("node:module");
const DatabaseSync =
  process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
    ? require("better-sqlite3")
    : require("node:sqlite").DatabaseSync;
const {
  executeOrganizationRoleWrite,
} = require("../organization-role-write-authority");

function fixture() {
  const native = new DatabaseSync(":memory:");
  if (process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3")
    Object.defineProperty(native, "isTransaction", {
      get: () => native.inTransaction,
    });
  const schema = readFileSync(
    path.resolve(__dirname, "../../database/database-schema.js"),
    "utf8",
  );
  native.exec(
    schema.slice(
      schema.indexOf("      -- 组织元数据表"),
      schema.indexOf("      -- 权限审计日志表"),
    ),
  );
  native.exec(`
    INSERT INTO organization_info(org_id,org_did,name,owner_did,created_at,updated_at) VALUES ('org','did:org','Org','did:owner',1,1),('other','did:other-org','Other','did:other',1,1);
    INSERT INTO organization_roles(id,org_id,name,permissions,is_builtin,created_at) VALUES
      ('owner-role','org','owner','["*"]',1,1),
      ('admin-role','org','admin','["role.create","role.manage","role.delete","member.manage","member.invite","project.read"]',1,1),
      ('member-role','org','member','["project.read","project.write"]',1,1),
      ('viewer-role','org','viewer','["project.read"]',1,1),
      ('custom-role','org','custom','["project.read"]',0,1),
      ('foreign-role','other','custom','["project.read"]',0,1);
    INSERT INTO organization_members(id,org_id,member_did,role,status,joined_at) VALUES
      ('owner','org','did:owner','owner','active',1),
      ('admin','org','did:admin','admin','active',1),
      ('member','org','did:member','member','active',1),
      ('viewer','org','did:viewer','viewer','active',1),
      ('former','org','did:former','owner','removed',1);
  `);
  const state = {
    actor: "did:owner",
    generation: 1,
    trusted: true,
    beforeRun: null,
  };
  const db = {
    exec: (sql) => native.exec(sql),
    prepare(sql) {
      const stmt = native.prepare(sql);
      return {
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
        run: (...args) => {
          state.beforeRun?.(sql);
          return stmt.run(...args);
        },
      };
    },
  };
  const wrapper = {
    current: db,
    getDatabase() {
      return this.current;
    },
  };
  const event = { senderFrame: { url: "file:///app/index.html" } };
  const dependencies = {
    getActor: () => state.actor,
    getGeneration: () => state.generation,
    validateSender: () => ({ trusted: state.trusted }),
  };
  const write = (action, p) =>
    executeOrganizationRoleWrite(wrapper, event, action, p, dependencies);
  const snapshot = () =>
    [
      "organization_roles",
      "organization_members",
      "organization_activities",
      "organization_invitations",
    ].map((table) =>
      native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  return {
    native,
    state,
    wrapper,
    event,
    dependencies,
    write,
    snapshot,
    close: () => native.close(),
  };
}

function withModules(f, callback) {
  const handlers = new Map();
  const originalLoad = Module._load;
  const ipc = {
    handle: (name, handler) => handlers.set(name, handler),
    removeHandler: (name) => handlers.delete(name),
  };
  const paths = [
    "../organization-ipc",
    "../permission-ipc",
    "../../permission/permission-ipc",
    "../organization-manager-p2pSync",
    "../../sync/p2p-sync-engine",
  ].map((p) => require.resolve(p));
  for (const file of paths) delete require.cache[file];
  Module._load = function (name, ...args) {
    if (name === "electron") return { ipcMain: ipc };
    if (name === "../utils/logger.js")
      return { logger: { info() {}, warn() {}, error() {}, debug() {} } };
    if (name === "uuid") return { v4: randomUUID };
    if (
      name === "../task/project-goal-auth-session" ||
      name === "./project-goal-auth-session"
    )
      return {
        getProjectGoalActor: f.dependencies.getActor,
        getProjectGoalAuthGeneration: f.dependencies.getGeneration,
      };
    if (name === "../ipc/ipc-sender-guard")
      return { validateSender: f.dependencies.validateSender };
    if (name === "./org-p2p-network") return { OrgP2PNetwork: class {} };
    if (name === "../did/did-signer.js")
      return {
        signPayloadWithIdentity() {
          throw new Error("UNEXPECTED_CRYPTO");
        },
        verifyPayloadAgainstDid() {
          throw new Error("UNEXPECTED_CRYPTO");
        },
      };
    return originalLoad.call(this, name, ...args);
  };
  const restore = () => {
    Module._load = originalLoad;
    for (const file of paths) delete require.cache[file];
  };
  try {
    const result = callback(handlers, ipc);
    if (result?.then) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

const cases = [
  [
    "create",
    {
      orgId: "org",
      roleData: { name: "editor", permissions: ["board.task.*"] },
    },
  ],
  ["update", { roleId: "custom-role", updates: { permissions: ["board.*"] } }],
  ["delete", { roleId: "custom-role" }],
  ["assign", { orgId: "org", memberDID: "did:viewer", newRole: "member" }],
  [
    "invite",
    { orgId: "org", inviteData: { role: "member", invitedBy: "did:forged" } },
  ],
];

test("role writes reject missing, removed, outsider, member and untrusted sessions with zero changes", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    for (const actor of [
      null,
      "did:former",
      "did:outsider",
      "did:member",
      "did:owner",
    ]) {
      f.state.actor = actor;
      f.state.trusted = actor !== "did:owner";
      for (const [action, p] of cases)
        assert.throws(() => f.write(action, p), /ORG_ROLE_WRITE_DENIED/);
    }
    assert.deepEqual(f.snapshot(), before);
  } finally {
    f.close();
  }
});

for (const [action, p] of cases)
  test(`owner ${action} uses production SQLite schema and audited synchronous transaction`, () => {
    const f = fixture();
    try {
      assert.ok(f.write(action, p));
      const audit = f.native
        .prepare("SELECT * FROM organization_activities")
        .get();
      assert.equal(audit.actor_did, "did:owner");
      assert.equal(f.native.isTransaction, false);
    } finally {
      f.close();
    }
  });

test("owner can explicitly grant and revoke builtin board permissions without changing existing permissions", () => {
  const f = fixture();
  try {
    const result = f.write("update", {
      roleId: "member-role",
      updates: { boardPermissions: ["board.task.*", "board.comment.create"] },
    });
    assert.deepEqual(result.permissions, [
      "project.read",
      "project.write",
      "board.task.*",
      "board.comment.create",
    ]);
    assert.deepEqual(
      f.write("update", {
        roleId: "member-role",
        updates: { boardPermissions: [] },
      }).permissions,
      ["project.read", "project.write"],
    );
    f.state.actor = "did:admin";
    assert.throws(
      () =>
        f.write("update", {
          roleId: "member-role",
          updates: { boardPermissions: ["board.*"] },
        }),
      /ORG_ROLE_BUILTIN_PROTECTED/,
    );
  } finally {
    f.close();
  }
});

test("builtin permissions, names, owner role and foreign role are protected", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    for (const [action, p] of [
      ["update", { roleId: "member-role", updates: { permissions: ["*"] } }],
      [
        "update",
        {
          roleId: "member-role",
          updates: { boardPermissions: ["*", "role.manage"] },
        },
      ],
      [
        "update",
        {
          roleId: "member-role",
          updates: { name: "owner", boardPermissions: [] },
        },
      ],
      ["update", { roleId: "custom-role", updates: { name: "owner" } }],
      ["update", { roleId: "foreign-role", updates: { permissions: ["*"] } }],
      ["delete", { roleId: "member-role" }],
      ["assign", { orgId: "org", memberDID: "did:owner", newRole: "member" }],
      ["assign", { orgId: "org", memberDID: "did:member", newRole: "owner" }],
      ["assign", { orgId: "org", memberDID: "did:former", newRole: "member" }],
    ])
      assert.throws(() => f.write(action, p), /ORG_ROLE_/);
    assert.deepEqual(f.snapshot(), before);
  } finally {
    f.close();
  }
});

test("delegated role managers cannot grant permissions they do not hold", () => {
  const f = fixture();
  try {
    f.state.actor = "did:admin";
    assert.equal(
      f.write("update", {
        roleId: "custom-role",
        updates: { permissions: ["project.read"] },
      }).name,
      "custom",
    );
    for (const [action, p] of cases.slice(0, 2))
      assert.throws(() => f.write(action, p), /ORG_ROLE_WRITE_DENIED/);
    assert.throws(
      () =>
        f.write("assign", {
          orgId: "org",
          memberDID: "did:member",
          newRole: "owner",
        }),
      /ORG_ROLE_OWNER_PROTECTED/,
    );
  } finally {
    f.close();
  }
});

test("production membership CHECK rejects unsupported custom role assignment without audit or partial mutation", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    assert.throws(
      () =>
        f.write("assign", {
          orgId: "org",
          memberDID: "did:member",
          newRole: "custom",
        }),
      /CHECK constraint failed/,
    );
    assert.deepEqual(f.snapshot(), before);
  } finally {
    f.close();
  }
});

test("owner's explicit board grant enables a real member write and revocation immediately blocks it", () => {
  const f = fixture();
  try {
    withModules(f, () => {
      const schema = readFileSync(
        path.resolve(__dirname, "../../database/database-schema.js"),
        "utf8",
      );
      f.native.exec(
        schema.slice(
          schema.indexOf("      -- 任务看板表"),
          schema.indexOf("      -- 任务管理模块索引"),
        ),
      );
      f.native.exec(`
        INSERT INTO task_boards(id,org_id,name,owner_did,created_at,updated_at) VALUES ('board','org','Board','did:owner',1,1);
        INSERT INTO task_board_columns(id,board_id,name,position,created_at,updated_at) VALUES ('column','board','Todo',0,1,1);
        INSERT INTO team_tasks(id,board_id,column_id,title,reporter_did,created_at,updated_at) VALUES ('task','board','column','Task','did:owner',1,1);
      `);
      const { executeBoardWrite } = require("../../task/board-write-authority");
      const archiveBoard = () =>
        executeBoardWrite(
          f.wrapper,
          f.event,
          "archive-board",
          { boardId: "board" },
          f.dependencies,
        );
      f.state.actor = "did:member";
      assert.throws(archiveBoard, /BOARD_WRITE_NOT_FOUND_OR_DENIED/);
      f.state.actor = "did:owner";
      f.write("update", {
        roleId: "member-role",
        updates: { boardPermissions: ["board.archive"] },
      });
      f.state.actor = "did:member";
      assert.equal(archiveBoard().success, true);
      assert.equal(
        f.native
          .prepare("SELECT is_archived FROM task_boards WHERE id='board'")
          .get().is_archived,
        1,
      );
      f.state.actor = "did:owner";
      f.write("update", {
        roleId: "member-role",
        updates: { boardPermissions: [] },
      });
      f.state.actor = "did:member";
      assert.throws(archiveBoard, /BOARD_WRITE_NOT_FOUND_OR_DENIED/);
    });
  } finally {
    f.close();
  }
});

test("audit failure and authority loss roll back role, membership and audit changes", () => {
  for (const change of [
    (f) => {
      f.state.generation++;
    },
    (f) => {
      f.state.actor = "did:admin";
    },
    (f) => {
      f.state.trusted = false;
    },
    (f) => {
      f.event.senderFrame.url = "file:///changed.html";
    },
    (f) => {
      f.wrapper.current = {};
    },
    (f) => {
      f.native.exec(
        "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
      );
    },
    (f) => {
      f.native.exec(
        "UPDATE organization_roles SET permissions='[]' WHERE id='owner-role'",
      );
    },
    () => {
      throw new Error("AUDIT_FAILURE");
    },
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      f.state.beforeRun = (sql) => {
        if (sql.startsWith("INSERT INTO organization_activities")) change(f);
      };
      assert.throws(
        () =>
          f.write("update", {
            roleId: "member-role",
            updates: { boardPermissions: ["board.*"] },
          }),
        /ORG_ROLE_WRITE_DENIED|AUDIT_FAILURE/,
      );
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.native.isTransaction, false);
    } finally {
      f.close();
    }
  }
});

test("all four organization IPCs ignore forged renderer owner DIDs and avoid legacy async managers", async () => {
  const f = fixture();
  try {
    await withModules(f, async (handlers, ipc) => {
      const manager = new Proxy(
        { db: f.wrapper },
        {
          get(target, key) {
            return key === "db"
              ? target.db
              : () => {
                  throw new Error("LEGACY_MANAGER_CALLED");
                };
          },
        },
      );
      require("../organization-ipc").registerOrganizationIPC({
        organizationManager: manager,
        dbManager: f.wrapper,
        ipcMain: ipc,
      });
      const inputs = [
        [
          "org:create-custom-role",
          "org",
          { name: "editor", permissions: ["board.*"] },
          "did:owner",
        ],
        [
          "org:update-role",
          "custom-role",
          { permissions: ["board.*"] },
          "did:owner",
        ],
        ["org:delete-role", "custom-role", "did:owner"],
        ["org:update-member-role", "org", "did:viewer", "member"],
      ];
      f.state.actor = "did:viewer";
      const before = f.snapshot();
      for (const [channel, ...args] of inputs)
        await assert.rejects(
          handlers.get(channel)(f.event, ...args),
          /ORG_ROLE_WRITE_DENIED/,
        );
      assert.deepEqual(f.snapshot(), before);
      f.state.actor = "did:owner";
      const updated = await handlers.get("org:update-role")(
        f.event,
        "member-role",
        { boardPermissions: ["board.task.*"] },
        "did:forged",
      );
      assert.ok(updated.permissions.includes("board.task.*"));
      assert.equal(
        f.native.prepare("SELECT actor_did FROM organization_activities").get()
          .actor_did,
        "did:owner",
      );
    });
  } finally {
    f.close();
  }
});

test("both legacy permission template registrations refuse role mutation before manager access", async () => {
  const f = fixture();
  try {
    await withModules(f, async (handlers) => {
      const unavailable = new Proxy(
        {},
        {
          get() {
            throw new Error("LEGACY_MANAGER_CALLED");
          },
        },
      );
      new (require("../permission-ipc"))(f.wrapper, unavailable, unavailable);
      const before = f.snapshot();
      assert.deepEqual(
        await handlers.get("permission:apply-template")(f.event, {
          targetType: "role",
          orgId: "org",
          userDID: "did:owner",
        }),
        { success: false, error: "ORG_ROLE_CONTROLLED_WRITE_REQUIRED" },
      );
      handlers.clear();
      require("../../permission/permission-ipc").registerPermissionIPC(
        f.wrapper,
      );
      assert.deepEqual(
        await handlers.get("permission:apply-template")(f.event, {
          targetType: "role",
          orgId: "org",
          userDID: "did:owner",
        }),
        { success: false, error: "ORG_ROLE_CONTROLLED_WRITE_REQUIRED" },
      );
      assert.deepEqual(f.snapshot(), before);
    });
  } finally {
    f.close();
  }
});

test("unverified legacy sync and generic resource sync cannot mutate role authority", async () => {
  const f = fixture();
  try {
    await withModules(f, async () => {
      const mixin = require("../organization-manager-p2pSync");
      const P2PSyncEngine = require("../../sync/p2p-sync-engine");
      const forbiddenDb = {
        run() {
          throw new Error("UNAUTHORIZED_SQL");
        },
        prepare() {
          throw new Error("UNAUTHORIZED_SQL");
        },
      };
      for (const action of [
        "update_member_role",
        "add_member",
        "remove_member",
      ])
        await assert.rejects(
          mixin.applyChange.call({ db: forbiddenDb }, "org", {
            action,
            resource_id: "did:viewer",
            metadata: { new_role: "owner" },
          }),
          /ORG_ROLE_CONTROLLED_WRITE_REQUIRED/,
        );
      for (const kind of ["role", "member"])
        for (const action of ["create", "update", "delete"])
          await assert.rejects(
            P2PSyncEngine.prototype.applyResourceChange.call(
              { db: forbiddenDb },
              kind,
              "member-role",
              action,
              { permissions: '["*"]' },
            ),
            /ORG_ROLE_CONTROLLED_WRITE_REQUIRED/,
          );
      let writes = 0;
      await P2PSyncEngine.prototype.applyResourceChange.call(
        {
          db: {
            run() {
              writes++;
            },
          },
        },
        "knowledge",
        "knowledge-1",
        "delete",
        {},
      );
      assert.equal(writes, 1);
    });
  } finally {
    f.close();
  }
});

test("invitation IPC derives its creator, rejects excess grants and disables unguarded DID/link creation", async () => {
  const f = fixture();
  try {
    await withModules(f, async (handlers, ipc) => {
      const unavailable = () => {
        throw new Error("LEGACY_MANAGER_CALLED");
      };
      require("../organization-ipc").registerOrganizationIPC({
        organizationManager: {
          db: f.wrapper,
          createInvitation: unavailable,
          inviteByDID: unavailable,
          didInvitationManager: { createInvitationLink: unavailable },
        },
        dbManager: f.wrapper,
        ipcMain: ipc,
      });
      f.state.actor = "did:viewer";
      await assert.rejects(
        handlers.get("org:create-invitation")(f.event, "org", {
          invitedBy: "did:owner",
          role: "admin",
        }),
        /ORG_ROLE_WRITE_DENIED/,
      );
      f.state.actor = "did:owner";
      const invite = await handlers.get("org:create-invitation")(
        f.event,
        "org",
        { invitedBy: "did:forged", role: "member" },
      );
      assert.equal(invite.invited_by, "did:owner");
      assert.equal(
        f.native
          .prepare("SELECT invited_by FROM organization_invitations WHERE id=?")
          .get(invite.id).invited_by,
        "did:owner",
      );
      await assert.rejects(
        handlers.get("org:create-invitation")(f.event, "org", {
          role: "owner",
        }),
        /ORG_ROLE_OWNER_PROTECTED/,
      );
      f.state.actor = "did:admin";
      await assert.rejects(
        handlers.get("org:create-invitation")(f.event, "org", {
          role: "member",
        }),
        /ORG_ROLE_WRITE_DENIED/,
      );
      for (const [channel, ...args] of [
        ["org:invite-by-did", "org", { role: "admin" }],
        ["org:create-invitation-link", { orgId: "org", role: "admin" }],
      ])
        await assert.rejects(
          handlers.get(channel)(f.event, ...args),
          /ORG_ROLE_CONTROLLED_WRITE_REQUIRED/,
        );
    });
  } finally {
    f.close();
  }
});

test("membership ingestion refuses forged owner roles and historical impostor owners cannot manage roles", async () => {
  const f = fixture();
  try {
    await withModules(f, async () => {
      const members = require("../organization-manager-members");
      await assert.rejects(
        members.addMember.call({ db: f.native }, "org", {
          memberDID: "did:outsider",
          role: "owner",
        }),
        /ORG_ROLE_OWNER_PROTECTED/,
      );
      f.native.exec(
        "UPDATE organization_members SET role='owner' WHERE member_did='did:viewer'",
      );
      f.state.actor = "did:viewer";
      for (const [action, p] of cases)
        assert.throws(() => f.write(action, p), /ORG_ROLE_WRITE_DENIED/);
    });
  } finally {
    f.close();
  }
});
