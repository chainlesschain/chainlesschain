/**
 * v1.2 m-of-n Phase 1d — `cc multisig` CLI integration tests.
 *
 * 走 subprocess 跑 bin/chainlesschain.js，验：
 *   - help 列出 subcommands
 *   - policy set + propose + sign + show + list + cancel + finalize + sweep 端到端
 *   - --json 输出形状稳定
 *   - 失败路径 (无 policy / 错 signer / 错 key) 有清晰错误
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ed25519 as nobleEd25519 } from "@noble/curves/ed25519";
import ed25519Signer from "@chainlesschain/core-mtc/signers/ed25519";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

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
  const sk = Buffer.from(nobleEd25519.utils.randomPrivateKey());
  const pk = Buffer.from(nobleEd25519.getPublicKey(sk));
  return {
    did: `did:cc:test-${idx}`,
    alg: "Ed25519",
    pubkeyJwk: ed25519Signer.makeJwk(pk),
    secretKey: sk,
  };
}

describe("cc multisig — CLI integration", () => {
  let tmpDir;
  let dbPath;
  let logPath;
  let payloadFile;
  let membersFile;
  let keyFiles;
  let members;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-multisig-cli-"));
    dbPath = path.join(tmpDir, "multisig.db");
    logPath = path.join(tmpDir, "governance.log");
    payloadFile = path.join(tmpDir, "payload.json");
    membersFile = path.join(tmpDir, "members.json");
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({ orderId: "o-1", total: "1500" }),
      "utf-8",
    );
    members = [genKeyPair(0), genKeyPair(1), genKeyPair(2)];
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

  it("multisig --help lists all subcommands", () => {
    const r = runCli(["multisig", "--help"]);
    expect(r.status, r.stderr).toBe(0);
    for (const sub of [
      "propose",
      "sign",
      "cancel",
      "finalize",
      "list",
      "show",
      "sweep",
      "policy",
    ]) {
      expect(r.stdout).toContain(sub);
    }
  });

  it("policy set + show roundtrip — 2-of-3", () => {
    const setRes = runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(setRes.status, setRes.stderr).toBe(0);
    const setOut = extractJson(setRes.stdout);
    expect(setOut.ok).toBe(true);
    expect(setOut.m).toBe(2);
    expect(setOut.n).toBe(3);

    const showRes = runCli([
      "multisig",
      "policy",
      "show",
      "marketplace.purchase",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(showRes.status, showRes.stderr).toBe(0);
    const shown = extractJson(showRes.stdout);
    expect(shown.m).toBe(2);
    expect(shown.members).toHaveLength(3);
  });

  it("propose requires a policy", () => {
    const r = runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("No policy");
  });

  it("end-to-end: policy set + propose + sign 2nd + finalize", () => {
    // policy set 2-of-3
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);

    // propose by member 0
    const proposeRes = runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    expect(proposeRes.status, proposeRes.stderr).toBe(0);
    const proposed = extractJson(proposeRes.stdout);
    expect(proposed.proposalId).toMatch(/^msp_/);
    expect(proposed.reachedThreshold).toBe(false);

    // sign by member 1 → threshold reached
    const signRes = runCli([
      "multisig",
      "sign",
      proposed.proposalId,
      "--signer",
      members[1].did,
      "--key",
      keyFiles[1],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(signRes.status, signRes.stderr).toBe(0);
    const signOut = extractJson(signRes.stdout);
    expect(signOut.accepted).toBe(true);
    expect(signOut.reachedThreshold).toBe(true);

    // finalize
    const finalRes = runCli([
      "multisig",
      "finalize",
      proposed.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(finalRes.status, finalRes.stderr).toBe(0);

    // show → state=consumed
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
    expect(showRes.status, showRes.stderr).toBe(0);
    const detail = extractJson(showRes.stdout);
    expect(detail.proposal.state).toBe("consumed");
    expect(detail.signatures).toHaveLength(2);

    // governance log accumulated events
    const logRaw = fs.readFileSync(logPath, "utf-8");
    expect(logRaw).toContain('"proposed"');
    expect(logRaw).toContain('"signed"');
    expect(logRaw).toContain('"reached"');
    expect(logRaw).toContain('"consumed"');
  });

  it("sign rejects duplicate signer", () => {
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const proposeRes = runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    const proposed = extractJson(proposeRes.stdout);

    const r = runCli([
      "multisig",
      "sign",
      proposed.proposalId,
      "--signer",
      members[0].did, // already signed
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(r.status).not.toBe(0);
    const out = extractJson(r.stdout);
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("duplicate_signer");
  });

  it("cancel pending proposal", () => {
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const proposeRes = runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    const proposed = extractJson(proposeRes.stdout);

    const cancelRes = runCli([
      "multisig",
      "cancel",
      proposed.proposalId,
      "--reason",
      "test cancel",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(cancelRes.status, cancelRes.stderr).toBe(0);
    const out = extractJson(cancelRes.stdout);
    expect(out.ok).toBe(true);

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
    expect(detail.proposal.state).toBe("cancelled");
  });

  it("list filters by state and domain", () => {
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    runCli([
      "multisig",
      "policy",
      "set",
      "did.rotate",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    runCli([
      "multisig",
      "propose",
      "did.rotate",
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
    const listRes = runCli([
      "multisig",
      "list",
      "--domain",
      "marketplace.purchase",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(listRes.status, listRes.stderr).toBe(0);
    const list = extractJson(listRes.stdout);
    expect(list).toHaveLength(1);
    expect(list[0].domain).toBe("marketplace.purchase");
  });

  it("show output (non-JSON) includes payload and sigs", () => {
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "1",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const proposeRes = runCli([
      "multisig",
      "propose",
      "marketplace.purchase",
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
    const proposed = extractJson(proposeRes.stdout);

    const r = runCli([
      "multisig",
      "show",
      proposed.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Payload");
    expect(r.stdout).toContain("Signatures");
    expect(r.stdout).toContain(members[0].did);
  });

  it("policy set rejects invalid m > n", () => {
    const r = runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "5",
      "--members",
      membersFile, // m=5 but n=3
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/m must be ≤ n|RangeError/i);
  });

  it("sweep with no expired returns 0", () => {
    runCli([
      "multisig",
      "policy",
      "set",
      "marketplace.purchase",
      "--m",
      "2",
      "--members",
      membersFile,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const r = runCli([
      "multisig",
      "sweep",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.expired).toBe(0);
  });
});
