"use strict";

const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const {
  authorizeBoardWrite,
  executeBoardWrite,
} = require("./board-write-authority");
const {
  LIMITS,
  safeName,
  foreignKeys,
  BoardAttachmentStore,
  managedRow,
} = require("./board-attachment-store");
const { createBoardReadCheck } = require("./board-read-authority");
const pending = new WeakSet();
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function busy(database, db) {
  return db.inTransaction || db.isTransaction || database.inTransaction;
}
function databaseFile(db) {
  return db
    .prepare("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main")?.file;
}
function nativeStorage(db) {
  const mode = db.prepare("PRAGMA journal_mode").get()?.journal_mode;
  const synchronous = db.prepare("PRAGMA synchronous").get()?.synchronous;
  if (
    !["wal", "delete", "truncate", "persist"].includes(mode) ||
    !Number.isInteger(synchronous) ||
    synchronous < 1
  )
    fail("BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED");
  foreignKeys(db);
}
function stableStat(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    a.nlink === 1n &&
    b.nlink === 1n &&
    ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(
      (key) => a[key] === b[key],
    )
  );
}
function samePath(a, b) {
  const normalize = (value) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  return normalize(a) === normalize(b);
}

// A native file selection grants access to exactly that file. Bounded fd reads
// happen outside SQLite; no staging file or persistent path is created.
async function readSelectedFile(filePath, check) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath))
    fail("BOARD_ATTACHMENT_INVALID_FILE");
  check();
  const before = await fs.lstat(filePath, { bigint: true });
  check();
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > BigInt(LIMITS.fileBytes)
  )
    fail("BOARD_ATTACHMENT_INVALID_FILE");
  const real = await fs.realpath(filePath);
  check();
  if (!samePath(real, filePath)) fail("BOARD_ATTACHMENT_INVALID_FILE");
  const fileName = safeName(path.basename(filePath));
  const handle = await fs.open(
    real,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW || 0) |
      (constants.O_NONBLOCK || 0),
  );
  try {
    check();
    const opened = await handle.stat({ bigint: true });
    check();
    if (!stableStat(before, opened)) fail("BOARD_ATTACHMENT_FILE_CHANGED");
    const buffer = Buffer.alloc(LIMITS.fileBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await handle.read(buffer, size, buffer.length - size, size);
      check();
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > LIMITS.fileBytes) fail("BOARD_ATTACHMENT_FILE_LIMIT");
    const after = await handle.stat({ bigint: true });
    check();
    const final = await fs.lstat(real, { bigint: true });
    check();
    const finalPath = await fs.realpath(filePath);
    check();
    if (
      !stableStat(opened, after) ||
      !stableStat(after, final) ||
      !samePath(real, finalPath) ||
      after.size !== BigInt(size)
    )
      fail("BOARD_ATTACHMENT_FILE_CHANGED");
    return { fileName, bytes: Buffer.from(buffer.subarray(0, size)) };
  } finally {
    await handle.close();
  }
}

