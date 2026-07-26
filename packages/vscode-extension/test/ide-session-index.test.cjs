const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const indexModulePath = path.resolve(
  __dirname,
  "../src/chat/ide-session-index.js",
);
const {
  readIdeSessionIndex,
  upsertIdeSessionRecord,
} = require(indexModulePath);

function tempIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vscode-ide-index-"));
  return {
    dir,
    file: path.join(dir, "session-index.json"),
  };
}

function runWriter(file, id) {
  const source = [
    "const index = require(process.env.CC_INDEX_MODULE);",
    "index.upsertIdeSessionRecord({",
    "  id: process.env.CC_INDEX_ID,",
    "  title: process.env.CC_INDEX_ID,",
    "  ide: 'vscode',",
    "  status: 'running'",
    "}, { file: process.env.CC_INDEX_FILE });",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source], {
      env: {
        ...process.env,
        CC_INDEX_MODULE: indexModulePath,
        CC_INDEX_FILE: file,
        CC_INDEX_ID: id,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`writer ${id} exited ${code}: ${stderr}`));
    });
  });
}

test("cross-process upserts retain every session", async (t) => {
  const { dir, file } = tempIndex();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runWriter(file, `session-${index}`),
    ),
  );

  const rows = readIdeSessionIndex({ file });
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    Array.from({ length: 8 }, (_, index) => `session-${index}`),
  );
  assert.equal(
    fs.readdirSync(dir).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("a busy index lock fails closed without writing", (t) => {
  const { dir, file } = tempIndex();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(`${file}.lock`);

  assert.throws(
    () =>
      upsertIdeSessionRecord(
        { id: "blocked", ide: "vscode", status: "running" },
        { file, lockTimeoutMs: 0 },
      ),
    { code: "IDE_SESSION_INDEX_LOCK_UNAVAILABLE" },
  );
  assert.equal(fs.existsSync(file), false);
});

test("a corrupt index is preserved instead of replaced", (t) => {
  const { dir, file } = tempIndex();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(file, "{broken", "utf8");

  assert.throws(
    () =>
      upsertIdeSessionRecord(
        { id: "new", ide: "vscode", status: "running" },
        { file },
      ),
    { code: "IDE_SESSION_INDEX_CORRUPT" },
  );
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
