"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  fixture,
  withHost,
  snapshot,
} = require("./board-authority-fixture.cjs");
const { LIMITS, PREFIX, digest } = require("../board-attachment-store");
const { readSelectedFile } = require("../board-attachment-host");

function setup() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-board-attachments-"),
  );
  const f = fixture(path.join(directory, "vault.sqlite"));
  const selected = path.join(directory, "sample.txt");
  fs.writeFileSync(selected, "<script>alert('text only')</script>\nhello");
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  f.electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showOpenDialog: async (w, options) => {
        assert.equal(w, window);
        assert.deepEqual(options.properties, ["openFile"]);
        return { canceled: false, filePaths: [selected] };
      },
    },
  };
  const close = f.close;
  return Object.assign(f, {
    directory,
    selected,
    window,
    cleanup() {
      close();
      // This test owns the unique named directory; remove its files only.
      for (const name of fs.readdirSync(directory))
        fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    },
  });
}
const call = (f, h, name, params) => h.get(`task:${name}`)(f.event, params);
async function upload(f, h) {
  return call(f, h, "upload-attachment", { taskId: "task-1" });
}
function counts(f) {
  return [
    "task_attachments",
    "task_board_attachment_payloads",
    "task_activity_log",
  ].map(
    (table) => f.native.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
  );
}

test("native picker to actual IPC stores bytes/metadata/activity atomically; authorized preview and delete survive reopen", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      const result = await upload(f, h);
      assert.equal(result.success, true);
      assert.deepEqual(counts(f), [2, 1, 1]);
      const raw = f.native
        .prepare("SELECT * FROM task_attachments WHERE id=?")
        .get(result.attachmentId);
      assert.equal(raw.file_path, PREFIX + result.attachmentId);
      assert.equal(raw.uploader_did, "did:owner");
      const payload = f.native
        .prepare("SELECT content,sha256 FROM task_board_attachment_payloads")
        .get();
      assert.equal(
        Buffer.from(payload.content).toString(),
        fs.readFileSync(f.selected, "utf8"),
      );
      assert.equal(payload.sha256, digest(payload.content));
      f.reopen();
      const list = await call(f, h, "get-attachments", { taskId: "task-1" });
      assert.equal(list.attachments.length, 1);
      assert.equal(list.attachments[0].fileName, "sample.txt");
      assert.ok(!JSON.stringify(list).includes(f.directory));
      assert.ok(!JSON.stringify(list).includes("file_path"));
      const preview = await call(f, h, "preview-attachment", {
        attachmentId: result.attachmentId,
      });
      assert.equal(preview.preview.kind, "text");
      assert.match(preview.preview.text, /<script>/);
      assert.equal(
        preview.preview.base64,
        Buffer.from(payload.content).toString("base64"),
      );
      assert.equal(
        (
          await call(f, h, "delete-attachment", {
            attachmentId: result.attachmentId,
          })
        ).success,
        true,
      );
      f.reopen();
      assert.deepEqual(counts(f), [1, 0, 2]);
      await assert.rejects(
        call(f, h, "preview-attachment", { attachmentId: result.attachmentId }),
      );
      assert.equal(fs.existsSync(f.selected), true);
      assert.ok(
        !JSON.stringify(
          f.native.prepare("SELECT metadata FROM task_activity_log").all(),
        ).includes("sample.txt"),
      );
    });
  } finally {
    f.cleanup();
  }
});

