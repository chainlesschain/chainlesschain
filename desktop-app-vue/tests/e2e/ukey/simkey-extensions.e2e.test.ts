/**
 * SIMKey v0.39.0 扩展功能 E2E 测试
 *
 * 验证 6 个新 SIMKey 扩展模块的 IPC 通道可达性与返回格式:
 * - eSIM OTA 远程配置 (simkey-ota:*)
 * - TEE 可信执行环境 (simkey-tee:*)
 * - 跨运营商漫游协议 (simkey-roaming:*)
 * - 零知识证明 (simkey-zkp:*)
 * - 卫星通信 SIM (simkey-sat:*)
 * - HSM 联合认证 (simkey-hsm:*)
 *
 * 测试策略:
 * - 共享单个 Electron 实例（所有 describe 块共用）
 * - 不依赖真实硬件，仅测试模块 API 可达性与响应格式
 * - 每个 API 验证: success 字段、data/error 字段存在
 *
 * 注: 若 IPC 通道未注册，通过 window.evaluate 直接测试模块逻辑
 */

import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
  callIPC,
} from "../helpers/common";

// ─── Shared Electron instance ─────────────────────────────────────────────────

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const ctx = await launchElectronApp();
  app = ctx.app;
  window = ctx.window;
});

test.afterAll(async () => {
  await closeElectronApp(app);
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Assert that an IPC result has the standard envelope shape */
function assertEnvelope(
  result: any,
  opts: { expectSuccess?: boolean } = {},
): void {
  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
  expect(Object.prototype.hasOwnProperty.call(result, "success")).toBe(true);
  expect(typeof result.success).toBe("boolean");
  if (opts.expectSuccess !== undefined) {
    expect(result.success).toBe(opts.expectSuccess);
  }
}

/** Evaluate module functionality directly in main process */
async function evaluateMain<T>(app: ElectronApplication, fn: () => T): Promise<T> {
  return app.evaluate(fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// eSIM OTA Manager (simkey-ota:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("eSIM OTA Manager — module API", () => {
  test("ESimOtaManager can be instantiated and initialized", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { ESimOtaManager } = require("./src/main/ukey/esim-ota-manager.js");
        const mgr = new ESimOtaManager({ smDpAddress: "smdp.test.com" });
        const ok = await mgr.initialize();
        const state = mgr.getState();
        const info = mgr.getEuiccInfo();
        await mgr.close();
        return { ok, state, hasEid: !!info?.eid };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.state).toBe("completed");
    expect(result.hasEid).toBe(true);
  });

  test("ESimOtaManager can deploy a key", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { ESimOtaManager } = require("./src/main/ukey/esim-ota-manager.js");
        const mgr = new ESimOtaManager({});
        await mgr.initialize();
        const deployResult = await mgr.deployKey({
          targetEid: "89049032000001234567",
          keyType: "ec256",
        });
        await mgr.close();
        return deployResult;
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.keyId).toBeDefined();
    expect(result.publicKeyInfo).toBeDefined();
    expect(result.publicKeyInfo.type).toBe("EcdsaSecp256r1VerificationKey2019");
  });

  test("ESimOtaManager can download and list profiles", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { ESimOtaManager } = require("./src/main/ukey/esim-ota-manager.js");
        const mgr = new ESimOtaManager({});
        await mgr.initialize();
        const dl = await mgr.downloadProfile("1$smdp.test.com$MATCH-E2E");
        const profiles = mgr.listProfiles();
        await mgr.close();
        return { downloadSuccess: dl.success, profileCount: profiles.length };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.downloadSuccess).toBe(true);
    expect(result.profileCount).toBeGreaterThan(0);
  });

  test("ESimOtaManager batchDeploy works for multiple targets", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { ESimOtaManager } = require("./src/main/ukey/esim-ota-manager.js");
        const mgr = new ESimOtaManager({ batchSize: 2 });
        await mgr.initialize();
        const batch = await mgr.batchDeploy([
          { targetEid: "EID-E2E-1", keyType: "ec256" },
          { targetEid: "EID-E2E-2", keyType: "ec256" },
        ]);
        await mgr.close();
        return { success: batch.success, total: batch.summary.total, succeeded: batch.summary.succeeded };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEE Integration (simkey-tee:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("TEE Integration — module API", () => {
  test("TeeIntegration can be initialized and returns TEE info", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { TeeIntegration } = require("./src/main/ukey/tee-integration.js");
        const tee = new TeeIntegration({});
        await tee.initialize();
        const info = tee.getTeeInfo();
        await tee.close();
        return { info };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.info.type).toBeDefined();
    expect(result.info.securityLevel).toBeDefined();
    expect(Array.isArray(result.info.capabilities)).toBe(true);
  });

  test("TeeIntegration can generate a key and sign", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { TeeIntegration } = require("./src/main/ukey/tee-integration.js");
        const tee = new TeeIntegration({});
        await tee.initialize();
        const key = await tee.generateKeyInTee({ algorithm: "ec256", requireAuth: false });
        const sig = await tee.signInTee(key.keyId, Buffer.from("hello e2e"));
        await tee.close();
        return {
          keyId: key.keyId,
          algorithm: key.algorithm,
          signSuccess: sig.success,
          hasSignature: !!sig.signature,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.keyId).toMatch(/^tee-/);
    expect(result.algorithm).toBe("ec256");
    expect(result.signSuccess).toBe(true);
    expect(result.hasSignature).toBe(true);
  });

  test("TeeIntegration seal/unseal round-trip works", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { TeeIntegration } = require("./src/main/ukey/tee-integration.js");
        const tee = new TeeIntegration({});
        await tee.initialize();
        const data = { secret: "e2e-test-value", count: 99 };
        const sealed = await tee.sealData(data, "e2e-label");
        const unsealed = await tee.unsealData(sealed);
        const parsed = JSON.parse(unsealed.toString());
        await tee.close();
        return { matches: JSON.stringify(parsed) === JSON.stringify(data) };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.matches).toBe(true);
  });

  test("TeeIntegration remote attestation report is well-formed", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { TeeIntegration } = require("./src/main/ukey/tee-integration.js");
        const tee = new TeeIntegration({});
        await tee.initialize();
        const report = await tee.generateAttestationReport("e2e-nonce");
        const verify = await tee.verifyAttestationReport(report);
        await tee.close();
        return { report, verifyResult: verify };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.report.version).toBe("1.0");
    expect(result.report.nonce).toBe("e2e-nonce");
    expect(result.report.measurements.tamperDetected).toBe(false);
    expect(result.verifyResult.checks.nonceValid).toBe(true);
    expect(result.verifyResult.checks.timestampRecent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIMKey Roaming (simkey-roaming:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("SIMKey Roaming — module API", () => {
  test("SimkeyRoaming initializes and starts in HOME state", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyRoaming } = require("./src/main/ukey/simkey-roaming.js");
        const roaming = new SimkeyRoaming({ signLimitPerDay: 5 });
        await roaming.initialize("cn-mobile");
        const status = roaming.getRoamingStatus();
        await roaming.close();
        return { state: status.state, homeCarrier: status.homeCarrier };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.state).toBe("home");
    expect(result.homeCarrier).toBe("中国移动");
  });

  test("SimkeyRoaming can discover roaming networks", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyRoaming } = require("./src/main/ukey/simkey-roaming.js");
        const roaming = new SimkeyRoaming({});
        await roaming.initialize("cn-mobile");
        const networks = await roaming.discoverRoamingNetworks();
        await roaming.close();
        return { count: networks.length, networks };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.count).toBeGreaterThan(0);
    for (const net of result.networks) {
      expect(net.carrierId).not.toBe("cn-mobile");
    }
  });

  test("SimkeyRoaming can establish and end a roaming session", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyRoaming } = require("./src/main/ukey/simkey-roaming.js");
        const roaming = new SimkeyRoaming({ signLimitPerDay: 5 });
        await roaming.initialize("cn-mobile");
        const session = await roaming.establishRoamingSession("cn-unicom");
        const statusDuring = roaming.getRoamingStatus();
        await roaming.signViaRoaming(Buffer.from("e2e data"));
        const endResult = await roaming.endRoamingSession();
        const statusAfter = roaming.getRoamingStatus();
        await roaming.close();
        return {
          sessionSuccess: session.success,
          stateDuring: statusDuring.state,
          endSuccess: endResult.success,
          stateAfter: statusAfter.state,
          totalSigns: endResult.summary.totalSigns,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.sessionSuccess).toBe(true);
    expect(result.stateDuring).toBe("roaming");
    expect(result.endSuccess).toBe(true);
    expect(result.stateAfter).toBe("home");
    expect(result.totalSigns).toBe(1);
  });

  test("SimkeyRoaming policy can be updated", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyRoaming } = require("./src/main/ukey/simkey-roaming.js");
        const roaming = new SimkeyRoaming({ signLimitPerDay: 10 });
        await roaming.initialize("cn-mobile");
        roaming.updateRoamingPolicy({ signLimitPerDay: 50 });
        const policy = roaming.getRoamingPolicy();
        await roaming.close();
        return { signLimit: policy.signLimitPerDay };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.signLimit).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIMKey ZKP (simkey-zkp:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("SIMKey ZKP — module API", () => {
  test("SimkeyZkp initializes successfully", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyZkp } = require("./src/main/ukey/simkey-zkp.js");
        const zkp = new SimkeyZkp({});
        const ok = await zkp.initialize();
        await zkp.close();
        return { ok };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  test("SimkeyZkp can generate and verify identity proof", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyZkp } = require("./src/main/ukey/simkey-zkp.js");
        const zkp = new SimkeyZkp({});
        await zkp.initialize();
        const mockSign = async (data: Buffer) => ({ signature: Buffer.from("sig").toString("base64") });
        const proof = await zkp.proveIdentity("did:cc:e2e-test", "e2e-challenge", mockSign);
        const verify = await zkp.verifyProof(proof);
        await zkp.close();
        return { proofId: proof.proofId, type: proof.type, verifyValid: verify.valid };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.proofId).toMatch(/^zkp-/);
    expect(result.type).toBe("identity");
    expect(result.verifyValid).toBe(true);
  });

  test("SimkeyZkp age range proof succeeds when condition met", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyZkp } = require("./src/main/ukey/simkey-zkp.js");
        const zkp = new SimkeyZkp({});
        await zkp.initialize();
        const mockSign = async () => "sig-e2e";
        const proof = await zkp.proveAgeRange(25, 18, mockSign);
        await zkp.close();
        return { success: proof.success, type: proof.proof?.type };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.type).toBe("age_range");
  });

  test("SimkeyZkp age range proof fails when age < threshold", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyZkp } = require("./src/main/ukey/simkey-zkp.js");
        const zkp = new SimkeyZkp({});
        await zkp.initialize();
        const mockSign = async () => "sig";
        const proof = await zkp.proveAgeRange(16, 18, mockSign);
        await zkp.close();
        return { success: proof.success, error: proof.error };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.error).toContain("年龄不满足条件");
  });

  test("SimkeyZkp selective disclosure reveals only specified fields", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SimkeyZkp } = require("./src/main/ukey/simkey-zkp.js");
        const zkp = new SimkeyZkp({});
        await zkp.initialize();
        const mockSign = async () => "sig";
        const cred = {
          credentialSubject: { name: "张三", degree: "硕士", gpa: "3.8" }
        };
        const disc = await zkp.selectiveDisclose(cred, ["degree"], mockSign);
        await zkp.close();
        return {
          success: disc.success,
          hasDegreee: disc.proof?.disclosedView?.degree === "硕士",
          hasName: "name" in (disc.proof?.disclosedView || {}),
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.hasDegreee).toBe(true);
    expect(result.hasName).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Satellite SIM Driver (simkey-sat:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Satellite SIM Driver — module API", () => {
  test("SatelliteSimDriver initializes and provides status", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SatelliteSimDriver } = require("./src/main/ukey/satellite-sim-driver.js");
        const driver = new SatelliteSimDriver({ beidouEnabled: true });
        await driver.initialize();
        const status = driver.getStatus();
        await driver.close();
        return { status };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.status.linkState).toBeDefined();
    expect(result.status.transportMode).toBeDefined();
    expect(result.status.satelliteInfo.detected).toBe(true);
  });

  test("SatelliteSimDriver can sign data", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SatelliteSimDriver } = require("./src/main/ukey/satellite-sim-driver.js");
        const driver = new SatelliteSimDriver({});
        await driver.initialize();
        const sig = await driver.sign(Buffer.from("e2e sign test"));
        await driver.close();
        return { success: sig.success, transport: sig.transport };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.transport).toBeDefined();
  });

  test("SatelliteSimDriver batch sign returns merkle root", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SatelliteSimDriver } = require("./src/main/ukey/satellite-sim-driver.js");
        const driver = new SatelliteSimDriver({});
        await driver.initialize();
        const batch = await driver.batchSign(["item1", "item2", "item3"]);
        await driver.close();
        return {
          success: batch.success,
          hasMerkleRoot: !!batch.merkleRoot,
          itemCount: batch.items.length,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.hasMerkleRoot).toBe(true);
    expect(result.itemCount).toBe(3);
  });

  test("SatelliteSimDriver can switch transport modes", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SatelliteSimDriver, TRANSPORT_MODE } = require("./src/main/ukey/satellite-sim-driver.js");
        const driver = new SatelliteSimDriver({});
        await driver.initialize();
        await driver.switchTransportMode(TRANSPORT_MODE.TERRESTRIAL);
        const status = driver.getStatus();
        await driver.close();
        return { mode: status.transportMode };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.mode).toBe("terrestrial");
  });

  test("SatelliteSimDriver Beidou SMS signing works", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { SatelliteSimDriver } = require("./src/main/ukey/satellite-sim-driver.js");
        const driver = new SatelliteSimDriver({ beidouEnabled: true });
        await driver.initialize();
        const r = await driver.signViaBeidouSMS("e2e-beidou-data");
        await driver.close();
        return { success: r.success, transport: r.transport };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.transport).toBe("beidou_sms");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HSM Federation (simkey-hsm:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("HSM Federation — module API", () => {
  test("HsmFederation initializes with a default software HSM", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { HsmFederation } = require("./src/main/ukey/hsm-federation.js");
        const fed = new HsmFederation({ auditEnabled: false });
        await fed.initialize();
        const hsms = fed.listHSMs();
        const activeHsm = hsms.find((h: any) => h.isActive);
        await fed.close();
        return { hsmCount: hsms.length, hasActive: !!activeHsm, activeType: activeHsm?.type };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.hsmCount).toBeGreaterThanOrEqual(1);
    expect(result.hasActive).toBe(true);
    expect(result.activeType).toBe("software_hsm");
  });

  test("HsmFederation can register a custom HSM", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { HsmFederation, HSM_TYPE } = require("./src/main/ukey/hsm-federation.js");
        const fed = new HsmFederation({ auditEnabled: false });
        await fed.initialize();
        const reg = await fed.registerHSM({
          id: "e2e-test-hsm",
          type: HSM_TYPE.THALES_LUNA,
          name: "E2E Test HSM",
          endpoint: "hsm.e2e.test:1792",
        });
        const hsms = fed.listHSMs();
        await fed.close();
        return { success: reg.success, hsmCount: hsms.length };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.hsmCount).toBeGreaterThanOrEqual(2);
  });

  test("HsmFederation can generate key shares and co-sign", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { HsmFederation, COSIGN_MODE, APPROVAL_POLICY } = require("./src/main/ukey/hsm-federation.js");
        const fed = new HsmFederation({
          approvalPolicy: APPROVAL_POLICY.NONE,
          auditEnabled: false,
        });
        await fed.initialize();

        await fed.generateKeyShares("e2e-key", COSIGN_MODE.THRESHOLD_2_OF_2);

        const mockSign = async () => ({ signature: Buffer.from("simkey-sig").toString("base64") });
        const cosign = await fed.coSign("e2e-key", Buffer.from("e2e tx"), mockSign, {});
        await fed.close();
        return {
          success: cosign.success,
          hasSimkeySig: !!cosign.simkeySignature,
          hasHsmSig: !!cosign.hsmSignature,
          hasCombined: !!cosign.combinedSignature,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.hasSimkeySig).toBe(true);
    expect(result.hasHsmSig).toBe(true);
    expect(result.hasCombined).toBe(true);
  });

  test("HsmFederation audit log captures operations", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { HsmFederation } = require("./src/main/ukey/hsm-federation.js");
        const fed = new HsmFederation({ auditEnabled: true });
        await fed.initialize();
        await fed.hsmSign(Buffer.from("audit-e2e-data"));
        const log = fed.getAuditLog();
        await fed.close();
        return { total: log.total, hasHsmSign: log.items.some((i: any) => i.action === "hsm_sign") };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.total).toBeGreaterThan(0);
    expect(result.hasHsmSign).toBe(true);
  });

  test("HsmFederation failover finds backup HSM", async () => {
    const result = await app.evaluate(async () => {
      try {
        const { HsmFederation, HSM_TYPE } = require("./src/main/ukey/hsm-federation.js");
        const fed = new HsmFederation({ failoverEnabled: true, auditEnabled: false });
        await fed.initialize();
        await fed.registerHSM({ id: "backup-e2e", type: HSM_TYPE.AWS_CLOUDHSM, name: "Backup" });
        const fo = await fed.failover();
        await fed.close();
        return { success: fo.success, newActive: fo.newActiveHsm };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.newActive).toBe("backup-e2e");
  });
});
