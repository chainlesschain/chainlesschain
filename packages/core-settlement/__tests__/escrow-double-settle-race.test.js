import { describe, it, expect } from "vitest";

/**
 * 跨连接 TOCTOU 双花复现：escrow 的 release/refund 在事务外读 hold.status，
 * 若内层结算 UPDATE 不带 status 条件，则两个并发结算（不同 DB 连接）可能都读到
 * 'held' 各自放款 = double-settle。关键放大器：custodian 为「多笔 hold」共持资金时，
 * ledger 的余额检查挡不住——第二次放款会盗用其它 hold 的押款。
 *
 * 忠实复现需要文件级 SQLite（两连接共享同一文件）→ better-sqlite3。若该 native
 * 模块在本机/CI 加载失败（ABI 不匹配），整文件跳过；功能正确性由 sql.js 主套件覆盖。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { createEscrow } = require("../lib/escrow.js");
const { signEntry } = require("../lib/signing.js");
const { makeMember } = require("./helpers/fixtures.js");

let Database = null;
try {
  Database = require("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close(); // 确认 native ABI 真能加载（require 成功 ≠ ABI 匹配）
} catch {
  Database = null;
}
const d = Database ? describe : describe.skip;

const LEDGER_ID = "fed-1";

function buyerFund(buyer, custodianDid, amount, nonce) {
  const core = { ledgerId: LEDGER_ID, kind: "transfer", from: buyer.did, to: custodianDid, amount, nonce };
  return { nonce, alg: buyer.alg, sig: signEntry(core, buyer.secretKey) };
}

d("escrow — cross-connection TOCTOU double-settle (status gate must be a CAS)", () => {
  it("a concurrent release committing mid-settle cannot double-pay nor steal another hold's funds", () => {
    const file = path.join(os.tmpdir(), `cc-escrow-race-${crypto.randomUUID()}.db`);
    const connA = new Database(file);
    const connB = new Database(file);
    connA.pragma("busy_timeout = 2000");
    connB.pragma("busy_timeout = 2000");
    try {
      // 用 connA 建库 + 注册成员 + 给两个买家各 mint 资金。
      applySchema(connA);
      const genesis = makeMember("did:cc:genesis");
      const ledgerA = createLedger(connA, { ledgerId: LEDGER_ID, genesisDid: genesis.did });
      ledgerA.registerMember(genesis);
      const buyer1 = makeMember("did:cc:buyer1");
      const buyer2 = makeMember("did:cc:buyer2");
      const seller = makeMember("did:cc:seller");
      const custodian = makeMember("did:cc:custodian");
      [buyer1, buyer2, seller, custodian].forEach((m) => ledgerA.registerMember(m));
      ledgerA.signAndMint({ to: buyer1.did, amount: 300, secretKey: genesis.secretKey });
      ledgerA.signAndMint({ to: buyer2.did, amount: 300, secretKey: genesis.secretKey });

      const escrowA = createEscrow(connA, ledgerA, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
      // 两笔 hold 各押 300 → custodian 持 600（关键：有「别的 hold 的钱」可被盗）。
      const h1 = escrowA.openHold({ orderId: "o1", buyer: buyer1.did, seller: seller.did, amount: 300, fund: buyerFund(buyer1, custodian.did, 300, "f1") });
      const h2 = escrowA.openHold({ orderId: "o2", buyer: buyer2.did, seller: seller.did, amount: 300, fund: buyerFund(buyer2, custodian.did, 300, "f2") });
      expect(h1.ok && h2.ok).toBe(true);
      expect(ledgerA.balanceOf(custodian.did)).toBe(600);

      // connB 上另起一套独立连接，要 release h1。
      const ledgerB = createLedger(connB, { ledgerId: LEDGER_ID, genesisDid: genesis.did });
      const escrowB = createEscrow(connB, ledgerB, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });

      // 制造 TOCTOU：escrowB.release(h1) 的外层 status 检查读到 'held'；就在它放款转账
      // 之前（此刻 B 的事务尚未持锁），让 connA 上一笔 release(h1) 抢先提交（status→
      // released，custodian→seller 300）。此后 B 仍会做它那笔 custodian→seller 转账
      //（custodian 此刻仍有 300 = h2 的钱，余额检查放行！），唯有条件 UPDATE 的 CAS
      // 能识破 status 已非 'held' 并回滚 B 的转账。
      let raced = false;
      const realSign = ledgerB.signAndTransfer.bind(ledgerB);
      ledgerB.signAndTransfer = (args) => {
        if (!raced) {
          raced = true;
          const ra = escrowA.release(h1.holdId);
          expect(ra.ok).toBe(true); // A 抢先放款成功并提交
        }
        return realSign(args);
      };

      const rb = escrowB.release(h1.holdId);
      // B 是竞态输家：条件 UPDATE 命中 0 行 → 抛错 → _atomic ROLLBACK TO 撤回 B 的转账。
      expect(rb.ok).toBe(false);
      expect(rb.reason).toContain("tx_failed");

      // 权威态（从 connA 读）：seller 只被付一次 300（非 600）；h2 的 300 仍在 custodian
      // 手里（没被盗）；h1=released、h2=held。
      expect(ledgerA.balanceOf(seller.did)).toBe(300);
      expect(ledgerA.balanceOf(custodian.did)).toBe(300);
      expect(escrowA.getHold(h1.holdId).status).toBe("released");
      expect(escrowA.getHold(h2.holdId).status).toBe("held");
      // h2 资金完好 → 仍可正常放款；此后 seller 才到 600（两笔各一次）。
      const r2 = escrowA.release(h2.holdId);
      expect(r2.ok).toBe(true);
      expect(ledgerA.balanceOf(seller.did)).toBe(600);
      expect(ledgerA.balanceOf(custodian.did)).toBe(0);
      expect(ledgerA.verifyChain()).toMatchObject({ ok: true });
    } finally {
      connA.close();
      connB.close();
      for (const suf of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(file + suf);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });
});