test("attachment permission and authenticated host are required before chooser, including forged renderer paths/actors", async () => {
  const f = setup();
  let picked = 0;
  const chooser = f.electron.dialog.showOpenDialog;
  f.electron.dialog.showOpenDialog = (...args) => {
    picked++;
    return chooser(...args);
  };
  try {
    await withHost(f, async (h) => {
      const before = snapshot(f);
      f.state.actor = "did:member";
      await assert.rejects(upload(f, h), /BOARD_WRITE_NOT_FOUND_OR_DENIED/);
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.attachment.upload"]' WHERE name='member'`,
      );
      for (const params of [
        { taskId: "task-1", filePath: f.selected },
        { taskId: "task-1", bytes: [1] },
        { taskId: "task-1", uploaderDid: "did:owner" },
      ])
        await assert.rejects(
          call(f, h, "upload-attachment", params),
          /BOARD_WRITE_INVALID_REQUEST/,
        );
      assert.equal(picked, 0);
      const result = await upload(f, h);
      assert.equal(
        f.native
          .prepare("SELECT uploader_did FROM task_attachments WHERE id=?")
          .get(result.attachmentId).uploader_did,
        "did:member",
      );
      await assert.rejects(
        call(f, h, "delete-attachment", { attachmentId: result.attachmentId }),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      assert.equal(picked, 1);
      assert.notDeepEqual(snapshot(f), before);
    });
  } finally {
    f.cleanup();
  }
});

test("cancel and malformed native selections produce zero database writes", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      const before = snapshot(f);
      for (const chosen of [
        { canceled: true, filePaths: [] },
        { canceled: false, filePaths: [] },
        { canceled: false, filePaths: [f.selected, f.selected] },
      ]) {
        f.electron.dialog.showOpenDialog = async () => chosen;
        if (chosen.canceled)
          assert.deepEqual(await upload(f, h), {
            success: false,
            cancelled: true,
          });
        else
          await assert.rejects(upload(f, h), /BOARD_ATTACHMENT_INVALID_FILE/);
        assert.deepEqual(snapshot(f), before);
      }
    });
  } finally {
    f.cleanup();
  }
});

test("chooser await rejects revoked permission/membership, identity ABA, window/frame/DB/path or frozen task scope changes", async () => {
  for (const change of [
    "permission",
    "member",
    "generation",
    "window",
    "frame",
    "db",
    "path",
    "scope",
    "canonical",
  ]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const before = counts(f);
        f.electron.dialog.showOpenDialog = async () => {
          if (change === "permission")
            f.native.exec(
              "UPDATE organization_roles SET permissions='[]' WHERE name='owner'",
            );
          if (change === "member")
            f.native.exec(
              "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
            );
          if (change === "generation") f.state.generation++;
          if (change === "window")
            f.electron.BrowserWindow.fromWebContents = () => null;
          if (change === "frame") f.event.senderFrame.url = "file:///elsewhere";
          if (change === "db") f.wrapper.current = {};
          if (change === "path") f.wrapper.dbPath = "changed";
          if (change === "scope")
            f.native.exec(
              "UPDATE team_tasks SET board_id='board-2',column_id='column-2' WHERE id='task-1'",
            );
          if (change === "canonical")
            f.native.exec("INSERT INTO project_tasks VALUES ('task-1')");
          return { canceled: false, filePaths: [f.selected] };
        };
        await assert.rejects(upload(f, h), /BOARD_/, change);
        assert.deepEqual(counts(f), before, change);
      });
    } finally {
      f.cleanup();
    }
  }
});

test("file validation refuses directories, oversize files, hardlinks, path aliases and missing files without leaking source paths", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      const large = path.join(f.directory, "large.bin");
      fs.writeFileSync(large, Buffer.alloc(0));
      fs.truncateSync(large, LIMITS.fileBytes + 1);
      const hard = path.join(f.directory, "linked.txt");
      fs.linkSync(f.selected, hard);
      for (const selected of [
        f.directory,
        large,
        hard,
        path.join(f.directory, "missing.txt"),
      ]) {
        f.electron.dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
        const before = snapshot(f);
        await assert.rejects(
          upload(f, h),
          (error) =>
            error.code.startsWith("BOARD_ATTACHMENT_") &&
            !error.message.includes(f.directory),
        );
        assert.deepEqual(snapshot(f), before);
      }
    });
  } finally {
    f.cleanup();
  }
});

