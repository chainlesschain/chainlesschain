import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  TRUST_ANCHOR,
  ATTESTATION_STATUS,
  SATELLITE_PROVIDER,
  SAT_MESSAGE_STATUS,
  HSM_VENDOR,
  COMPLIANCE_LEVEL,
  ensureTrustSecurityTables,
  attest,
  getAttestation,
  listAttestations,
  runInteropTest,
  listInteropTests,
  sendSatelliteMessage,
  updateSatMessageStatus,
  getSatMessage,
  listSatMessages,
  registerHsmDevice,
  removeHsmDevice,
  getHsmDevice,
  listHsmDevices,
  signWithHsm,
  getTrustSecurityStats,
  _resetState,
} from "../../src/lib/trust-security.js";

describe("trust-security", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureTrustSecurityTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureTrustSecurityTables", () => {
    it("creates all four tables", () => {
      expect(db.tables.has("trust_attestations")).toBe(true);
      expect(db.tables.has("pqc_interop_tests")).toBe(true);
      expect(db.tables.has("satellite_messages")).toBe(true);
      expect(db.tables.has("hsm_devices")).toBe(true);
    });

    it("is idempotent", () => {
      ensureTrustSecurityTables(db);
      expect(db.tables.has("trust_attestations")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 3 trust anchors", () => {
      expect(Object.keys(TRUST_ANCHOR)).toHaveLength(3);
    });

    it("has 4 attestation statuses", () => {
      expect(Object.keys(ATTESTATION_STATUS)).toHaveLength(4);
    });

    it("has 3 satellite providers", () => {
      expect(Object.keys(SATELLITE_PROVIDER)).toHaveLength(3);
    });

    it("has 4 HSM vendors", () => {
      expect(Object.keys(HSM_VENDOR)).toHaveLength(4);
    });

    it("has 3 compliance levels", () => {
      expect(Object.keys(COMPLIANCE_LEVEL)).toHaveLength(3);
    });
  });

  /* ── Phase 68: Trust Attestation ──────────────────── */

  describe("attest", () => {
    it("creates attestation with TPM anchor", () => {
      const r = attest(db, { anchor: "tpm" });
      expect(r.attestationId).toBeTruthy();
      expect(r.status).toBe("valid");
      expect(r.response).toHaveLength(32);
    });

    it("accepts custom challenge", () => {
      const r = attest(db, { anchor: "tee", challenge: "abc123" });
      const a = getAttestation(db, r.attestationId);
      expect(a.challenge).toBe("abc123");
      expect(a.anchor).toBe("tee");
    });

    it("stores device fingerprint", () => {
      const r = attest(db, {
        anchor: "secure_element",
        deviceFingerprint: "fp-hash",
      });
      const a = getAttestation(db, r.attestationId);
      expect(a.device_fingerprint).toBe("fp-hash");
    });

    it("rejects invalid anchor", () => {
      const r = attest(db, { anchor: "usb" });
      expect(r.attestationId).toBeNull();
      expect(r.reason).toBe("invalid_anchor");
    });
  });

  describe("listAttestations", () => {
    it("lists all attestations", () => {
      attest(db, { anchor: "tpm" });
      attest(db, { anchor: "tee" });
      expect(listAttestations(db)).toHaveLength(2);
    });

    it("filters by anchor", () => {
      attest(db, { anchor: "tpm" });
      attest(db, { anchor: "tee" });
      expect(listAttestations(db, { anchor: "tpm" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getAttestation(db, "nope")).toBeNull();
    });
  });

  /* ── Phase 69: PQC Interop ───────────────────────── */

  describe("runInteropTest", () => {
    it("passes for supported algorithm", () => {
      const r = runInteropTest(db, "ml-kem-768");
      expect(r.testId).toBeTruthy();
      expect(r.compatible).toBe(true);
      expect(r.result).toBe("pass");
    });

    it("fails for unsupported algorithm", () => {
      const r = runInteropTest(db, "rsa-2048");
      expect(r.compatible).toBe(false);
      expect(r.result).toBe("unsupported");
    });

    it("records peer and latency", () => {
      const r = runInteropTest(db, "ml-dsa-65", {
        peer: "node-42",
        latencyMs: 25,
      });
      expect(r.latencyMs).toBe(25);
    });

    it("rejects missing algorithm", () => {
      const r = runInteropTest(db, "");
      expect(r.testId).toBeNull();
    });
  });

  describe("listInteropTests", () => {
    it("lists with algorithm filter", () => {
      runInteropTest(db, "ml-kem-768");
      runInteropTest(db, "ml-dsa-65");
      runInteropTest(db, "ml-kem-768");
      expect(listInteropTests(db)).toHaveLength(3);
      expect(listInteropTests(db, { algorithm: "ml-kem-768" })).toHaveLength(2);
    });
  });

  /* ── Phase 70: Satellite Messages ────────────────── */

  describe("sendSatelliteMessage", () => {
    it("queues a message", () => {
      const r = sendSatelliteMessage(db, "revoke-key-xyz");
      expect(r.messageId).toBeTruthy();
      const m = getSatMessage(db, r.messageId);
      expect(m.status).toBe("queued");
      expect(m.provider).toBe("iridium");
    });

    it("accepts custom provider", () => {
      const r = sendSatelliteMessage(db, "data", { provider: "starlink" });
      expect(getSatMessage(db, r.messageId).provider).toBe("starlink");
    });

    it("rejects invalid provider", () => {
      const r = sendSatelliteMessage(db, "data", { provider: "gps" });
      expect(r.messageId).toBeNull();
      expect(r.reason).toBe("invalid_provider");
    });

    it("rejects empty payload", () => {
      const r = sendSatelliteMessage(db, "");
      expect(r.messageId).toBeNull();
    });
  });

  describe("updateSatMessageStatus", () => {
    it("transitions queued → sent → confirmed", () => {
      const { messageId } = sendSatelliteMessage(db, "test");
      updateSatMessageStatus(db, messageId, "sent");
      expect(getSatMessage(db, messageId).sent_at).toBeTruthy();
      updateSatMessageStatus(db, messageId, "confirmed");
      const m = getSatMessage(db, messageId);
      expect(m.status).toBe("confirmed");
      expect(m.confirmed_at).toBeTruthy();
    });

    it("rejects invalid transition", () => {
      const { messageId } = sendSatelliteMessage(db, "test");
      const r = updateSatMessageStatus(db, messageId, "confirmed");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_transition");
    });

    it("supports retry (failed → queued)", () => {
      const { messageId } = sendSatelliteMessage(db, "test");
      updateSatMessageStatus(db, messageId, "failed");
      const r = updateSatMessageStatus(db, messageId, "queued");
      expect(r.updated).toBe(true);
    });
  });

  describe("listSatMessages", () => {
    it("lists with filters", () => {
      sendSatelliteMessage(db, "a", { provider: "iridium" });
      sendSatelliteMessage(db, "b", { provider: "starlink" });
      expect(listSatMessages(db)).toHaveLength(2);
      expect(listSatMessages(db, { provider: "starlink" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getSatMessage(db, "nope")).toBeNull();
    });
  });

  /* ── Phase 71: HSM Devices ───────────────────────── */

  describe("registerHsmDevice", () => {
    it("registers a device", () => {
      const r = registerHsmDevice(db, "yubikey", {
        model: "YubiKey 5",
        serialNumber: "SN-123",
        complianceLevel: "fips_140_3",
        firmwareVersion: "5.4.3",
      });
      expect(r.deviceId).toBeTruthy();
      const d = getHsmDevice(db, r.deviceId);
      expect(d.vendor).toBe("yubikey");
      expect(d.model).toBe("YubiKey 5");
      expect(d.compliance_level).toBe("fips_140_3");
    });

    it("rejects invalid vendor", () => {
      const r = registerHsmDevice(db, "nitrokey");
      expect(r.deviceId).toBeNull();
      expect(r.reason).toBe("invalid_vendor");
    });
  });

  describe("removeHsmDevice", () => {
    it("removes a device", () => {
      const { deviceId } = registerHsmDevice(db, "ledger");
      const r = removeHsmDevice(db, deviceId);
      expect(r.removed).toBe(true);
      expect(getHsmDevice(db, deviceId)).toBeNull();
    });

    it("rejects unknown device", () => {
      const r = removeHsmDevice(db, "nope");
      expect(r.removed).toBe(false);
    });
  });

  describe("listHsmDevices", () => {
    it("lists with vendor filter", () => {
      registerHsmDevice(db, "yubikey");
      registerHsmDevice(db, "ledger");
      registerHsmDevice(db, "yubikey");
      expect(listHsmDevices(db)).toHaveLength(3);
      expect(listHsmDevices(db, { vendor: "yubikey" })).toHaveLength(2);
    });
  });

  describe("signWithHsm", () => {
    it("produces signature", () => {
      const { deviceId } = registerHsmDevice(db, "yubikey");
      const r = signWithHsm(db, deviceId, { data: "hello" });
      expect(r.signature).toBeTruthy();
      expect(r.algorithm).toBe("ecdsa-p256");
    });

    it("accepts custom algorithm", () => {
      const { deviceId } = registerHsmDevice(db, "ledger");
      const r = signWithHsm(db, deviceId, {
        data: "test",
        algorithm: "ed25519",
      });
      expect(r.algorithm).toBe("ed25519");
    });

    it("rejects unknown device", () => {
      const r = signWithHsm(db, "nope", { data: "test" });
      expect(r.signature).toBeNull();
      expect(r.reason).toBe("device_not_found");
    });

    it("rejects missing data", () => {
      const { deviceId } = registerHsmDevice(db, "trezor");
      const r = signWithHsm(db, deviceId, {});
      expect(r.signature).toBeNull();
      expect(r.reason).toBe("missing_data");
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getTrustSecurityStats", () => {
    it("returns zeros when empty", () => {
      const s = getTrustSecurityStats(db);
      expect(s.attestations.total).toBe(0);
      expect(s.interopTests.total).toBe(0);
      expect(s.satellite.total).toBe(0);
      expect(s.hsm.total).toBe(0);
    });

    it("computes correct stats", () => {
      attest(db, { anchor: "tpm" });
      attest(db, { anchor: "tee" });
      runInteropTest(db, "ml-kem-768", { latencyMs: 10 });
      runInteropTest(db, "rsa-2048", { latencyMs: 20 });
      sendSatelliteMessage(db, "msg1");
      const { messageId } = sendSatelliteMessage(db, "msg2");
      updateSatMessageStatus(db, messageId, "sent");
      updateSatMessageStatus(db, messageId, "confirmed");
      registerHsmDevice(db, "yubikey");

      const s = getTrustSecurityStats(db);
      expect(s.attestations.total).toBe(2);
      expect(s.attestations.valid).toBe(2);
      expect(s.interopTests.total).toBe(2);
      expect(s.interopTests.compatible).toBe(1);
      expect(s.interopTests.avgLatencyMs).toBe(15);
      expect(s.satellite.total).toBe(2);
      expect(s.satellite.confirmed).toBe(1);
      expect(s.hsm.total).toBe(1);
    });
  });
});
