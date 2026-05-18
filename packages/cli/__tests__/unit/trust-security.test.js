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

import {
  HSM_MATURITY_V2,
  TRANSMISSION_V2,
  TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR,
  TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE,
  TS_DEFAULT_DEVICE_IDLE_MS,
  TS_DEFAULT_TRANSMISSION_STUCK_MS,
  getMaxActiveDevicesPerOperator,
  setMaxActiveDevicesPerOperator,
  getMaxPendingTransmissionsPerDevice,
  setMaxPendingTransmissionsPerDevice,
  getDeviceIdleMs,
  setDeviceIdleMs,
  getTransmissionStuckMs,
  setTransmissionStuckMs,
  getActiveDeviceCount,
  getPendingTransmissionCount,
  registerDeviceV2,
  getDeviceV2,
  listDevicesV2,
  setDeviceMaturityV2,
  activateDevice,
  degradeDevice,
  retireDevice,
  touchDeviceUsage,
  enqueueTransmissionV2,
  getTransmissionV2,
  listTransmissionsV2,
  setTransmissionStatusV2,
  startTransmission,
  confirmTransmission,
  failTransmission,
  cancelTransmission,
  autoRetireIdleDevices,
  autoFailStuckTransmissions,
  getTrustSecurityStatsV2,
  _resetStateV2,
} from "../../src/lib/trust-security.js";