async function mutateBoardAttachment(
  database,
  event,
  action,
  params,
  dependencies = {},
) {
  const auth = authorizeBoardWrite(
    database,
    event,
    action,
    params,
    dependencies,
  );
  const { db } = auth;
  const key = action === "upload-attachment" ? "taskId" : "attachmentId";
  if (Object.keys(params).some((k) => k !== key))
    fail("BOARD_WRITE_INVALID_REQUEST");
  const file = databaseFile(db);
  // sql.js exports a whole image non-atomically. It cannot claim the native
  // journal's crash guarantees; volatile databases are also unsupported here.
  if (!file || typeof db.transaction !== "function")
    fail("BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED");
  if (busy(database, db)) fail("BOARD_ATTACHMENT_TRANSACTION_BUSY");
  nativeStorage(db);
  if (pending.has(db)) fail("BOARD_ATTACHMENT_OPERATION_BUSY");
  const platform = dependencies.electron || require("electron");
  const window = platform.BrowserWindow?.fromWebContents(event?.sender);
  const sender = event.sender;
  if (!window || window.isDestroyed() || sender?.isDestroyed?.())
    fail("BOARD_ATTACHMENT_WINDOW_UNAVAILABLE");
  const currentPath = () =>
    typeof database.getCurrentDatabasePath === "function"
      ? database.getCurrentDatabasePath()
      : database.dbPath;
  const wrapperPath = currentPath();
  const taskId =
    action === "upload-attachment"
      ? params.taskId
      : db
          .prepare("SELECT task_id FROM task_attachments WHERE id=?")
          .get(params.attachmentId)?.task_id;
  function check() {
    auth.checkAuthority();
    if (
      event.sender !== sender ||
      sender?.isDestroyed?.() ||
      window.isDestroyed() ||
      platform.BrowserWindow.fromWebContents(sender) !== window ||
      currentPath() !== wrapperPath ||
      databaseFile(db) !== file
    )
      fail("BOARD_ATTACHMENT_CONTEXT_CHANGED");
    const current = db
      .prepare(
        "SELECT t.board_id,b.org_id FROM team_tasks t JOIN task_boards b ON b.id=t.board_id WHERE t.id=?",
      )
      .get(taskId);
    if (
      !current ||
      current.board_id !== auth.scope.boardId ||
      current.org_id !== auth.scope.orgId ||
      db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(taskId)
    )
      fail("BOARD_WRITE_SCOPE_CONFLICT");
  }
  check();
  pending.add(db);
  try {
    let attachmentPayload;
    if (action === "upload-attachment") {
      const chosen = await platform.dialog.showOpenDialog(window, {
        title: "选择任务附件",
        properties: ["openFile"],
      });
      check();
      if (chosen.canceled) return { success: false, cancelled: true };
      if (!Array.isArray(chosen.filePaths) || chosen.filePaths.length !== 1)
        fail("BOARD_ATTACHMENT_INVALID_FILE");
      attachmentPayload = await readSelectedFile(chosen.filePaths[0], check);
      check();
    }
    if (busy(database, db)) fail("BOARD_ATTACHMENT_TRANSACTION_BUSY");
    nativeStorage(db);
    const result = db
      .transaction(() => {
        check();
        const value = executeBoardWrite(database, event, action, params, {
          ...dependencies,
          attachmentPayload,
        });
        check();
        if (value?.success !== true) fail("BOARD_ATTACHMENT_OPERATION_FAILED");
        return value;
      })
      .immediate();
    check();
    return result;
  } catch (error) {
    // Native chooser/FS errors may carry absolute paths; only fixed codes cross
    // this boundary or reach the IPC logger.
    const code =
      typeof error?.code === "string" &&
      /^(BOARD_(?:WRITE|READ|ATTACHMENT))_[A-Z_]+$/u.test(error.code)
        ? error.code
        : "BOARD_ATTACHMENT_OPERATION_FAILED";
    fail(code);
  } finally {
    pending.delete(db);
  }
}
function readBoardAttachment(database, event, kind, params, dependencies = {}) {
  const key = kind === "list" ? "taskId" : "attachmentId";
  const check = createBoardReadCheck(
    database,
    event,
    { [key]: params?.[key] },
    dependencies,
  );
  const db = database.getDatabase();
  if (!databaseFile(db) || typeof db.transaction !== "function")
    fail("BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED");
  if (busy(database, db)) fail("BOARD_ATTACHMENT_TRANSACTION_BUSY");
  nativeStorage(db);
  return db
    .transaction(() => {
      check();
      const store = new BoardAttachmentStore({ getDatabase: () => db });
      const result =
        kind === "list"
          ? store.list(params.taskId)
          : store.preview(params.attachmentId);
      if (result?.then) fail("BOARD_ATTACHMENT_SYNCHRONOUS_READ_REQUIRED");
      for (const item of result.attachments || [result.attachment])
        managedRow(db, item.id);
      check();
      return result;
    })
    .immediate();
}
module.exports = {
  mutateBoardAttachment,
  readSelectedFile,
  readBoardAttachment,
};
