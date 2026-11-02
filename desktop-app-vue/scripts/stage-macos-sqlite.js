const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const sqliteNames = new Set([
  "better-sqlite3",
  "better-sqlite3-multiple-ciphers",
]);

function stageMacSqlite(
  root,
  stage,
  verifyBinary = (file) =>
    execFileSync("lipo", [file, "-verify_arch", "x86_64", "arm64"]),
) {
  const seen = new Set();
  const modules = [];
  function visitPackage(dir) {
    const name = path.basename(dir);
    if (sqliteNames.has(name)) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      assert.equal(pkg.name, name);
      assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
      modules.push({ dir, name, version: pkg.version });
    }
    scan(path.join(dir, "node_modules"));
  }
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const item = path.join(dir, entry.name);
      if (entry.name.startsWith("@")) {
        for (const pkg of fs.readdirSync(item, { withFileTypes: true })) {
          if (pkg.isDirectory()) visitPackage(path.join(item, pkg.name));
        }
      } else if (!entry.name.startsWith(".")) visitPackage(item);
    }
  }
  scan(path.join(root, "node_modules"));
  scan(path.join(root, "desktop-app-vue", "node_modules"));
  for (const entry of fs.readdirSync(path.join(root, "packages"), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory())
      scan(path.join(root, "packages", entry.name, "node_modules"));
  }
  assert.ok(modules.length > 0, "No installed SQLite modules to stage");
  // Validate the complete version map before changing any dependency copy.
  for (const module of modules) {
    module.staged = path.join(
      stage,
      `${module.name}-${module.version}-universal.node`,
    );
    assert.ok(
      fs.existsSync(module.staged),
      `No Electron rebuild for ${module.name}@${module.version}`,
    );
  }
  for (const module of modules) {
    const destination = path.join(
      module.dir,
      "build",
      "Release",
      "better_sqlite3.node",
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(module.staged, destination);
    verifyBinary(destination);
    console.log(
      `[mac-sqlite] staged ${module.name}@${module.version}: ${destination}`,
    );
  }
  return modules;
}

if (require.main === module) stageMacSqlite(process.cwd(), process.argv[2]);
module.exports = { stageMacSqlite };