test("bounded fd read rejects concurrent source change and authority loss while always closing the descriptor", async () => {
  const f = setup();
  try {
    let checks = 0;
    await assert.rejects(
      readSelectedFile(f.selected, () => {
        if (++checks === 5) fs.appendFileSync(f.selected, "changed");
      }),
      /BOARD_ATTACHMENT_FILE_CHANGED/,
    );
    checks = 0;
    await assert.rejects(
      readSelectedFile(f.selected, () => {
        if (++checks === 5)
          throw Object.assign(new Error("denied"), {
            code: "BOARD_WRITE_NOT_FOUND_OR_DENIED",
          });
      }),
      /denied/,
    );
    // A mandatory file rename/remove is possible after both failures on Windows.
    fs.renameSync(f.selected, path.join(f.directory, "closed.txt"));
  } finally {
    f.cleanup();
  }
});

test("all attachment write phases and SQL-triggered final revocation roll back metadata, bytes and activity", async () => {
  for (const stage of ["metadata", "payload", "activity", "revoke"]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const target =
          stage === "metadata"
            ? "task_attachments"
            : stage === "payload"
              ? "task_board_attachment_payloads"
              : "task_activity_log";
        f.native.exec(
          stage === "revoke"
            ? `CREATE TRIGGER fail_attachment AFTER INSERT ON task_activity_log BEGIN UPDATE organization_members SET status='removed' WHERE member_did='did:owner'; END;`
            : `CREATE TRIGGER fail_attachment BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'injected failure'); END;`,
        );
        const before = snapshot(f);
        await assert.rejects(upload(f, h));
        assert.deepEqual(snapshot(f), before, stage);
      });
    } finally {
      f.cleanup();
    }
  }
});

test("delete activity failure or revoked delete authority leaves metadata and bytes intact", async () => {
  for (const stage of ["activity", "revoke"]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const { attachmentId } = await upload(f, h);
        f.native.exec(
          stage === "activity"
            ? `CREATE TRIGGER fail_delete BEFORE INSERT ON task_activity_log BEGIN SELECT RAISE(ABORT,'injected'); END;`
            : `CREATE TRIGGER fail_delete AFTER INSERT ON task_activity_log BEGIN UPDATE organization_roles SET permissions='[]' WHERE name='owner'; END;`,
        );
        const before = snapshot(f);
        await assert.rejects(call(f, h, "delete-attachment", { attachmentId }));
        assert.deepEqual(snapshot(f), before, stage);
      });
    } finally {
      f.cleanup();
    }
  }
});

test("legacy files are not opened, migrated or deleted by the governed attachment path", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      f.native
        .prepare(
          "UPDATE task_attachments SET file_path=? WHERE id='attachment-1'",
        )
        .run(f.selected);
      assert.deepEqual(
        (await call(f, h, "get-attachments", { taskId: "task-1" })).attachments,
        [],
      );
      const before = snapshot(f);
      for (const channel of ["preview-attachment", "delete-attachment"])
        await assert.rejects(
          call(f, h, channel, { attachmentId: "attachment-1" }),
          /BOARD_ATTACHMENT_NOT_FOUND_OR_DENIED/,
        );
      assert.deepEqual(snapshot(f), before);
      assert.equal(fs.existsSync(f.selected), true);
    });
  } finally {
    f.cleanup();
  }
});

test("managed payload reads reject current membership loss, frozen scope tamper and damaged bytes", async () => {
  for (const mutation of [
    "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
    "UPDATE team_tasks SET board_id='board-2',column_id='column-2' WHERE id='task-1'",
    "UPDATE task_boards SET org_id='org-2' WHERE id='board-1'",
    "UPDATE task_board_attachment_payloads SET task_id='task-2'",
    "UPDATE task_board_attachment_payloads SET file_name='changed.txt'",
    "UPDATE task_attachments SET file_size=999 WHERE id<>'attachment-1'",
    "UPDATE task_board_attachment_payloads SET content=zeroblob(length(content))",
    "INSERT INTO project_tasks VALUES ('task-1')",
  ]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const { attachmentId } = await upload(f, h);
        f.native.exec(mutation);
        await assert.rejects(
          call(f, h, "preview-attachment", { attachmentId }),
          undefined,
          mutation,
        );
      });
    } finally {
      f.cleanup();
    }
  }
});

