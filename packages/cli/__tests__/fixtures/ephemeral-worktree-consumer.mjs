import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Publish only complete JSON and keep the original exclusive-create contract.
function publishJson(file, value) {
  const pending = `${file}.${process.pid}.${randomUUID()}.pending`;
  fs.writeFileSync(pending, JSON.stringify(value), { flag: "wx" });
  try {
    fs.linkSync(pending, file);
  } finally {
    fs.unlinkSync(pending);
  }
}

const artifacts = path.resolve(process.argv[2]);
const mode = process.argv[3];
const worktree = process.argv[4]
  ? path.resolve(process.argv[4])
  : process.cwd();
const target = path.join(worktree, "README.md");
const before = fs.readFileSync(target, "utf8");
if (mode === "release-cwd") process.chdir(artifacts);
const release = path.join(artifacts, "release.json");
await new Promise((resolve, reject) => {
  const watcher = fs.watch(artifacts, () => {
    if (fs.existsSync(release)) {
      watcher.close();
      clearTimeout(timer);
      resolve();
    }
  });
  const timer = setTimeout(() => {
    watcher.close();
    reject(new Error("parent release handshake timed out"));
  }, 20000);
  publishJson(path.join(artifacts, "ready.json"), {
    pid: process.pid,
    ppid: process.ppid,
    worktree,
    currentCwd: process.cwd(),
    before,
    mode,
  });
  if (fs.existsSync(release)) {
    watcher.close();
    clearTimeout(timer);
    resolve();
  }
});
let result;
try {
  result = { ok: true, content: fs.readFileSync(target, "utf8") };
} catch (error) {
  result = { ok: false, code: error.code, message: error.message };
}
publishJson(path.join(artifacts, "result.json"), {
  pid: process.pid,
  worktree,
  target,
  result,
});
