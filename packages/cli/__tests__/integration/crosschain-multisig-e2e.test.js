/**
 * #21 B.5 Layer 1 PR1 — `cc crosschain bridge --require-multisig` E2E。
 *
 * Mirrors `marketplace-multisig-e2e.test.js` pattern: spawn the CLI, set up
 * 2-of-2 policy on domain `crosschain.bridge.outbound`, propose → sign →
 * consume → assert `cc_bridges` row exists + proposal state `consumed`.
 *
 * 错误路径:
 *   - propose without --initiator / --key → exit code 2
 *   - propose with no policy on domain → blocked
 *   - bridge-consume pending proposal → proposal_state_pending
 *   - bridge-consume wrong-domain proposal → wrong_domain
 *   - bridge-consume of nonexistent → proposal_not_found
 *
 * HOME override: spawnSync env passes HOME + USERPROFILE = tmpDir so
 * `getHomeDir()` lands the crosschain bootstrap DB inside tmpDir, isolating
 * the test from real ~/.chainlesschain/ state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ed25519 as nobleEd25519 } from "@noble/curves/ed25519.js";
import ed25519Signer from "@chainlesschain/core-mtc/signers/ed25519";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");
const DOMAIN = "crosschain.bridge.outbound";
const randomSecretKey =
  nobleEd25519.utils.randomSecretKey || nobleEd25519.utils.randomPrivateKey;

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* try shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 400)}`);
}

function genKeyPair(idx) {
  const sk = Buffer.from(randomSecretKey());
  const pk = Buffer.from(nobleEd25519.getPublicKey(sk));
  return {
    did: `did:cc:test-bridge-signer-${idx}`,
    alg: "Ed25519",
    pubkeyJwk: ed25519Signer.makeJwk(pk),
    secretKey: sk,
  };
}

describe("cc crosschain bridge --require-multisig — Layer 1 E2E (#21 B.5)", () => {
  let tmpDir;
  let dbPath;
  let logPath;
  let membersFile;
  let keyFiles;
  let members;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: tmpDir,
        USERPROFILE: tmpDir,
      },
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bridge-ms-e2e-"));
    dbPath = path.join(tmpDir, "multisig.db");
    logPath = path.join(tmpDir, "governance.log");
    membersFile = path.join(tmpDir, "members.json");
    members = [genKeyPair(0), genKeyPair(1)];
    keyFiles = members.map((m, i) => {
      const p = path.join(tmpDir, `key-${i}.hex`);
      fs.writeFileSync(p, m.secretKey.toString("hex"), "utf-8");
      return p;
    });
    fs.writeFileSync(
      membersFile,
      JSON.stringify(
        members.map((m) => ({
          did: m.did,
          alg: m.alg,
          pubkeyJwk: m.pubkeyJwk,
        })),
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setPolicy(m = 2) {
    return runCli([
      "multisig",
      "policy",
      "set",
      DOMAIN,
      "--m",
      String(m),
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
  }

  function propose({ initiator = members[0], extraArgs = [] } = {}) {
    return runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "100",
      "--sender",
      "0xSENDER",
      "--recipient",
      "did:cc:recipient",
      "--require-multisig",
      "--initiator",
      initiator.did,
      "--key",
      keyFiles[members.indexOf(initiator)],
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
      "--json",
      ...extraArgs,
    ]);
  }

  function sign(proposalId, signer) {
    return runCli([
      "multisig",
      "sign",
      proposalId,
      "--signer",
      signer.did,
      "--key",
      keyFiles[members.indexOf(signer)],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
  }

  function consume(proposalId) {
    return runCli([
      "crosschain",
      "bridge-consume",
      proposalId,
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
      "--json",
    ]);
  }

  it("happy path 2-of-2: policy → propose → sign → consume → bridge inserted", () => {
    const policyRes = setPolicy(2);
    expect(policyRes.status, policyRes.stderr).toBe(0);

    const proposeRes = propose();
    expect(proposeRes.status, proposeRes.stderr).toBe(0);
    const proposed = extractJson(proposeRes.stdout);
    expect(proposed.status).toBe("needs_co_sign");
    expect(proposed.path).toBe("multisig");
    expect(proposed.proposalId).toMatch(/^msp_/);
    expect(proposed.reachedThreshold).toBe(false);
    expect(proposed.requiredSigs).toBe(2);
    expect(proposed.payload).toEqual({
      fromChain: "ethereum",
      toChain: "polygon",
      asset: "native",
      amount: 100,
      sender: "0xSENDER",
      recipient: "did:cc:recipient",
    });

    const signRes = sign(proposed.proposalId, members[1]);
    expect(signRes.status, signRes.stderr).toBe(0);
    const signOut = extractJson(signRes.stdout);
    expect(signOut.accepted).toBe(true);
    expect(signOut.reachedThreshold).toBe(true);

    const consumeRes = consume(proposed.proposalId);
    expect(consumeRes.status, consumeRes.stderr).toBe(0);
    const consumed = extractJson(consumeRes.stdout);
    expect(consumed.status).toBe("consumed");
    expect(consumed.proposalId).toBe(proposed.proposalId);
    expect(consumed.bridgeId).toMatch(/^/);
    expect(consumed.payload.fromChain).toBe("ethereum");
    expect(consumed.payload.toChain).toBe("polygon");
    expect(consumed.payload.amount).toBe(100);
    // Layer 2 provenance — both DIDs end up in the consume response,
    // sorted ASC by signer_did per store.getSignatures contract.
    expect(consumed.signers).toHaveLength(2);
    expect(consumed.partialSigCount).toBe(2);
    expect([...consumed.signers].sort()).toEqual(consumed.signers);

    // Proposal state → consumed
    const showRes = runCli([
      "multisig",
      "show",
      proposed.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const detail = extractJson(showRes.stdout);
    expect(detail.proposal.state).toBe("consumed");

    // Layer 2 PR1 — cc_bridges row persists multisig provenance.
    const bridgeShowRes = runCli([
      "crosschain",
      "bridge-show",
      consumed.bridgeId,
      "--json",
    ]);
    expect(bridgeShowRes.status, bridgeShowRes.stderr).toBe(0);
    const bridgeRow = extractJson(bridgeShowRes.stdout);
    expect(bridgeRow.multisig_proposal_id).toBe(proposed.proposalId);
    expect(JSON.parse(bridgeRow.signers_did_json)).toEqual(consumed.signers);
    const partialSigs = JSON.parse(bridgeRow.partial_sigs_json);
    expect(partialSigs).toHaveLength(2);
    for (const s of partialSigs) {
      expect(s.alg).toBe("Ed25519");
      expect(typeof s.sig).toBe("string");
      expect(s.sig).toMatch(/^[0-9a-f]+$/);
      expect(s.sig.length).toBeGreaterThan(0);
    }
  });

  it("1-of-1 reaches threshold on first signature", () => {
    fs.writeFileSync(
      membersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    expect(setPolicy(1).status).toBe(0);

    const proposeRes = propose();
    expect(proposeRes.status, proposeRes.stderr).toBe(0);
    const proposed = extractJson(proposeRes.stdout);
    expect(proposed.reachedThreshold).toBe(true);
    expect(proposed.requiredSigs).toBe(1);

    const consumeRes = consume(proposed.proposalId);
    expect(consumeRes.status, consumeRes.stderr).toBe(0);
    const consumed = extractJson(consumeRes.stdout);
    expect(consumed.status).toBe("consumed");
    expect(consumed.signers).toHaveLength(1);
    expect(consumed.signers[0]).toBe(members[0].did);
    expect(consumed.partialSigCount).toBe(1);
  });

  it("Layer 2: legacy direct bridge leaves multisig provenance NULL", () => {
    // Non-multisig path — no --require-multisig, so no proposal context.
    const r = runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "75",
      "--sender",
      "0xSENDER",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.bridgeId).toBeTruthy();

    const showRes = runCli([
      "crosschain",
      "bridge-show",
      out.bridgeId,
      "--json",
    ]);
    expect(showRes.status, showRes.stderr).toBe(0);
    const row = extractJson(showRes.stdout);
    expect(row.multisig_proposal_id).toBeFalsy();
    expect(row.signers_did_json).toBeFalsy();
    expect(row.partial_sigs_json).toBeFalsy();
  });

  it("Layer 2 PR4: bridge-consume --mtc stages op with multisig_provenance into MTC staging dir", () => {
    fs.writeFileSync(
      membersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    expect(setPolicy(1).status).toBe(0);

    // Enable MTC integration in a tmp config dir so staging is allowed.
    const mtcConfigDir = path.join(tmpDir, "mtc-config");
    fs.mkdirSync(mtcConfigDir, { recursive: true });
    const enableRes = runCli([
      "crosschain",
      "mtc-config",
      "--config-dir",
      mtcConfigDir,
      "--enable",
      "true",
      "--json",
    ]);
    // mtc-config command may not exist; fall back to env-based enable via
    // direct file write if necessary.
    if (enableRes.status !== 0) {
      const cfgFile = path.join(mtcConfigDir, "cross-chain-mtc", "config.json");
      fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
      fs.writeFileSync(
        cfgFile,
        JSON.stringify(
          {
            enabled: true,
            batch_interval_seconds: 60,
            alg: "ed25519",
            mode: "independent",
            issuer: "mtca:cc:test",
          },
          null,
          2,
        ),
        "utf-8",
      );
    }

    const proposed = extractJson(propose().stdout);
    const consumeRes = runCli([
      "crosschain",
      "bridge-consume",
      proposed.proposalId,
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
      "--mtc",
      "--mtc-config-dir",
      mtcConfigDir,
      "--json",
    ]);
    expect(consumeRes.status, consumeRes.stderr).toBe(0);
    const consumed = extractJson(consumeRes.stdout);
    expect(consumed.status).toBe("consumed");
    expect(consumed.mtc).toBeDefined();
    expect(consumed.mtc.staged).toBe(true);
    expect(consumed.mtc.path).toMatch(/cross-chain-mtc[\\/]staging/);

    // Inspect the staged op JSON — multisig_provenance MUST be carried.
    const stagedRaw = fs.readFileSync(consumed.mtc.path, "utf-8");
    const stagedOp = JSON.parse(stagedRaw);
    expect(stagedOp.bridge_op).toBe("lock");
    expect(stagedOp.src_chain).toBe("ethereum");
    expect(stagedOp.dst_chain).toBe("polygon");
    expect(stagedOp.multisig_provenance).toBeDefined();
    expect(stagedOp.multisig_provenance.proposal_id).toBe(proposed.proposalId);
    expect(stagedOp.multisig_provenance.threshold_m).toBe(1);
    expect(stagedOp.multisig_provenance.member_count_n).toBe(1);
    expect(stagedOp.multisig_provenance.signers).toEqual([members[0].did]);
    expect(stagedOp.multisig_provenance.partial_sigs).toHaveLength(1);
    expect(stagedOp.multisig_provenance.partial_sigs[0].alg).toBe("Ed25519");
  });

  it("Layer 2: bridge-show text output surfaces multisig provenance when present", () => {
    fs.writeFileSync(
      membersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    expect(setPolicy(1).status).toBe(0);
    const proposed = extractJson(propose().stdout);
    const consumed = extractJson(consume(proposed.proposalId).stdout);

    const showRes = runCli(["crosschain", "bridge-show", consumed.bridgeId]);
    expect(showRes.status, showRes.stderr).toBe(0);
    expect(showRes.stdout).toMatch(/Multisig:\s+msp_/);
    expect(showRes.stdout).toMatch(new RegExp(`Signers:\\s+1`));
    expect(showRes.stdout).toMatch(/Sigs:\s+1 partial \(Ed25519\)/);
  });

  it("propose without --initiator → exit 2 missing_initiator", () => {
    expect(setPolicy(2).status).toBe(0);
    const r = runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "100",
      "--require-multisig",
      "--key",
      keyFiles[0],
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
      "--json",
    ]);
    expect(r.status).toBe(2);
    expect(extractJson(r.stdout)).toEqual({
      status: "blocked",
      reason: "missing_initiator",
      path: "multisig",
    });
  });

  it("propose without --key → exit 2 missing_key", () => {
    expect(setPolicy(2).status).toBe(0);
    const r = runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "100",
      "--require-multisig",
      "--initiator",
      members[0].did,
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
      "--json",
    ]);
    expect(r.status).toBe(2);
    expect(extractJson(r.stdout)).toEqual({
      status: "blocked",
      reason: "missing_key",
      path: "multisig",
    });
  });

  it("propose without policy on domain → blocked no_policy", () => {
    const r = propose();
    expect(r.status).toBe(2);
    const out = extractJson(r.stdout);
    expect(out.status).toBe("blocked");
    expect(out.reason).toBe("no_policy");
    expect(out.domain).toBe(DOMAIN);
  });

  it("bridge-consume pending proposal → proposal_state_pending", () => {
    expect(setPolicy(2).status).toBe(0);
    const proposed = extractJson(propose().stdout);
    expect(proposed.reachedThreshold).toBe(false);

    const r = consume(proposed.proposalId);
    expect(r.status).toBe(2);
    expect(extractJson(r.stdout)).toEqual({
      status: "error",
      reason: "proposal_state_pending",
    });
  });

  it("bridge-consume non-existent proposal → proposal_not_found", () => {
    const r = consume("msp_nonexistent_00000000");
    expect(r.status).toBe(2);
    expect(extractJson(r.stdout)).toEqual({
      status: "error",
      reason: "proposal_not_found",
    });
  });

  it("bridge-consume wrong-domain proposal → wrong_domain", () => {
    // Set 1-of-1 policy on a DIFFERENT domain
    const altDomain = "marketplace.purchase";
    const altMembersFile = path.join(tmpDir, "alt-members.json");
    fs.writeFileSync(
      altMembersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    const altPolicy = runCli([
      "multisig",
      "policy",
      "set",
      altDomain,
      "--m",
      "1",
      "--members",
      altMembersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(altPolicy.status).toBe(0);

    // Open a marketplace proposal (different domain)
    const payloadFile = path.join(tmpDir, "alt-payload.json");
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({ itemId: "X", amountFen: 1 }),
      "utf-8",
    );
    const altPropose = runCli([
      "multisig",
      "propose",
      altDomain,
      "--payload-file",
      payloadFile,
      "--initiator",
      members[0].did,
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(altPropose.status, altPropose.stderr).toBe(0);
    const proposalId = extractJson(altPropose.stdout).proposalId;

    // Now try bridge-consume on that wrong-domain proposal
    const r = consume(proposalId);
    expect(r.status).toBe(2);
    const out = extractJson(r.stdout);
    expect(out.status).toBe("error");
    expect(out.reason).toBe("wrong_domain");
    expect(out.expected).toBe(DOMAIN);
    expect(out.actual).toBe(altDomain);
  });

  it("bridge-consume already-consumed proposal → proposal_state_consumed", () => {
    fs.writeFileSync(
      membersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    expect(setPolicy(1).status).toBe(0);
    const proposalId = extractJson(propose().stdout).proposalId;
    expect(consume(proposalId).status).toBe(0);

    const second = consume(proposalId);
    expect(second.status).toBe(2);
    expect(extractJson(second.stdout)).toEqual({
      status: "error",
      reason: "proposal_state_consumed",
    });
  });

  it("non-multisig bridge path still works (regression — no --require-multisig)", () => {
    const r = runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "50",
      "--sender",
      "0xSENDER",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.bridgeId).toBeTruthy();
    expect(out.fee).toBeGreaterThan(0);
    // mtc field is null when --mtc not passed
    expect(out.mtc).toBe(null);
  });

  it("text output (no --json) on successful propose", () => {
    fs.writeFileSync(
      membersFile,
      JSON.stringify([
        {
          did: members[0].did,
          alg: members[0].alg,
          pubkeyJwk: members[0].pubkeyJwk,
        },
      ]),
      "utf-8",
    );
    expect(setPolicy(1).status).toBe(0);
    const r = runCli([
      "crosschain",
      "bridge",
      "ethereum",
      "polygon",
      "100",
      "--require-multisig",
      "--initiator",
      members[0].did,
      "--key",
      keyFiles[0],
      "--multisig-db",
      dbPath,
      "--multisig-log",
      logPath,
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Routed through multisig/);
    expect(r.stdout).toMatch(/threshold reached on first signature/);
    expect(r.stdout).toMatch(/cc crosschain bridge-consume msp_/);
  });
});