test("binary, HTML and invalid UTF-8 are download-only; strict bounded text is returned as data", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      for (const [name, bytes, kind] of [
        [
          "unsafe.html",
          Buffer.from("<img src=x onerror=alert(1)>"),
          "download",
        ],
        ["fake.txt", Buffer.from([255, 0, 255]), "download"],
        ["large.txt", Buffer.alloc(LIMITS.previewBytes + 1, 65), "download"],
        ["safe.txt", Buffer.from("<b>escaped by Vue</b>"), "text"],
        ["empty.bin", Buffer.alloc(0), "download"],
      ]) {
        const selected = path.join(f.directory, name);
        fs.writeFileSync(selected, bytes);
        f.electron.dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
        const { attachmentId } = await upload(f, h);
        const result = await call(f, h, "preview-attachment", { attachmentId });
        assert.equal(result.preview.kind, kind, name);
        assert.equal(result.attachment.mimeType, "application/octet-stream");
        assert.equal(result.preview.base64, bytes.toString("base64"));
      }
    });
  } finally {
    f.cleanup();
  }
});

test("task deletion cascades managed bytes while preserving the selected source file", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      await upload(f, h);
      await call(f, h, "delete-task", { taskId: "task-1" });
      f.reopen();
      assert.deepEqual(counts(f), [0, 0, 0]);
      assert.equal(fs.existsSync(f.selected), true);
    });
  } finally {
    f.cleanup();
  }
});

test("attachment count limits and actual-byte quotas are enforced inside the final transaction", async () => {
  for (const mode of ["taskCount", "vaultCount", "taskBytes", "vaultBytes"]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const { attachmentId } = await upload(f, h);
        const original = f.native
          .prepare("SELECT * FROM task_attachments WHERE id=?")
          .get(attachmentId);
        const n =
          mode === "taskCount"
            ? LIMITS.taskCount
            : mode === "vaultCount"
              ? LIMITS.vaultCount
              : mode === "taskBytes"
                ? 4
                : 25;
        f.native.exec("DELETE FROM task_attachments WHERE id<> 'attachment-1'");
        const transaction = f.db.transaction(() => {
          for (let i = 0; i < n; i++) {
            const id = `quota-${i}`,
              task = mode.startsWith("vault") ? "task-2" : "task-1",
              board = task === "task-2" ? "board-2" : "board-1";
            f.native
              .prepare(
                "INSERT INTO task_attachments (id,task_id,file_name,file_path,file_size,mime_type,uploader_did,created_at) VALUES (?,?,?,?,?,'application/octet-stream','did:owner',1)",
              )
              .run(id, task, "quota.bin", PREFIX + id, 0);
            f.native
              .prepare(
                "INSERT INTO task_board_attachment_payloads VALUES (?,?,?,?,?,?,zeroblob(?),?,1)",
              )
              .run(
                id,
                task,
                board,
                "org-1",
                "did:owner",
                "quota.bin",
                mode.endsWith("Bytes") ? LIMITS.fileBytes : 0,
                digest(Buffer.alloc(0)),
              );
          }
        });
        transaction.immediate();
        const before = counts(f);
        await assert.rejects(
          upload(f, h),
          /BOARD_ATTACHMENT_QUOTA_EXCEEDED/,
          mode,
        );
        assert.deepEqual(counts(f), before);
        assert.equal(original.uploader_did, "did:owner");
      });
    } finally {
      f.cleanup();
    }
  }
});

