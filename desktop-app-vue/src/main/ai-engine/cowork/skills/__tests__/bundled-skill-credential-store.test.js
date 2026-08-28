import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_CREDENTIAL_KEYS,
  BundledSkillCredentialStore,
} = require("../bundled-skill-credential-store.js");

function memoryStorage(initialPayload = null) {
  let payload = initialPayload;
  return {
    exists: () => payload !== null,
    load: () => (payload === null ? null : structuredClone(payload)),
    save: (next) => {
      payload = structuredClone(next);
      return true;
    },
    snapshot: () => (payload === null ? null : structuredClone(payload)),
  };
}

describe("BundledSkillCredentialStore", () => {
  it("persists each allowlisted secret and exposes boolean status only", () => {
    const storage = memoryStorage();
    const store = new BundledSkillCredentialStore({ storage });

    for (const key of BUNDLED_SKILL_CREDENTIAL_KEYS) {
      expect(store.set(key, `${key}-value`)).toBe(true);
      expect(store.get(key)).toBe(`${key}-value`);
    }

    expect(store.status()).toEqual(
      Object.fromEntries(
        BUNDLED_SKILL_CREDENTIAL_KEYS.map((key) => [key, true]),
      ),
    );
    expect(JSON.stringify(store.status())).not.toContain("-value");
    expect(storage.snapshot()).toEqual(
      expect.objectContaining({ version: 1, credentials: expect.any(Object) }),
    );
  });

  it("clears one exact credential without changing the others", () => {
    const store = new BundledSkillCredentialStore({
      storage: memoryStorage(),
    });
    store.set("notion-api-key", "notion-value");
    store.set("tavily-api-key", "tavily-value");

    expect(store.clear("notion-api-key")).toBe(true);
    expect(store.get("notion-api-key")).toBeNull();
    expect(store.get("tavily-api-key")).toBe("tavily-value");
  });

  it("rejects unknown keys and oversized values", () => {
    const store = new BundledSkillCredentialStore({
      storage: memoryStorage(),
    });

    expect(() => store.set("arbitrary-secret", "value")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CREDENTIAL_KEY_DENIED",
      }),
    );
    expect(() =>
      store.set("notion-api-key", "x".repeat(16 * 1024 + 1)),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CREDENTIAL_VALUE_INVALID",
      }),
    );
  });

  it("fails closed for invalid or unavailable encrypted persistence", () => {
    const invalidStore = new BundledSkillCredentialStore({
      storage: memoryStorage({ version: 99, credentials: {} }),
    });
    expect(() => invalidStore.status()).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CREDENTIAL_STORE_INVALID",
      }),
    );

    const unavailableStore = new BundledSkillCredentialStore({
      storage: {
        exists: () => false,
        load: () => null,
        save: () => false,
      },
    });
    expect(() => unavailableStore.set("notion-api-key", "value")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CREDENTIAL_STORE_UNAVAILABLE",
      }),
    );
  });
});
