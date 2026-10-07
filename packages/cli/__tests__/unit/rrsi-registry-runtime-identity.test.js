// TEST ONLY: real files and authenticated v2 history with synthetic stat IDs.
// Synthetic IDs exercise Number collisions on every OS, not a native NTFS claim.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  openFixture,
  provisionFixture,
  operationId,
} from "../fixtures/rrsi-registry-read-only.js";
import {
  createRrsiRegistryRuntimePolicy,
  RRSI_REGISTRY_RUNTIME_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-registry-runtime-policy.js";
import { RRSI_REGISTRY_STORE_POLICY_HOLD_CODE as HOLD } from "../../src/lib/evolution/rrsi-registry-store-policy.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const areas = [
  "artifacts",
  "active",
  "journals",
  "locks",
  "state-migrations",
  "staging",
];
const base = 1n << 60n;
afterAll(() => {
  vi.restoreAllMocks();
  for (const root of roots) {
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith("cc-rrsi-runtime-identity-")
    )
      throw new Error("unsafe precision fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

describe.each(["full", "rounded-staging"])(
  "runtime directory precision %s",
  (mode) => {
    let fixture, provision, runtime, result, statSpy;
    let legacy = mode === "rounded-staging",
      replacement = false,
      losePrecision = false;
    const nativeStat = fs.lstatSync;
    const ids = new Map();
    beforeAll(() => {
      const root = fs.mkdtempSync(
        path.join(parent, "cc-rrsi-runtime-identity-"),
      );
      roots.push(root);
      fixture = openFixture(root);
    }, 60_000);
    beforeAll(() => {
      provision = provisionFixture(fixture);
    }, 60_000);
    beforeAll(() => {
      const occupied = new Set(
        provision.prepared.directories.map((entry) =>
          entry.identity.split(":").at(-1),
        ),
      );
      let large = base,
        small = 100_000n;
      while (
        areas.some((_, index) =>
          occupied.has(String(large + BigInt(index + 1))),
        )
      )
        large += 2048n;
      while (
        areas.some((_, index) =>
          occupied.has(String(small + BigInt(index + 1))),
        )
      )
        small += 10n;
      areas.forEach((name, index) =>
        ids.set(
          path.join(provision.prepared.release.rootDir, name),
          mode === "full" || name === "staging"
            ? large + BigInt(index + 1)
            : small + BigInt(index + 1),
        ),
      );
      statSpy = vi
        .spyOn(fs, "lstatSync")
        .mockImplementation((target, options) => {
          const stat = nativeStat(target, options);
          if (!ids.has(target)) return stat;
          let inode = ids.get(target);
          if (path.basename(target) === "staging") {
            if (legacy) inode = BigInt(String(Number(inode)));
            if (replacement) inode += 1n;
          }
          stat.ino = options?.bigint && !losePrecision ? inode : Number(inode);
          if (losePrecision) stat.dev = Number(stat.dev);
          return stat;
        });
      runtime = createRrsiRegistryRuntimePolicy({
        storePolicy: fixture.policy,
        backend: fixture.store.backend,
        artifactPorts: fixture.store.artifactPorts,
        ledgerArtifactResolver: fixture.store.resolver,
      });
      result = runtime.initialize(operationId);
    }, 180_000);
    afterAll(() => statSpy?.mockRestore());
    if (mode === "full") {
      it("initializes six distinct full IDs even when all six Number projections collide", () => {
        expect(new Set([...ids.values()].map(Number)).size).toBe(1);
        expect(
          new Set(
            Object.values(result.directories).map((entry) => entry.identity),
          ).size,
        ).toBe(6);
        for (const entry of Object.values(result.directories)) {
          const stat = nativeStat(entry.path, { bigint: true });
          expect(entry.identity).toBe(`${stat.dev}:${ids.get(entry.path)}`);
        }
        expect(runtime.read(operationId)).toEqual(result);
        expect(
          fixture.store.journal
            .read()
            .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE),
        ).toHaveLength(8);
      }, 60_000);
      it("holds a distinct replacement whose Number projection matches without rewriting history or paths", () => {
        const target = result.directories.staging.path;
        expect(Number(ids.get(target) + 1n)).toBe(Number(ids.get(target)));
        const before = fixture.store.journal.verify();
        const physicalBefore = nativeStat(target, { bigint: true });
        const mkdir = vi.spyOn(fs, "mkdirSync");
        replacement = true;
        try {
          for (const operation of ["read", "recover"])
            expect(() => runtime[operation](operationId)).toThrow(
              expect.objectContaining({
                code: HOLD,
                message:
                  "runtime registered directory changed or contains business content",
              }),
            );
          expect(
            mkdir.mock.calls.filter(([value]) =>
              String(value).includes(provision.prepared.namespaceId),
            ),
          ).toEqual([]);
          expect(fixture.store.journal.verify()).toEqual(before);
          expect(nativeStat(target, { bigint: true }).ino).toBe(
            physicalBefore.ino,
          );
        } finally {
          replacement = false;
          mkdir.mockRestore();
        }
      }, 60_000);
      it("refuses a stat provider that loses requested BigInt precision", () => {
        losePrecision = true;
        try {
          expect(() => runtime.read(operationId)).toThrow(
            expect.objectContaining({
              code: HOLD,
              message:
                "runtime directory identity requires full-precision stat fields",
            }),
          );
        } finally {
          losePrecision = false;
        }
      }, 60_000);
    } else {
      it("keeps authenticated old rounded records on HOLD instead of adopting exact current IDs", () => {
        const target = result.directories.staging.path;
        const exact = ids.get(target),
          roundedDecimal = BigInt(String(Number(exact)));
        expect(exact).not.toBe(roundedDecimal);
        expect(Number(exact)).toBe(Number(roundedDecimal));
        expect(
          result.directories.staging.identity.endsWith(`:${roundedDecimal}`),
        ).toBe(true);
        const before = fixture.store.journal.verify();
        const names = fs.readdirSync(provision.prepared.release.rootDir);
        legacy = false;
        for (const operation of ["read", "recover"])
          expect(() => runtime[operation](operationId)).toThrow(
            expect.objectContaining({
              code: HOLD,
              message:
                "runtime registered directory changed or contains business content",
            }),
          );
        expect(fixture.store.journal.verify()).toEqual(before);
        expect(fs.readdirSync(provision.prepared.release.rootDir)).toEqual(
          names,
        );
        expect(
          fixture.store.journal
            .read()
            .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE),
        ).toHaveLength(8);
      }, 60_000);
    }
  },
);
