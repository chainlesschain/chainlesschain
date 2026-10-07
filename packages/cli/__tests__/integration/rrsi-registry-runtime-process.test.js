import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openFixture,
  provisionFixture,
} from "../fixtures/rrsi-registry-read-only.js";
import { RRSI_REGISTRY_RUNTIME_EVENT_TYPE } from "../../src/lib/evolution/rrsi-registry-runtime-policy.js";
import { RRSI_REGISTRY_STORE_POLICY_HOLD_CODE as HOLD } from "../../src/lib/evolution/rrsi-registry-store-policy.js";

const parent = fs.realpathSync.native(os.tmpdir());
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-registry-runtime-process.mjs", import.meta.url),
);
const areas = [
  "artifacts",
  "active",
  "journals",
  "locks",
  "state-migrations",
  "staging",
];
const roots = [];
function child(root, mode, phase = "") {
  return spawnSync(process.execPath, [helper, root, mode, String(phase)], {
    encoding: "utf8",
    windowsHide: true,
    // Aggregate process lifetime includes eight separate durable phases and
    // fresh Registry construction. Individual native helper budgets stay fixed.
    timeout: 170_000,
  });
}
function inventory(root) {
  const entries = [];
  function visit(target) {
    const stat = fs.lstatSync(target, { bigint: true });
    entries.push({
      path: path.relative(root, target),
      identity: `${stat.dev}:${stat.ino}`,
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(target).sort())
        visit(path.join(target, name));
  }
  visit(path.join(root, "provisioned"));
  return entries;
}
function records(fixture) {
  return fixture.store.journal
    .read()
    .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE);
}
function setup() {
  const root = fs.mkdtempSync(path.join(parent, "cc-rrsi-runtime-process-"));
  roots.push(root);
  return { root, fixture: openFixture(root) };
}
afterAll(() => {
  for (const root of roots) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-rrsi-runtime-process-")
    )
      throw new Error("unsafe runtime process fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

describe.each([1, 4, 7, 8])(
  "runtime restart after retained phase %i",
  (phase) => {
    let root, fixture, provision, prefix;
    beforeAll(() => {
      ({ root, fixture } = setup());
    }, 180_000);
    beforeAll(() => {
      provision = provisionFixture(fixture);
    }, 180_000);
    it("interrupts exactly after the committed journal head and keeps the persisted prefix", () => {
      const interrupted = child(root, "after-head", phase);
      expect(interrupted.status, interrupted.stderr).toBe(81);
      expect(interrupted.error).toBeUndefined();
      expect(records(fixture)).toHaveLength(phase);
      prefix = inventory(root);
    }, 180_000);
    it("continues only the missing suffix with eight distinct events and unchanged registered identities", () => {
      const reopened = child(root, "recover");
      expect(reopened.status, reopened.stderr).toBe(0);
      const output = JSON.parse(reopened.stdout);
      expect(output.records).toHaveLength(8);
      expect(new Set(output.records.map((event) => event.eventId)).size).toBe(
        8,
      );
      expect(Object.keys(output.result.directories)).toEqual(areas);
      const after = inventory(root);
      for (const entry of prefix)
        expect(after.find((value) => value.path === entry.path)).toEqual(entry);
      expect(output.result).toMatchObject({
        originCutoverAuthenticated: false,
        grantsMutationOrPromotionAuthority: false,
      });
      const created = output.mutations
        .filter((entry) => entry.operation === "mkdirSync")
        .map((entry) => path.basename(entry.target));
      expect(created).toEqual(areas.slice(Math.min(phase - 1, 6)));
      expect(
        output.mutations.filter((entry) =>
          ["unlinkSync", "rmSync", "rmdirSync"].includes(entry.operation),
        ),
      ).toEqual([]);
      expect(fs.readdirSync(provision.prepared.release.rootDir).sort()).toEqual(
        ["_tenant.json", ...areas].sort(),
      );
    }, 180_000);
    it("recaptures the attachment in another process with no Registry mutation", () => {
      const before = inventory(root),
        head = fixture.store.journal.verify();
      const reopened = child(root, "read");
      expect(reopened.status, reopened.stderr).toBe(0);
      const output = JSON.parse(reopened.stdout);
      expect(output.mutations).toEqual([]);
      expect(output.candidateInventory).toEqual([]);
      expect(output.releaseInventory).toEqual({ active: [], releases: [] });
      expect(output.state).toMatchObject({ revision: 0 });
      expect(inventory(root)).toEqual(before);
      expect(fixture.store.journal.verify()).toEqual(head);
    }, 180_000);
  },
);

describe("unregistered mkdir survives restart as HOLD", () => {
  let root, fixture, provision;
  beforeAll(() => {
    ({ root, fixture } = setup());
  }, 180_000);
  beforeAll(() => {
    provision = provisionFixture(fixture);
  }, 180_000);
  it("leaves the third created directory without claiming an installed record", () => {
    const interrupted = child(root, "after-mkdir", "journals");
    expect(interrupted.status, interrupted.stderr).toBe(82);
    expect(interrupted.error).toBeUndefined();
    expect(records(fixture)).toHaveLength(3);
    expect(fs.readdirSync(provision.prepared.release.rootDir).sort()).toEqual(
      ["_tenant.json", ...areas.slice(0, 3)].sort(),
    );
  }, 180_000);
  it("preserves the unregistered directory and stops before suffix creation or cleanup", () => {
    const before = inventory(root),
      head = fixture.store.journal.verify();
    const reopened = child(root, "recover");
    expect(reopened.status, reopened.stderr).toBe(2);
    expect(JSON.parse(reopened.stderr)).toMatchObject({
      code: HOLD,
      mutations: [],
    });
    expect(inventory(root)).toEqual(before);
    expect(fixture.store.journal.verify()).toEqual(head);
  }, 180_000);
});

describe.each(["missing", "replaced"])(
  "registered prefix %s after interruption",
  (mode) => {
    let root, fixture, provision;
    beforeAll(() => {
      ({ root, fixture } = setup());
    }, 180_000);
    beforeAll(() => {
      provision = provisionFixture(fixture);
    }, 180_000);
    beforeAll(() => {
      const interrupted = child(root, "after-head", 4);
      expect(interrupted.status, interrupted.stderr).toBe(81);
      expect(records(fixture)).toHaveLength(4);
      const target = path.join(provision.prepared.release.rootDir, "active");
      fs.renameSync(target, path.join(root, "saved-active"));
      if (mode === "replaced") fs.mkdirSync(target);
    }, 180_000);
    it("holds in the new process without adopting, repairing or creating a suffix", () => {
      const before = inventory(root),
        head = fixture.store.journal.verify();
      const reopened = child(root, "recover");
      expect(reopened.status, reopened.stderr).toBe(2);
      expect(JSON.parse(reopened.stderr)).toMatchObject({
        code: HOLD,
        mutations: [],
      });
      expect(inventory(root)).toEqual(before);
      expect(fixture.store.journal.verify()).toEqual(head);
      expect(
        fs.existsSync(path.join(provision.prepared.release.rootDir, "locks")),
      ).toBe(false);
    }, 180_000);
  },
);
