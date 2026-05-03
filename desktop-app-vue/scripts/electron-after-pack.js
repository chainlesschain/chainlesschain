/**
 * electron-builder afterPack hook.
 *
 * Last-resort fix for the v5.0.3.4-13 saga of "Cannot find module
 * 'call-bind-apply-helpers'". electron-builder's prod-dep walker keeps
 * de-duping the top-level copy of call-bind-apply-helpers (and only that
 * package — the other 6 express@5/qs/side-channel split deps survive at
 * top-level). The dedupe happens at file-selection time, BEFORE asar
 * packing, so disabling asar doesn't help either.
 *
 * This hook runs AFTER electron-builder packages files into the unpacked
 * output (`<appOutDir>/resources/app/` for asar:false, or
 * `<appOutDir>/resources/app.asar` for asar:true). At this point we can
 * still mutate `resources/app/node_modules/` before the installer is
 * generated.
 *
 * Strategy: walk every nested `node_modules/<parent>/node_modules/<pkg>/`
 * for our 7 known-problematic packages and, if no top-level copy exists,
 * promote the nested one to top-level. This guarantees Node's CJS
 * resolver finds them when require'd from anywhere in the tree.
 *
 * If any package is missing entirely (no nested copy either), exit non-
 * zero — the build is broken in a way this hook can't fix and we should
 * fail rather than ship a non-working artifact.
 */

const fs = require("fs");
const path = require("path");

const PROBLEMATIC_PKGS = [
  "call-bind-apply-helpers",
  "dunder-proto",
  "get-proto",
  "math-intrinsics",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
];

function findNestedCopy(rootNodeModules, pkg) {
  if (!fs.existsSync(rootNodeModules)) return null;
  for (const entry of fs.readdirSync(rootNodeModules, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(rootNodeModules, entry.name, "node_modules", pkg);
    if (fs.existsSync(path.join(nested, "package.json"))) {
      return { source: nested, parent: entry.name };
    }
  }
  return null;
}

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const tag = "[after-pack:promote-nested]";

  const appRoot = path.join(appOutDir, "resources", "app");
  const nodeModules = path.join(appRoot, "node_modules");

  if (!fs.existsSync(nodeModules)) {
    console.log(
      `${tag} ${nodeModules} not found — assuming asar:true layout, skipping`,
    );
    return;
  }

  const missing = [];
  let promoted = 0;

  for (const pkg of PROBLEMATIC_PKGS) {
    const topLevel = path.join(nodeModules, pkg);
    if (fs.existsSync(path.join(topLevel, "package.json"))) {
      continue;
    }

    const found = findNestedCopy(nodeModules, pkg);
    if (!found) {
      missing.push(pkg);
      console.error(
        `${tag} ${pkg} missing top-level AND no nested copy — cannot recover`,
      );
      continue;
    }

    fs.cpSync(found.source, topLevel, { recursive: true });
    promoted += 1;
    console.log(
      `${tag} promoted ${pkg} from node_modules/${found.parent}/node_modules/ to top-level`,
    );
  }

  if (missing.length) {
    throw new Error(
      `${tag} unrecoverable missing packages: ${missing.join(", ")}`,
    );
  }

  console.log(
    `${tag} done — promoted ${promoted}/${PROBLEMATIC_PKGS.length} packages`,
  );
};
