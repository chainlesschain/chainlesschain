import { describe, it, expect } from "vitest";
import {
  chooseBackend,
  createSecretStore,
  isSecretRef,
  secretRef,
} from "../../src/lib/secret-store.js";

describe("secret-store", () => {
  it("selects the platform-native backend", () => {
    expect(chooseBackend("win32")).toBe("dpapi");
    expect(chooseBackend("darwin")).toBe("keychain");
    expect(chooseBackend("linux")).toBe("secret-service");
    expect(chooseBackend("aix")).toBe("unavailable");
  });

  it("round-trips through the injected memory backend", () => {
    const store = createSecretStore({ backend: "memory" });
    store.set("plugin/apiKey", "secret-value");
    expect(store.get("plugin/apiKey")).toBe("secret-value");
    expect(store.delete("plugin/apiKey")).toBe(true);
    expect(store.get("plugin/apiKey")).toBeNull();
  });

  it("uses stable non-secret references in JSON", () => {
    const ref = secretRef("p1/apiKey");
    expect(ref).toEqual({ __cc_secret_ref: "p1/apiKey" });
    expect(isSecretRef(ref)).toBe(true);
    expect(isSecretRef({ __cc_secret_ref: "" })).toBe(false);
  });
});
