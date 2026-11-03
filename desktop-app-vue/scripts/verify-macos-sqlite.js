const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

function findMacApp(appOutDir) {
  const apps = fs
    .readdirSync(appOutDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  assert.equal(apps.length, 1, `Expected one Mac app in ${appOutDir}`);
  return path.join(appOutDir, apps[0].name);
}

function readMacArchitectures(app) {
  const binDir = path.join(app, "Contents", "MacOS");
  const binaries = fs
    .readdirSync(binDir, { withFileTypes: true })
    .filter((entry) => entry.isFile());
  assert.equal(binaries.length, 1, `Expected one Mac executable in ${binDir}`);
  return execFileSync("lipo", [path.join(binDir, binaries[0].name), "-archs"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/);
}

function verifyMacApp(
  app,
  { verifyBinary, readArchitectures = readMacArchitectures } = {},
) {
  const resources = path.join(app, "Contents", "Resources");
  assert.ok(fs.existsSync(resources), `Missing Mac resources: ${resources}`);
  const architectures = readArchitectures(app);
  assert.ok(
    architectures.length > 0 &&
      architectures.every((arch) => ["x86_64", "arm64"].includes(arch)),
    "Unsupported Mac executable architecture",
  );
  const check =
    verifyBinary ||
    ((file, expected) => {
      execFileSync("lipo", [file, "-verify_arch", ...expected]);
    });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mac-sqlite-"));
  let count = 0;
  const verify = (file, identity) => {
    try {
      check(file, architectures);
      count += 1;
      console.log(
        `[mac-sqlite] compatible ${architectures.join("+")} binding: ${identity}`,
      );
    } catch (error) {
      throw new Error(
        `Invalid packaged SQLite binding ${identity}: ${error.message}`,
        { cause: error },
      );
    }
  };
  try {
    const archive = path.join(resources, "app.asar");
    if (fs.existsSync(archive)) {
      for (const entry of asar.listPackage(archive)) {
        const name = entry.replace(/\\/g, "/").replace(/^\/+/, "");
        if (!name.endsWith("/better_sqlite3.node")) continue;
        // extractFile handles both packed bytes and ASAR unpacked markers.
        const extracted = path.join(scratch, `${count}.node`);
        fs.writeFileSync(
          extracted,
          asar.extractFile(archive, path.normalize(name)),
        );
        verify(extracted, `${archive}:${name}`);
      }
    }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && entry.name === "better_sqlite3.node")
          verify(file, file);
      }
    };
    walk(resources);
    assert.ok(count > 0, `No SQLite bindings found in ${app}`);
    return count;
  } finally {
    assert.equal(
      path.dirname(path.resolve(scratch)),
      path.resolve(os.tmpdir()),
    );
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const apps = process.argv.slice(2);
  assert.equal(new Set(apps).size, 2, "Verify both distinct Mac app bundles");
  for (const app of apps) verifyMacApp(app);
}

module.exports = { findMacApp, verifyMacApp };
