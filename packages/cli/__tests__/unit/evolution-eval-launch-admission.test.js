import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  createEvolutionEvalLaunchAdmissionAuthority,
  isEvolutionEvalLaunchAdmissionAuthority,
  admitEvolutionEvalLaunch,
  resolveEvolutionEvalLaunch,
} from "../../src/lib/evolution/evolution-eval-launch-admission.js";
import {
  setupEvalLaunchAdmissionFixture as setup,
  lookupEvalLaunchAdmission as lookup,
  cleanupEvalLaunchAdmissionFixtures,
} from "./evolution-eval-launch-admission-fixture.js";

afterEach(cleanupEvalLaunchAdmissionFixtures);
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
describe("Eval launch admission authority", () => {
  it("verifies real Ed25519 evidence from independent retained artifacts after reopening", async () => {
    const { resources, backend, options, input } = setup();
    const authority = createEvolutionEvalLaunchAdmissionAuthority(options);
    expect(isEvolutionEvalLaunchAdmissionAuthority(authority)).toBe(true);
    expect(isEvolutionEvalLaunchAdmissionAuthority({ ...authority })).toBe(
      false,
    );
    const result = await admitEvolutionEvalLaunch(authority, input);
    expect(result).toMatchObject({
      authenticated: true,
      durable: true,
      cohortCompletenessAuthenticated: false,
      promotionAuthority: false,
      evidence: { ...input, attestation: { algorithm: "ed25519" } },
    });
    expect(backend.ledger.verify().sequence).toBe(1);
    const reopened = createEvolutionLedgerFileBackend(resources.backendOptions);
    const recovered = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      ledger: reopened.ledger,
    });
    expect(await resolveEvolutionEvalLaunch(recovered, lookup(input))).toEqual(
      result,
    );
    await expect(admitEvolutionEvalLaunch(recovered, input)).rejects.toThrow(
      /occupied/,
    );
    expect(reopened.ledger.verify().sequence).toBe(1);
  });

  it("rejects signer forgery and key substitution before storing an event", async () => {
    const { backend, options, input } = setup();
    for (const signer of [
      { sign: () => digest("not-a-signature") },
      {
        sign: ({ message }) =>
          edSign(
            null,
            Buffer.from(message),
            generateKeyPairSync("ed25519").privateKey,
          ).toString("base64url"),
      },
    ]) {
      const authority = createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        signer,
      });
      await expect(admitEvolutionEvalLaunch(authority, input)).rejects.toThrow(
        /signature/,
      );
    }
    expect(backend.ledger.verify().sequence).toBe(0);
  });

  it("keeps the slot occupied across descriptor and signing-key rotation", async () => {
    const { options, input } = setup();
    const first = createEvolutionEvalLaunchAdmissionAuthority(options);
    await admitEvolutionEvalLaunch(first, input);
    const changed = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      descriptor: {
        ...options.descriptor,
        manifestDigest: digest("replacement"),
      },
    });
    await expect(
      admitEvolutionEvalLaunch(changed, { ...input, runId: "eval:two" }),
    ).rejects.toThrow(/occupied/);
    await expect(
      resolveEvolutionEvalLaunch(changed, lookup(input)),
    ).rejects.toThrow(/scope/);
    const wrongKey = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      publicKey: generateKeyPairSync("ed25519").publicKey,
    });
    await expect(
      resolveEvolutionEvalLaunch(wrongKey, lookup(input)),
    ).rejects.toThrow(/signature/);
  });

  it("CAS rejects an attempt whose slot is occupied during signing", async () => {
    const { resources, backend, options, input } = setup();
    const competingBackend = createEvolutionLedgerFileBackend(
      resources.backendOptions,
    );
    const competing = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      ledger: competingBackend.ledger,
    });
    let concurrent;
    const first = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      signer: {
        sign(request) {
          concurrent = admitEvolutionEvalLaunch(competing, {
            ...input,
            runId: "eval:competing",
            runNonce: "nonce:competing",
          });
          return options.signer.sign(request);
        },
      },
    });
    await expect(admitEvolutionEvalLaunch(first, input)).rejects.toThrow();
    await expect(concurrent).resolves.toMatchObject({
      evidence: { runId: "eval:competing" },
    });
    expect(backend.ledger.verify().sequence).toBe(1);
  });

  it("rejects invalid tenant, expired admission and substituted lookup", async () => {
    const { options, input } = setup();
    const authority = createEvolutionEvalLaunchAdmissionAuthority(options);
    await expect(
      admitEvolutionEvalLaunch(authority, {
        ...input,
        tenantId: "wrong-tenant",
      }),
    ).rejects.toThrow(/tenant/);
    const expired = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      now: () => Date.parse(input.deadlineAt),
    });
    await expect(admitEvolutionEvalLaunch(expired, input)).rejects.toThrow(
      /validity/,
    );
    await admitEvolutionEvalLaunch(authority, input);
    await expect(
      resolveEvolutionEvalLaunch(authority, {
        ...lookup(input),
        requestDigest: digest("another-request"),
      }),
    ).rejects.toThrow(/lookup/);
    // Expired attempts remain auditable; their recovery cannot authorize another launch.
    await expect(
      resolveEvolutionEvalLaunch(expired, lookup(input)),
    ).resolves.toMatchObject({ promotionAuthority: false });
    await expect(admitEvolutionEvalLaunch(expired, input)).rejects.toThrow();
  });

  it("captures request and signer identity before reentrant signer mutation", async () => {
    const { options, input } = setup();
    const original = { ...input };
    const sign = options.signer.sign;
    const signer = {
      sign(request) {
        input.requestDigest = digest("mutated");
        options.descriptor.manifestDigest = digest("mutated-manifest");
        return sign(request);
      },
    };
    const authority = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      signer,
    });
    signer.sign = () => {
      throw new Error("replacement must not run");
    };
    expect(
      (await admitEvolutionEvalLaunch(authority, input)).evidence,
    ).toMatchObject(original);
    await expect(
      resolveEvolutionEvalLaunch(authority, lookup(original)),
    ).resolves.toMatchObject({ authenticated: true });
  });

  it("fails closed on forged ports and accessor requests", async () => {
    const { options, input } = setup();
    expect(() =>
      createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        ledger: { read: () => [], verify: () => ({ durable: true }) },
      }),
    ).toThrow(/real artifact/);
    expect(() =>
      createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        ledgerArtifactResolver: () => ({ authenticated: true }),
      }),
    ).toThrow(/real artifact/);
    const authority = createEvolutionEvalLaunchAdmissionAuthority(options);
    Object.defineProperty(input, "runId", {
      get() {
        throw new Error("getter must not run");
      },
      enumerable: true,
    });
    await expect(admitEvolutionEvalLaunch(authority, input)).rejects.toThrow(
      /own data fields/,
    );
  });

  it("recovers a committed attempt after append acknowledgement is lost without admitting again", async () => {
    const { resources, options, input } = setup();
    const failingBackend = createEvolutionLedgerFileBackend({
      ...resources.backendOptions,
      crashHook(phase) {
        if (phase === "after-head")
          throw new Error("simulated process failure after durable head");
      },
    });
    const authority = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      ledger: failingBackend.ledger,
    });
    await expect(admitEvolutionEvalLaunch(authority, input)).rejects.toThrow();
    const recoveredBackend = createEvolutionLedgerFileBackend(
      resources.backendOptions,
    );
    const recovered = createEvolutionEvalLaunchAdmissionAuthority({
      ...options,
      ledger: recoveredBackend.ledger,
    });
    await expect(
      resolveEvolutionEvalLaunch(recovered, lookup(input)),
    ).resolves.toMatchObject({
      evidence: input,
      cohortCompletenessAuthenticated: false,
    });
    await expect(admitEvolutionEvalLaunch(recovered, input)).rejects.toThrow(
      /occupied/,
    );
    expect(recoveredBackend.ledger.verify().sequence).toBe(1);
  });

  it("rejects corruption of the independently retained artifact on audit readback", async () => {
    const { resources, options, input } = setup();
    const authority = createEvolutionEvalLaunchAdmissionAuthority(options);
    await admitEvolutionEvalLaunch(authority, input);
    const directory = path.join(resources.root, "artifacts", "files");
    const file = fs
      .readdirSync(directory)
      .find((name) => name.endsWith(".json"));
    expect(file).toBeTruthy();
    const target = path.join(directory, file);
    fs.chmodSync(target, 0o600);
    fs.writeFileSync(target, '{"substituted":true}');
    await expect(
      resolveEvolutionEvalLaunch(authority, lookup(input)),
    ).rejects.toThrow();
  });
});
