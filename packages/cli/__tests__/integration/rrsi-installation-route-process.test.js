import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rrsiCanonical } from "../../src/lib/evolution/rrsi-data.js";
import {
  buildRrsiInstallationRoutes,
  buildRrsiInstallationRouteHighwater,
  RRSI_INSTALLATION_ROUTE_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-installation-route-contracts.js";
import { openRrsiInstallationRouteSnapshot } from "../../src/lib/evolution/rrsi-installation-route-reader.js";
import {
  makeRouteFixture,
  writeRouteFixture,
  routeSelection,
  routeNames,
  routeDigest,
} from "../fixtures/rrsi-installation-route.js";

const helper = fileURLToPath(
  new URL("../fixtures/rrsi-installation-route-process.mjs", import.meta.url),
);
const temp = fs.realpathSync.native(os.tmpdir());
let root, directory, fixture, selection;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-rrsi-route-process-"));
  directory = path.join(root, "snapshot");
  fs.mkdirSync(directory);
  fixture = makeRouteFixture();
  writeRouteFixture(directory, fixture);
  selection = routeSelection(directory, fixture);
});
afterEach(() => {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-rrsi-route-process-")
  )
    throw new Error("unsafe route process fixture cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function child(mode = "") {
  return spawnSync(
    process.execPath,
    [helper, JSON.stringify(selection), mode],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  );
}
function physical() {
  return fs
    .readdirSync(directory)
    .sort()
    .map((name) => {
      const file = path.join(directory, name),
        stat = fs.lstatSync(file, { bigint: true });
      return {
        name,
        identity: `${stat.dev}:${stat.ino}`,
        digest: routeDigest(fs.readFileSync(file)),
      };
    });
}
describe("fresh-process selected installation declarations", () => {
  it("reads exact local declarations in a fresh process without acquiring installation authority", () => {
    const before = physical(),
      response = child();
    expect(response.error).toBeUndefined();
    expect(response.status, response.stderr).toBe(0);
    expect(JSON.parse(response.stdout)).toMatchObject({
      rootAuthorityVerified: false,
      routingPinVerified: false,
      crossProcessRollbackProtectionVerified: false,
      authenticated: false,
      decision: "HOLD",
      snapshotCheck: {
        signaturesVerifiedRelativeToDeclaredKey: true,
        anchorRevision: 2,
      },
    });
    expect(physical()).toEqual(before);
  });
  it.each(routeNames)(
    "holds missing %s in a fresh process without bootstrap",
    (name) => {
      fs.renameSync(
        path.join(directory, name),
        path.join(root, `saved-${name}`),
      );
      const before = physical(),
        response = child();
      expect(response.error).toBeUndefined();
      expect(response.status).toBe(2);
      expect(JSON.parse(response.stderr).code).toBe(HOLD);
      expect(physical()).toEqual(before);
    },
  );
  it("refuses a separately valid highwater from another graph in a fresh process", () => {
    const other = makeRouteFixture({ keys: fixture.keys, graph: "another" });
    fs.writeFileSync(
      path.join(directory, "highwater.json"),
      `${rrsiCanonical(other.highwater)}\n`,
    );
    const before = physical(),
      response = child();
    expect(response.status).toBe(2);
    expect(JSON.parse(response.stderr).code).toBe(HOLD);
    expect(physical()).toEqual(before);
  });
  it("does not misrepresent a coherent whole-group rollback as externally protected", () => {
    const captured = openRrsiInstallationRouteSnapshot(selection);
    const routes = buildRrsiInstallationRoutes({
      root: fixture.root,
      packets: [fixture.routes.packets[0]],
    });
    const highwater = buildRrsiInstallationRouteHighwater({
      root: fixture.root,
      routes,
    });
    writeRouteFixture(directory, { root: fixture.root, routes, highwater });
    expect(() => captured.read()).toThrow(
      expect.objectContaining({ code: HOLD }),
    );
    const before = physical(),
      response = child();
    expect(response.status, response.stderr).toBe(0);
    expect(JSON.parse(response.stdout)).toMatchObject({
      crossProcessRollbackProtectionVerified: false,
      routingPinVerified: false,
      rootAuthorityVerified: false,
      decision: "HOLD",
      snapshotCheck: { anchorRevision: 1 },
    });
    expect(physical()).toEqual(before);
  });
  it.runIf(process.platform !== "win32").each(["fifo-file", "fifo-parent"])(
    "refuses a real POSIX %s open race without blocking",
    (mode) => {
      const response = child(mode);
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      expect(JSON.parse(response.stderr)).toMatchObject({
        code: HOLD,
        faultInjected: true,
      });
      const target =
        mode === "fifo-file" ? path.join(directory, "root.json") : directory;
      expect(fs.lstatSync(target).isFIFO()).toBe(true);
      const saved = path.join(root, "fifo-saved");
      if (mode === "fifo-file") expect(fs.lstatSync(saved).isFile()).toBe(true);
      else expect(fs.readdirSync(saved).sort()).toEqual([...routeNames].sort());
    },
  );
});
