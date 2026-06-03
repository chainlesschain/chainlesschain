/**
 * db-encryption-flag tests — Phase 1 / 1.5 master switch.
 *
 * Default gate (PHASE_1_5_DEFAULT_ON) is currently false → OFF everywhere unless
 * force-on via env. Tests also exercise the gate-open behavior via the opts seam
 * so the flip is verified before it is actually flipped in code.
 */

const {
  isDbEncryptionOptIn,
  PHASE_1_5_DEFAULT_ON,
} = require("../db-encryption-flag");

describe("db-encryption-flag", () => {
  const ORIGINAL = process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;

  function setEnv(v) {
    if (v === undefined) {
      delete process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;
    } else {
      process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = v;
    }
  }

  afterEach(() => setEnv(ORIGINAL));

  describe("env override (highest priority)", () => {
    it('forces ON for "1" and "true" regardless of gate/packaged', () => {
      for (const v of ["1", "true"]) {
        setEnv(v);
        expect(
          isDbEncryptionOptIn({ defaultOn: false, isPackaged: false }),
        ).toBe(true);
      }
    });

    it('forces OFF (kill-switch) for "0" and "false" even when gate open + packaged', () => {
      for (const v of ["0", "false"]) {
        setEnv(v);
        expect(isDbEncryptionOptIn({ defaultOn: true, isPackaged: true })).toBe(
          false,
        );
      }
    });
  });

  describe("gated default (no env)", () => {
    beforeEach(() => setEnv(undefined));

    it("is OFF everywhere while the gate is closed", () => {
      expect(isDbEncryptionOptIn({ defaultOn: false, isPackaged: true })).toBe(
        false,
      );
      expect(isDbEncryptionOptIn({ defaultOn: false, isPackaged: false })).toBe(
        false,
      );
    });

    it("when gate open: ON in packaged builds, OFF in dev/test", () => {
      expect(isDbEncryptionOptIn({ defaultOn: true, isPackaged: true })).toBe(
        true,
      );
      expect(isDbEncryptionOptIn({ defaultOn: true, isPackaged: false })).toBe(
        false,
      );
    });
  });

  describe("shipped defaults", () => {
    it("the gate is still CLOSED (not flipped) — pre-real-device-smoke", () => {
      expect(PHASE_1_5_DEFAULT_ON).toBe(false);
    });

    it("defaults to OFF with no env and no opts (gate closed)", () => {
      setEnv(undefined);
      expect(isDbEncryptionOptIn()).toBe(false);
    });

    it("other env values fall through to the gated default (OFF)", () => {
      for (const v of ["yes", "", "TRUE", "2"]) {
        setEnv(v);
        expect(isDbEncryptionOptIn()).toBe(false);
      }
    });
  });
});