describe("trust-security V2 (Phase 68-71)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  it("freezes HSM_MATURITY_V2 and TRANSMISSION_V2", () => {
    expect(Object.isFrozen(HSM_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(TRANSMISSION_V2)).toBe(true);
    expect(Object.values(HSM_MATURITY_V2).sort()).toEqual([
      "active",
      "degraded",
      "provisional",
      "retired",
    ]);
    expect(Object.values(TRANSMISSION_V2).sort()).toEqual([
      "canceled",
      "confirmed",
      "failed",
      "queued",
      "sending",
    ]);
  });

  it("exposes config defaults", () => {
    expect(TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR).toBe(8);
    expect(TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE).toBe(20);
    expect(TS_DEFAULT_DEVICE_IDLE_MS).toBe(30 * 86400000);
    expect(TS_DEFAULT_TRANSMISSION_STUCK_MS).toBe(2 * 60000);
    expect(getMaxActiveDevicesPerOperator()).toBe(8);
    expect(getMaxPendingTransmissionsPerDevice()).toBe(20);
    expect(getDeviceIdleMs()).toBe(30 * 86400000);
    expect(getTransmissionStuckMs()).toBe(2 * 60000);
  });

  it("setters validate + floor + reset", () => {
    expect(setMaxActiveDevicesPerOperator(3)).toBe(3);
    expect(setMaxPendingTransmissionsPerDevice(5.7)).toBe(5);
    expect(setDeviceIdleMs(100)).toBe(100);
    expect(setTransmissionStuckMs(200)).toBe(200);
    expect(() => setMaxActiveDevicesPerOperator(0)).toThrow();
    expect(() => setMaxActiveDevicesPerOperator(-1)).toThrow();
    expect(() => setTransmissionStuckMs(NaN)).toThrow();
    _resetStateV2();
    expect(getMaxActiveDevicesPerOperator()).toBe(8);
  });

  describe("device registration", () => {
    it("creates provisional device", () => {
      const d = registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
      });
      expect(d.status).toBe("provisional");
      expect(d.activatedAt).toBeNull();
    });

    it("validates required fields", () => {
      expect(() => registerDeviceV2({})).toThrow("id required");
      expect(() => registerDeviceV2({ id: "d1" })).toThrow("operator required");
      expect(() => registerDeviceV2({ id: "d1", operator: "op1" })).toThrow(
        "invalid vendor",
      );
      expect(() =>
        registerDeviceV2({ id: "d1", operator: "op1", vendor: "bogus" }),
      ).toThrow("invalid vendor");
    });

    it("rejects duplicate id", () => {
      registerDeviceV2({ id: "d1", operator: "op1", vendor: "yubikey" });
      expect(() =>
        registerDeviceV2({ id: "d1", operator: "op1", vendor: "ledger" }),
      ).toThrow("already exists");
    });

    it("rejects invalid initial status", () => {
      expect(() =>
        registerDeviceV2({
          id: "d1",
          operator: "op1",
          vendor: "yubikey",
          initialStatus: "bogus",
        }),
      ).toThrow("invalid initial status");
    });

    it("stamps activatedAt on initialStatus=active", () => {
      const d = registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
      expect(d.activatedAt).toBeGreaterThan(0);
    });

    it("enforces per-operator active cap (provisional excluded)", () => {
      setMaxActiveDevicesPerOperator(2);
      registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
      registerDeviceV2({
        id: "d2",
        operator: "op1",
        vendor: "ledger",
        initialStatus: "active",
      });
      expect(() =>
        registerDeviceV2({
          id: "d3",
          operator: "op1",
          vendor: "trezor",
          initialStatus: "active",
        }),
      ).toThrow("active device cap");
      registerDeviceV2({ id: "d4", operator: "op1", vendor: "generic" }); // provisional ok
      expect(getActiveDeviceCount("op1")).toBe(2);
    });

    it("defensively copies metadata on read", () => {
      const d = registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        metadata: { k: 1 },
      });
      d.metadata.k = 99;
      expect(getDeviceV2("d1").metadata.k).toBe(1);
    });
  });

  describe("device transitions", () => {
    beforeEach(() => {
      registerDeviceV2({ id: "d1", operator: "op1", vendor: "yubikey" });
    });

    it("provisional → active", () => {
      const d = activateDevice("d1");
      expect(d.status).toBe("active");
      expect(d.activatedAt).toBeGreaterThan(0);
    });

    it("provisional → retired", () => {
      expect(retireDevice("d1").status).toBe("retired");
    });

    it("rejects provisional → degraded", () => {
      expect(() => degradeDevice("d1")).toThrow("illegal transition");
    });

    it("active → degraded → active (recovery) → retired", () => {
      activateDevice("d1");
      degradeDevice("d1");
      expect(getDeviceV2("d1").status).toBe("degraded");
      activateDevice("d1");
      retireDevice("d1");
      expect(getDeviceV2("d1").status).toBe("retired");
    });

    it("retired is terminal", () => {
      retireDevice("d1");
      expect(() => activateDevice("d1")).toThrow("terminal");
    });

    it("stamp-once activatedAt across degrade/reactivate cycle", () => {
      const a = activateDevice("d1");
      const first = a.activatedAt;
      degradeDevice("d1");
      const b = activateDevice("d1");
      expect(b.activatedAt).toBe(first);
    });

    it("degraded counts toward active cap", () => {
      setMaxActiveDevicesPerOperator(2);
      activateDevice("d1");
      registerDeviceV2({
        id: "d2",
        operator: "op1",
        vendor: "ledger",
        initialStatus: "active",
      });
      registerDeviceV2({ id: "d3", operator: "op1", vendor: "trezor" });
      degradeDevice("d1"); // still counts as "active" in getActiveDeviceCount
      expect(() => activateDevice("d3")).toThrow("active device cap");
    });

    it("merges metadata + stores reason on transition", () => {
      activateDevice("d1", { reason: "online", metadata: { region: "eu" } });
      const d = getDeviceV2("d1");
      expect(d.reason).toBe("online");
      expect(d.metadata.region).toBe("eu");
    });

    it("touchDeviceUsage bumps lastUsedAt", async () => {
      activateDevice("d1");
      const before = getDeviceV2("d1").lastUsedAt;
      await new Promise((r) => setTimeout(r, 5));
      const d = touchDeviceUsage("d1");
      expect(d.lastUsedAt).toBeGreaterThan(before);
    });
  });

  describe("listDevicesV2 filters", () => {
    beforeEach(() => {
      registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
      registerDeviceV2({ id: "d2", operator: "op2", vendor: "ledger" });
    });

    it("filters by operator and status", () => {
      expect(listDevicesV2({ operator: "op1" }).map((d) => d.id)).toEqual([
        "d1",
      ]);
      expect(listDevicesV2({ status: "provisional" }).map((d) => d.id)).toEqual(
        ["d2"],
      );
    });
  });

  describe("transmissions", () => {
    beforeEach(() => {
      registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
    });

    it("enqueue requires fields", () => {
      expect(() => enqueueTransmissionV2({})).toThrow("id required");
      expect(() => enqueueTransmissionV2({ id: "t1" })).toThrow(
        "deviceId required",
      );
      expect(() => enqueueTransmissionV2({ id: "t1", deviceId: "d1" })).toThrow(
        "provider required",
      );
      expect(() =>
        enqueueTransmissionV2({
          id: "t1",
          deviceId: "d1",
          provider: "iridium",
        }),
      ).toThrow("payload required");
    });

    it("rejects missing device", () => {
      expect(() =>
        enqueueTransmissionV2({
          id: "t1",
          deviceId: "missing",
          provider: "iridium",
          payload: "hi",
        }),
      ).toThrow("device missing not found");
    });

    it("enqueue creates queued transmission", () => {
      const t = enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      expect(t.status).toBe("queued");
      expect(t.startedAt).toBeNull();
    });

    it("per-device pending cap", () => {
      setMaxPendingTransmissionsPerDevice(2);
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "a",
      });
      enqueueTransmissionV2({
        id: "t2",
        deviceId: "d1",
        provider: "iridium",
        payload: "b",
      });
      expect(() =>
        enqueueTransmissionV2({
          id: "t3",
          deviceId: "d1",
          provider: "iridium",
          payload: "c",
        }),
      ).toThrow("pending transmission cap");
    });

    it("queued → sending stamps startedAt", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      const t = startTransmission("t1");
      expect(t.status).toBe("sending");
      expect(t.startedAt).toBeGreaterThan(0);
    });

    it("sending → confirmed", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      startTransmission("t1");
      expect(confirmTransmission("t1").status).toBe("confirmed");
    });

    it("sending → failed", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      startTransmission("t1");
      expect(failTransmission("t1").status).toBe("failed");
    });

    it("queued → canceled", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      expect(cancelTransmission("t1").status).toBe("canceled");
    });

    it("terminal rejects further transitions", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "hi",
      });
      cancelTransmission("t1");
      expect(() => startTransmission("t1")).toThrow("terminal");
    });

    it("getPendingTransmissionCount", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "a",
      });
      enqueueTransmissionV2({
        id: "t2",
        deviceId: "d1",
        provider: "iridium",
        payload: "b",
      });
      startTransmission("t2");
      expect(getPendingTransmissionCount("d1")).toBe(2); // queued + sending
      confirmTransmission("t2");
      expect(getPendingTransmissionCount("d1")).toBe(1);
    });
  });

  describe("auto-flip batches", () => {
    beforeEach(() => {
      registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
    });

    it("autoRetireIdleDevices flips stale active via future now", () => {
      setDeviceIdleMs(100);
      const flipped = autoRetireIdleDevices({ now: Date.now() + 5000 });
      expect(flipped).toContain("d1");
      expect(getDeviceV2("d1").status).toBe("retired");
    });

    it("autoRetireIdleDevices skips provisional and retired", () => {
      registerDeviceV2({ id: "d2", operator: "op1", vendor: "ledger" });
      retireDevice("d1");
      setDeviceIdleMs(1);
      const flipped = autoRetireIdleDevices({ now: Date.now() + 10000 });
      expect(flipped).not.toContain("d1");
      expect(flipped).not.toContain("d2");
    });

    it("autoFailStuckTransmissions flips only SENDING", () => {
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "a",
      });
      enqueueTransmissionV2({
        id: "t2",
        deviceId: "d1",
        provider: "iridium",
        payload: "b",
      });
      startTransmission("t1");
      setTransmissionStuckMs(100);
      const flipped = autoFailStuckTransmissions({ now: Date.now() + 5000 });
      expect(flipped).toEqual(["t1"]);
      expect(getTransmissionV2("t2").status).toBe("queued");
    });
  });

  describe("stats", () => {
    it("zero-initialized enums empty state", () => {
      const s = getTrustSecurityStatsV2();
      expect(s.devicesByStatus).toEqual({
        provisional: 0,
        active: 0,
        degraded: 0,
        retired: 0,
      });
      expect(s.transmissionsByStatus).toEqual({
        queued: 0,
        sending: 0,
        confirmed: 0,
        failed: 0,
        canceled: 0,
      });
    });

    it("counts by status", () => {
      registerDeviceV2({
        id: "d1",
        operator: "op1",
        vendor: "yubikey",
        initialStatus: "active",
      });
      registerDeviceV2({ id: "d2", operator: "op1", vendor: "ledger" });
      enqueueTransmissionV2({
        id: "t1",
        deviceId: "d1",
        provider: "iridium",
        payload: "a",
      });
      startTransmission("t1");
      const s = getTrustSecurityStatsV2();
      expect(s.totalDevicesV2).toBe(2);
      expect(s.devicesByStatus.active).toBe(1);
      expect(s.transmissionsByStatus.sending).toBe(1);
    });
  });
});
