/**
 * v1.2 m-of-n Phase 2 — marketplace.purchase 2-of-2 E2E。
 *
 * 设计文档 §10 Phase 2 验收：「2-of-2 走完一笔 ¥1500 购买」。
 *
 * 端到端 path:
 *   1. cc multisig policy set marketplace.purchase --m 2 --members <2 dids>
 *   2. cc marketplace purchase --amount-fen 150000 --buyer A --key A.hex → proposalId
 *   3. cc multisig sign <proposalId> --signer B --key B.hex → reachedThreshold=true
 *   4. cc marketplace consume <proposalId> → state=consumed + order printed
 *   5. governance log has proposed/signed×2/reached/consumed events
 *
 * 反路径:
 *   - small order (¥500) below threshold → direct path, no multisig propose
 *   - large order without policy → blocked with exit code 2
 *   - consume on pending proposal → error
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ed25519 as nobleEd25519 } from "@noble/curves/ed25519.js";
import ed25519Signer from "@chainlesschain/core-mtc/signers/ed25519";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");
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
    did: `did:cc:test-buyer-${idx}`,
    alg: "Ed25519",
    pubkeyJwk: ed25519Signer.makeJwk(pk),
    secretKey: sk,
  };
}

describe("cc marketplace + multisig — Phase 2 E2E (2-of-2 ¥1500)", () => {
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
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mp-multisig-e2e-"));
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

  it("¥1500 large order: policy set → purchase → sign → consume", () => {
    // 1) Set 2-of-2 policy
    const policyRes = runCli([
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
    expect(policyRes.status, policyRes.stderr).toBe(0);

    // 2) Purchase ¥1500 (= 150000 fen) routes through multisig
    const purchaseRes = runCli([
      "marketplace",
      "purchase",
      "item-premium-001",
      "--amount-fen",
      "150000",
      "--buyer",
      members[0].did,
      "--key",
      keyFiles[0],
      "--item-name",
      "Premium AI Bundle",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(purchaseRes.status, purchaseRes.stderr).toBe(0);
    const purchased = extractJson(purchaseRes.stdout);
    expect(purchased.status).toBe("needs_co_sign");
    expect(purchased.path).toBe("multisig");
    expect(purchased.proposalId).toMatch(/^msp_/);
    expect(purchased.reachedThreshold).toBe(false);
    expect(purchased.requiredSigs).toBe(2);
    expect(purchased.amountFen).toBe(150000);

    // 3) Co-signer (member 1) signs → reaches threshold
    const signRes = runCli([
      "multisig",
      "sign",
      purchased.proposalId,
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

    // 4) Consume → state=consumed + payload echoed back
    const consumeRes = runCli([
      "marketplace",
      "consume",
      purchased.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(consumeRes.status, consumeRes.stderr).toBe(0);
    const consumed = extractJson(consumeRes.stdout);
    expect(consumed.status).toBe("consumed");
    expect(consumed.order.itemId).toBe("item-premium-001");
    expect(consumed.order.amountFen).toBe(150000);
    expect(consumed.order.buyer).toBe(members[0].did);
    expect(consumed.order.itemName).toBe("Premium AI Bundle");

    // 5) Show proposal — state=consumed
    const showRes = runCli([
      "multisig",
      "show",
      purchased.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const detail = extractJson(showRes.stdout);
    expect(detail.proposal.state).toBe("consumed");
    expect(detail.signatures).toHaveLength(2);

    // 6) governance log has all transitions
    const logRaw = fs.readFileSync(logPath, "utf-8");
    expect(logRaw).toContain('"proposed"');
    expect(logRaw).toContain('"reached"');
    expect(logRaw).toContain('"consumed"');
    expect((logRaw.match(/"signed"/g) || []).length).toBe(2);
    // Heavy multi-process flow — policy/purchase/sign/consume spawns many
    // sequential CLI cold-starts; the 60s default is tight under the integration
    // load (flakes under load, passes isolated). See internal handbook trap #31.
  }, 90000);

  it("small order (¥500) below threshold: direct path, no multisig", () => {
    const purchaseRes = runCli([
      "marketplace",
      "purchase",
      "item-snack",
      "--amount-fen",
      "50000", // ¥500 < ¥1000 default threshold
      "--buyer",
      members[0].did,
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(purchaseRes.status, purchaseRes.stderr).toBe(0);
    const out = extractJson(purchaseRes.stdout);
    expect(out.status).toBe("purchased");
    expect(out.path).toBe("direct");

    // No proposal should have been created
    const listRes = runCli([
      "multisig",
      "list",
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const list = extractJson(listRes.stdout);
    expect(list).toEqual([]);
  });

  it("--threshold-fen override: order below ¥1000 default but above override → multisig", () => {
    // Set policy first
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

    const purchaseRes = runCli([
      "marketplace",
      "purchase",
      "item-coffee",
      "--amount-fen",
      "1000", // ¥10
      "--threshold-fen",
      "500", // override down to ¥5
      "--buyer",
      members[0].did,
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(purchaseRes.status, purchaseRes.stderr).toBe(0);
    const out = extractJson(purchaseRes.stdout);
    expect(out.status).toBe("needs_co_sign");
    expect(out.path).toBe("multisig");
  });

  it("large order WITHOUT policy → blocked with exit 2", () => {
    const purchaseRes = runCli([
      "marketplace",
      "purchase",
      "item-big",
      "--amount-fen",
      "200000", // ¥2000, no policy
      "--buyer",
      members[0].did,
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(purchaseRes.status).toBe(2);
    const out = extractJson(purchaseRes.stdout);
    expect(out.status).toBe("blocked");
    expect(out.reason).toBe("no_policy");
  });

  it("consume on pending proposal (not reached) → error proposal_state_pending", () => {
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
    const purchaseRes = runCli([
      "marketplace",
      "purchase",
      "item-x",
      "--amount-fen",
      "150000",
      "--buyer",
      members[0].did,
      "--key",
      keyFiles[0],
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    const purchased = extractJson(purchaseRes.stdout);

    // Don't sign — try to consume directly
    const consumeRes = runCli([
      "marketplace",
      "consume",
      purchased.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(consumeRes.status).toBe(2);
    const out = extractJson(consumeRes.stdout);
    expect(out.status).toBe("error");
    expect(out.reason).toBe("proposal_state_pending");
  });

  it("consume rejects proposal from wrong domain", () => {
    // Set policy for different domain
    runCli([
      "multisig",
      "policy",
      "set",
      "did.rotate",
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
    const payloadFile = path.join(tmpDir, "did-payload.json");
    fs.writeFileSync(payloadFile, JSON.stringify({ did: "did:cc:foo" }));
    // Propose under did.rotate domain (1-of-2, will reach instantly)
    const proposeRes = runCli([
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
    const proposed = extractJson(proposeRes.stdout);

    const consumeRes = runCli([
      "marketplace",
      "consume",
      proposed.proposalId,
      "--db",
      dbPath,
      "--log",
      logPath,
      "--json",
    ]);
    expect(consumeRes.status).toBe(2);
    const out = extractJson(consumeRes.stdout);
    expect(out.status).toBe("error");
    expect(out.reason).toBe("wrong_domain");
  });

  it("purchase --help mentions multisig routing", () => {
    const r = runCli(["marketplace", "purchase", "--help"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/multisig|threshold|amount/i);
  });

  it("consume --help mentions reached state requirement", () => {
    const r = runCli(["marketplace", "consume", "--help"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/multisig|consume|proposal/i);
  });
});