test("native-only storage, foreign key and outer transaction checks happen before picker and again after selection", async () => {
  const f = setup();
  let picked = 0;
  try {
    await withHost(f, async (h) => {
      const chooser = f.electron.dialog.showOpenDialog;
      f.electron.dialog.showOpenDialog = (...args) => {
        picked++;
        return chooser(...args);
      };
      f.native.exec("BEGIN");
      await assert.rejects(upload(f, h), /BOARD_ATTACHMENT_TRANSACTION_BUSY/);
      f.native.exec("ROLLBACK");
      f.native.exec("PRAGMA foreign_keys=OFF");
      await assert.rejects(
        upload(f, h),
        /BOARD_ATTACHMENT_STORAGE_UNAVAILABLE/,
      );
      f.native.exec("PRAGMA foreign_keys=ON");
      const volatile = fixture();
      f.wrapper.current = volatile.db;
      await assert.rejects(
        upload(f, h),
        /BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED/,
      );
      f.wrapper.current = f.db;
      volatile.close();
      f.native.exec("PRAGMA synchronous=OFF");
      await assert.rejects(
        upload(f, h),
        /BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED/,
      );
      f.native.exec("PRAGMA synchronous=FULL");
      assert.equal(picked, 0);
      f.electron.dialog.showOpenDialog = async () => {
        f.native.exec("BEGIN");
        return { canceled: false, filePaths: [f.selected] };
      };
      await assert.rejects(upload(f, h), /BOARD_ATTACHMENT_TRANSACTION_BUSY/);
      f.native.exec("ROLLBACK");
      assert.deepEqual(counts(f), [1, 0, 0]);
    });
  } finally {
    f.cleanup();
  }
});

test("only one native selection per vault is in flight and its lock is released after cancel", async () => {
  const f = setup();
  let release;
  try {
    await withHost(f, async (h) => {
      f.electron.dialog.showOpenDialog = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const first = upload(f, h);
      await assert.rejects(upload(f, h), /BOARD_ATTACHMENT_OPERATION_BUSY/);
      release({ canceled: true });
      assert.equal((await first).cancelled, true);
      f.electron.dialog.showOpenDialog = async () => ({ canceled: true });
      assert.equal((await upload(f, h)).cancelled, true);
    });
  } finally {
    f.cleanup();
  }
});

test("abrupt worker termination before/after native WAL commits preserves complete attachment upload/delete states", async () => {
  for (const action of ["upload-attachment", "delete-attachment"])
    for (const stage of ["before-commit", "after-commit"]) {
      const f = setup();
      try {
        await withHost(f, async (h) => {
          let id;
          if (action === "delete-attachment")
            id = (await upload(f, h)).attachmentId;
          const filename = path.join(f.directory, "vault.sqlite");
          const result = spawnSync(
            process.execPath,
            [
              path.join(__dirname, "board-attachment-crash-worker.cjs"),
              filename,
              f.selected,
              action,
              stage,
              id || "",
            ],
            {
              env: process.env,
              encoding: "utf8",
              timeout: 30000,
            },
          );
          assert.equal(
            fs.readFileSync(filename + ".stage", "utf8"),
            stage,
            result.stderr,
          );
          assert.ok(result.signal || result.status !== 0);
          f.reopen();
          const committed = stage === "after-commit";
          const expected =
            action === "upload-attachment"
              ? committed
                ? [2, 1, 1]
                : [1, 0, 0]
              : committed
                ? [1, 0, 2]
                : [2, 1, 1];
          assert.deepEqual(counts(f), expected, action + stage);
          assert.equal(
            f.native.prepare("PRAGMA integrity_check").get().integrity_check,
            "ok",
          );
        });
      } finally {
        f.cleanup();
      }
    }
});

test("full preload and exact generic channels reach persistent attachment storage without accepting renderer paths", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      const exposed = {};
      require("node:vm").runInNewContext(
        fs.readFileSync(
          path.resolve(__dirname, "../../../preload/index.js"),
          "utf8",
        ),
        {
          require(name) {
            assert.equal(name, "electron");
            return {
              contextBridge: {
                exposeInMainWorld: (key, value) => (exposed[key] = value),
              },
              desktopCapturer: {},
              ipcRenderer: {
                invoke: (channel, ...args) => h.get(channel)(f.event, ...args),
              },
            };
          },
          console: { log() {}, info() {}, warn() {}, error() {} },
        },
      );
      const api = exposed.electronAPI;
      const { attachmentId } = await api.task.uploadAttachment({
        taskId: "task-1",
      });
      assert.equal(
        (await api.task.getAttachments({ taskId: "task-1" })).attachments[0].id,
        attachmentId,
      );
      assert.equal(
        (await api.task.previewAttachment({ attachmentId })).preview.kind,
        "text",
      );
      assert.equal(
        (await api.invoke("task:delete-attachment", { attachmentId })).success,
        true,
      );
      await assert.rejects(
        api.invoke("task:upload-attachment", {
          taskId: "task-1",
          filePath: f.selected,
        }),
        /BOARD_WRITE_INVALID_REQUEST/,
      );
      assert.deepEqual(counts(f), [1, 0, 2]);
    });
  } finally {
    f.cleanup();
  }
});

