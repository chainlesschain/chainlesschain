import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openFixture,
  provisionFixture,
  bindFixture,
} from "../fixtures/rrsi-registry-read-only.js";
import { RRSI_REGISTRY_STORE_POLICY_HOLD_CODE as HOLD } from "../../src/lib/evolution/rrsi-registry-store-policy.js";
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-registry-read-only-process.mjs", import.meta.url),
);
let root, fixture, provisioned, bindings;
function child(mode = "read") {
  return spawnSync(
    process.execPath,
    [
      helper,
      root,
      mode,
      provisioned.prepared.candidate.baseDir,
      provisioned.prepared.release.baseDir,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    },
  );
}
function snapshot() {
  const values = [];
  const visit = (target) => {
    const stat = fs.lstatSync(target);
    values.push({
      path: path.relative(root, target),
      identity: `${stat.dev}:${stat.ino}`,
      type: stat.isDirectory() ? "directory" : "file",
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(target).sort())
        visit(path.join(target, name));
  };
  visit(path.join(root, "provisioned"));
  return values;
}
describe.sequential(
  "genuine Registry v2 component binding in a fresh Node process",
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(
        path.join(temporaryParent, "cc-rrsi-read-only-process-"),
      );
      fixture = openFixture(root);
    }, 60_000);
    beforeAll(() => {
      provisioned = provisionFixture(fixture);
    }, 60_000);
    beforeAll(() => {
      bindings = bindFixture(fixture);
    }, 60_000);
    afterAll(() => {
      if (!root) return;
      if (
        path.dirname(path.resolve(root)) !== temporaryParent ||
        !path.basename(root).startsWith("cc-rrsi-read-only-process-")
      )
        throw new Error("unsafe Registry read-only process fixture cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it("recaptures the original pair and opens genuine empty readers without Registry publication or policy locks", () => {
      const before = snapshot(),
        head = fixture.store.journal.verify();
      const result = child();
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.candidateDescriptor).toEqual(bindings.candidate.descriptor);
      expect(output.releaseDescriptor).toEqual(bindings.release.descriptor);
      expect(output.candidateInventory).toEqual([]);
      expect(output.releaseInventory).toEqual({ active: [], releases: [] });
      expect(output.state).toMatchObject({ revision: 0, tenantId: "tenant-a" });
      expect(output.mutations).toEqual([]);
      expect(snapshot()).toEqual(before);
      expect(fixture.store.journal.verify()).toEqual(head);
    }, 60_000);

    it("holds marker loss in a new process and rejects both unbound constructors before v1 bootstrap", () => {
      const target = path.join(
          provisioned.prepared.candidate.rootDir,
          "_tenant.json",
        ),
        saved = path.join(root, "saved-marker");
      fs.renameSync(target, saved);
      try {
        const before = snapshot();
        const bound = child();
        expect(bound.status, bound.stderr).toBe(2);
        expect(JSON.parse(bound.stderr)).toMatchObject({
          code: HOLD,
          mutations: [],
        });
        const unbound = child("unbound");
        expect(unbound.status, unbound.stderr).toBe(0);
        expect(JSON.parse(unbound.stdout)).toEqual({
          failures: [
            { component: "candidate", code: HOLD },
            { component: "release", code: HOLD },
          ],
          mutations: [],
        });
        expect(snapshot()).toEqual(before);
        expect(fs.existsSync(target)).toBe(false);
      } finally {
        fs.renameSync(saved, target);
      }
    }, 60_000);

    it("retains a same-byte marker replacement on HOLD after process restart", () => {
      const target = path.join(
          provisioned.prepared.release.rootDir,
          "_tenant.json",
        ),
        saved = path.join(root, "saved-release-marker");
      const bytes = fs.readFileSync(target);
      fs.renameSync(target, saved);
      fs.writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
      try {
        const before = snapshot(),
          result = child();
        expect(result.status, result.stderr).toBe(2);
        expect(JSON.parse(result.stderr)).toMatchObject({
          code: HOLD,
          mutations: [],
        });
        expect(snapshot()).toEqual(before);
      } finally {
        fs.unlinkSync(target);
        fs.renameSync(saved, target);
      }
    }, 60_000);

    it("preserves unknown recovery evidence without constructor cleanup in a new process", () => {
      const target = path.join(
        provisioned.prepared.release.rootDir,
        "journals",
      );
      fs.mkdirSync(target);
      const file = path.join(target, "safe-refactor.json");
      fs.writeFileSync(file, "TEST ONLY unknown transaction evidence");
      try {
        const before = snapshot(),
          result = child();
        expect(result.status, result.stderr).toBe(2);
        expect(JSON.parse(result.stderr)).toMatchObject({
          code: HOLD,
          mutations: [],
        });
        expect(snapshot()).toEqual(before);
      } finally {
        fs.unlinkSync(file);
        fs.rmdirSync(target);
      }
    }, 60_000);
  },
);
