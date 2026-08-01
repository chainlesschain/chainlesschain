import { describe, it, expect, vi } from "vitest";
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
    expect(isSecretRef({ __cc_secret_ref: "p1/apiKey", injected: true })).toBe(
      false,
    );
  });

  it("round-trips DPAPI payloads without putting plaintext in argv", () => {
    const files = new Map();
    const storeFile = "C:\\private\\secrets.json";
    const secret = "private-secret-value";
    const runner = vi.fn((_file, args, input) => {
      const command = args.join(" ");
      if (command.includes("::Unprotect(")) {
        expect(input).toBe("encrypted-current-user-blob");
        return Buffer.from(secret, "utf8").toString("base64");
      }
      expect(input).toBe(Buffer.from(secret, "utf8").toString("base64"));
      return "encrypted-current-user-blob";
    });
    const writeFile = vi.fn((file, value, options) => {
      files.set(file, value);
      expect(options.mode).toBe(0o600);
      expect(options.flag).toBe("wx");
    });
    const store = createSecretStore({
      backend: "dpapi",
      file: storeFile,
      runner,
      readFile: (file) => {
        if (!files.has(file)) {
          const error = new Error("not found");
          error.code = "ENOENT";
          throw error;
        }
        return files.get(file);
      },
      writeFile,
      mkdirSync: vi.fn(),
      renameFile: (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlinkFile: (file) => files.delete(file),
      existsFile: (file) => files.has(file),
      withLock: (_file, fn) => fn(),
      secureDirectory: vi.fn(),
      secureFile: vi.fn(),
      randomId: () => "test",
    });

    store.set("config/apiKey", secret);
    expect(JSON.stringify(runner.mock.calls[0][1])).not.toContain(secret);
    expect(files.get(storeFile)).not.toContain(secret);
    expect(store.get("config/apiKey")).toBe(secret);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("fails closed instead of overwriting a corrupt DPAPI store", () => {
    const writeFile = vi.fn();
    const store = createSecretStore({
      backend: "dpapi",
      file: "C:\\private\\secrets.json",
      runner: () => "encrypted-blob",
      readFile: () => "{broken-json",
      writeFile,
      mkdirSync: vi.fn(),
      renameFile: vi.fn(),
      unlinkFile: vi.fn(),
      existsFile: () => true,
      withLock: (_file, fn) => fn(),
      secureDirectory: vi.fn(),
      secureFile: vi.fn(),
    });
    expect(() => store.set("config/apiKey", "next-value")).toThrow(
      /invalid JSON/,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("uses macOS Keychain interactive stdin instead of secret argv", () => {
    const secret = "keychain private value";
    let encoded = null;
    const runner = vi.fn((_file, args, input) => {
      if (args[0] === "-i") {
        encoded = input.match(/-w (\S+)\n$/)?.[1] || null;
        return "";
      }
      if (args[0] === "find-generic-password") return encoded;
      return "";
    });
    const store = createSecretStore({ backend: "keychain", runner });

    store.set("config/apiKey", secret);
    const [file, args, input] = runner.mock.calls[0];
    expect(file).toBe("security");
    expect(args).toEqual(["-i"]);
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(input).not.toContain(secret);
    expect(input).toMatch(/^add-generic-password .* -w ccv1:/);
    expect(store.get("config/apiKey")).toBe(secret);
    expect(store.delete("config/apiKey")).toBe(true);
  });

  it("fails closed before macOS interactive commands can be truncated", () => {
    const runner = vi.fn();
    const store = createSecretStore({ backend: "keychain", runner });
    expect(() => store.set("config/apiKey", "x".repeat(4000))).toThrow(
      /too large/,
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("propagates Keychain access errors but preserves not-found semantics", () => {
    const denied = new Error("User interaction is not allowed");
    denied.exitCode = 51;
    const deniedStore = createSecretStore({
      backend: "keychain",
      runner: () => {
        throw denied;
      },
    });
    expect(() => deniedStore.get("config/apiKey")).toThrow(/interaction/);

    const missing = new Error("The specified item could not be found");
    missing.exitCode = 44;
    const missingStore = createSecretStore({
      backend: "keychain",
      runner: () => {
        throw missing;
      },
    });
    expect(missingStore.get("config/apiKey")).toBeNull();
  });

  it("passes Linux Secret Service values only through stdin", () => {
    const secret = "secret-service-private-value";
    const runner = vi.fn((_file, args, input) => {
      if (args[0] === "lookup") return secret;
      return input || "";
    });
    const store = createSecretStore({ backend: "secret-service", runner });

    store.set("plugin/apiKey", secret);
    expect(runner.mock.calls[0][0]).toBe("secret-tool");
    expect(JSON.stringify(runner.mock.calls[0][1])).not.toContain(secret);
    expect(runner.mock.calls[0][2]).toBe(secret);
    expect(store.get("plugin/apiKey")).toBe(secret);
    expect(store.delete("plugin/apiKey")).toBe(true);
  });

  it("preserves leading and trailing spaces from native secret lookups", () => {
    const value = "  space-sensitive credential  ";
    const keychain = createSecretStore({
      backend: "keychain",
      runner: (_file, args) =>
        args[0] === "find-generic-password" ? `${value}\n` : "",
    });
    const secretService = createSecretStore({
      backend: "secret-service",
      runner: (_file, args) => (args[0] === "lookup" ? `${value}\n` : ""),
    });

    expect(keychain.get("config/apiKey")).toBe(value);
    expect(secretService.get("config/apiKey")).toBe(value);
  });

  it("rejects control characters in OS-store identifiers", () => {
    const store = createSecretStore({ backend: "memory" });
    expect(() => store.set("unsafe\nkey", "value")).toThrow(
      /Invalid secret key/,
    );
  });
});