test("final attachment projection checks reject post-read scope/session changes and accidental async adapters", async () => {
  const { BoardAttachmentStore } = require("../board-attachment-store");
  const original = BoardAttachmentStore.prototype.preview;
  for (const change of [
    "member",
    "scope",
    "org",
    "vault",
    "generation",
    "async",
  ]) {
    const f = setup();
    try {
      await withHost(f, async (h) => {
        const { attachmentId } = await upload(f, h);
        BoardAttachmentStore.prototype.preview = function (id) {
          const result = original.call(this, id);
          if (change === "member")
            f.native.exec(
              "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
            );
          if (change === "scope")
            f.native.exec(
              "UPDATE team_tasks SET board_id='board-2',column_id='column-2' WHERE id='task-1'",
            );
          if (change === "org") {
            f.native.exec(
              "INSERT INTO organization_members VALUES ('org-2','did:owner','active','owner','Owner')",
            );
            f.native.exec(
              "UPDATE task_boards SET org_id='org-2' WHERE id='board-1'",
            );
          }
          if (change === "vault") f.wrapper.current = {};
          if (change === "generation") f.state.generation++;
          return change === "async" ? Promise.resolve(result) : result;
        };
        await assert.rejects(
          call(f, h, "preview-attachment", { attachmentId }),
          /BOARD_/,
          change,
        );
      });
    } finally {
      BoardAttachmentStore.prototype.preview = original;
      f.cleanup();
    }
  }
});

test("exact maximum file bytes are accepted while bytes beyond that limit are refused", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      fs.writeFileSync(f.selected, Buffer.alloc(LIMITS.fileBytes));
      const { attachmentId } = await upload(f, h);
      assert.equal(
        f.native
          .prepare(
            "SELECT length(content) AS n FROM task_board_attachment_payloads WHERE attachment_id=?",
          )
          .get(attachmentId).n,
        LIMITS.fileBytes,
      );
      fs.appendFileSync(f.selected, "x");
      const before = counts(f);
      await assert.rejects(upload(f, h), /BOARD_ATTACHMENT_INVALID_FILE/);
      assert.deepEqual(counts(f), before);
    });
  } finally {
    f.cleanup();
  }
});

test("the native adapter compatibility marker does not misclassify persistent SQLite as sql.js", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      f.db.__betterSqliteCompat = true;
      const { attachmentId } = await upload(f, h);
      assert.equal(
        (await call(f, h, "preview-attachment", { attachmentId })).success,
        true,
      );
    });
  } finally {
    f.cleanup();
  }
});

test("corrupt frozen scope references cannot expand task cascade deletion into another task's bytes", async () => {
  const f = setup();
  try {
    await withHost(f, async (h) => {
      const { attachmentId } = await call(f, h, "upload-attachment", {
        taskId: "task-2",
      });
      f.native.exec(
        "UPDATE task_board_attachment_payloads SET task_id='task-1',board_id='board-1'",
      );
      await call(f, h, "delete-task", { taskId: "task-1" });
      assert.ok(
        f.native
          .prepare("SELECT 1 FROM task_attachments WHERE id=?")
          .get(attachmentId),
      );
      assert.ok(
        f.native
          .prepare(
            "SELECT 1 FROM task_board_attachment_payloads WHERE attachment_id=?",
          )
          .get(attachmentId),
      );
      await assert.rejects(call(f, h, "preview-attachment", { attachmentId }));
    });
  } finally {
    f.cleanup();
  }
});
