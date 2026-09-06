import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCliRegistryInstall } from "../../scripts/verify-cli-registry-install.mjs";

const roots = [];
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-registry-install-"),
  );
  roots.push(root);
  const expected = {
    name: "chainlesschain",
    version: "0.166.24",
    dependencies: {
      "@chainlesschain/core-db": "0.1.5",
      "@chainlesschain/session-core": "0.3.12",
    },
  };
  const cliFile = path.join(root, "node_modules/chainlesschain/package.json");
  write(cliFile, expected);
  const lock = { lockfileVersion: 3, packages: {} };
  for (const [name, version] of Object.entries(expected.dependencies)) {
    const key = `node_modules/${name}`;
    write(path.join(root, key, "package.json"), {
      name,
      version,
      main: "index.js",
    });
    fs.writeFileSync(
      path.join(root, key, "index.js"),
      "module.exports = {};\n",
    );
    lock.packages[key] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${version}.tgz`,
      integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    };
  }
  const save = () => write(path.join(root, "package-lock.json"), lock);
  save();
  return { root, expected, lock, save, cliFile };
}
describe("pre-publish CLI public dependency install evidence", () => {
  it("records exact installed child pins with public registry integrity, without calling the CLI public yet", () => {
    const f = fixture();
    expect(verifyCliRegistryInstall(f.root, f.expected)).toMatchObject({
      cliSource: "immutable-candidate-tarball",
      childrenSource: "https://registry.npmjs.org",
      children: [
        { name: "@chainlesschain/core-db", version: "0.1.5" },
        { name: "@chainlesschain/session-core", version: "0.3.12" },
      ],
    });
  });
  it.each([
    "file:../core-db.tgz",
    "https://registry.npmmirror.com/core-db/-/core-db.tgz",
    "https://registry.npmjs.org.evil.test/core-db/-/core-db.tgz",
  ])("rejects non-public dependency source %s", (resolved) => {
    const f = fixture();
    f.lock.packages["node_modules/@chainlesschain/core-db"].resolved = resolved;
    f.save();
    expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
      /public npm/u,
    );
  });
  it.each(["version", "integrity", "link"])(
    "rejects invalid registry lock %s",
    (field) => {
      const f = fixture();
      const entry = f.lock.packages["node_modules/@chainlesschain/core-db"];
      if (field === "link") entry.link = true;
      else entry[field] = "invalid";
      f.save();
      expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
        /registry lock/u,
      );
    },
  );
  it("rejects an old installed child even when the candidate pin and lock look correct", () => {
    const f = fixture();
    write(
      path.join(
        f.root,
        "node_modules/@chainlesschain/session-core/package.json",
      ),
      {
        name: "@chainlesschain/session-core",
        version: "0.3.11",
        main: "index.js",
      },
    );
    expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
      /wrong version/u,
    );
  });
  it("rejects workspace substitution outside the clean install", () => {
    const f = fixture();
    const external = fixture();
    const target = path.join(f.root, "node_modules/@chainlesschain/core-db");
    fs.rmSync(target, { recursive: true, force: true });
    fs.symlinkSync(
      path.join(external.root, "node_modules/@chainlesschain/core-db"),
      target,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
      /outside|substituted/u,
    );
  });
  it("rejects a different CLI archive and non-exact dependency pins", () => {
    const f = fixture();
    write(f.cliFile, { ...f.expected, version: "0.166.23" });
    expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
      /CLI identity/u,
    );
    write(f.cliFile, f.expected);
    f.expected.dependencies["@chainlesschain/core-db"] = "^0.1.5";
    expect(() => verifyCliRegistryInstall(f.root, f.expected)).toThrow(
      /exact release pin/u,
    );
  });
});
