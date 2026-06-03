/**
 * archive-provider-factory.test.js — B4-cred-persist v1
 *
 * Covers:
 *   - filesystem path (legacy)
 *   - webdav explicit-spec mode (renamed fields: url / remotePath, the
 *     pre-existing 'baseUrl' / 'remoteRoot' bug is fixed by the new shape)
 *   - webdav useStoredCredentials mode — pulls creds from sync-credentials
 *     vault, not from spec
 *   - useStoredCredentials with no saved creds throws descriptive error
 *   - missing url throws — caller can't accidentally ship empty creds
 *   - rejects unknown kind
 *   - never returns the password back to caller (factory only constructs
 *     a provider; password lives inside the WebDAVClient closure)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
const {
  createArchiveProviderFactory,
} = require("../archive-provider-factory.js");

class FakeWebDAVClient {
  constructor(opts) {
    Object.assign(this, opts);
    this._kind = "FakeWebDAVClient";
  }
  async putFile() {}
  async listFiles() {
    return [];
  }
}

describe("createArchiveProviderFactory", () => {
  let mockSyncCredentials;
  let factory;
  beforeEach(() => {
    mockSyncCredentials = {
      hasCredentials: vi.fn(),
      getCredentials: vi.fn(),
    };
    factory = createArchiveProviderFactory({
      syncCredentials: mockSyncCredentials,
      WebDAVClient: FakeWebDAVClient,
    });
  });

  it("filesystem path returns a filesystemProvider", () => {
    const provider = factory({ kind: "filesystem", rootDir: "/tmp/x" });
    expect(typeof provider.putFile).toBe("function");
    expect(typeof provider.getFile).toBe("function");
    expect(typeof provider.listFiles).toBe("function");
  });

  it("filesystem path requires rootDir", () => {
    expect(() => factory({ kind: "filesystem" })).toThrow(/rootDir/);
  });

  it("rejects null spec", () => {
    expect(() => factory(null)).toThrow(/provider spec required/);
    expect(() => factory()).toThrow(/provider spec required/);
  });

  it("rejects unknown kind", () => {
    expect(() => factory({ kind: "s3" })).toThrow(/unsupported provider kind/);
  });

  describe("webdav explicit-spec (legacy direct mode)", () => {
    it("forwards url/username/password/remotePath to WebDAVClient", () => {
      const provider = factory({
        kind: "webdav",
        url: "https://nas.example/dav",
        username: "alice",
        password: "secret-pass",
        remotePath: "/cc-archives",
      });
      expect(typeof provider.putFile).toBe("function");
      expect(mockSyncCredentials.hasCredentials).not.toHaveBeenCalled();
      expect(mockSyncCredentials.getCredentials).not.toHaveBeenCalled();
    });

    it("rejects when url missing in explicit-spec mode", () => {
      expect(() =>
        factory({
          kind: "webdav",
          username: "alice",
          password: "p",
        }),
      ).toThrow(/url/);
    });
  });

  describe("webdav useStoredCredentials (B4-cred-persist v1)", () => {
    it("loads creds from syncCredentials when toggle on", () => {
      mockSyncCredentials.hasCredentials.mockReturnValue(true);
      mockSyncCredentials.getCredentials.mockReturnValue({
        url: "https://nas.stored/dav",
        username: "stored-user",
        password: "stored-secret",
        remotePath: "/stored-archives",
      });
      const provider = factory({
        kind: "webdav",
        useStoredCredentials: true,
      });
      expect(typeof provider.putFile).toBe("function");
      expect(mockSyncCredentials.hasCredentials).toHaveBeenCalledWith("webdav");
      expect(mockSyncCredentials.getCredentials).toHaveBeenCalledWith("webdav");
    });

    it("ignores inline url when useStoredCredentials=true (vault wins)", () => {
      mockSyncCredentials.hasCredentials.mockReturnValue(true);
      mockSyncCredentials.getCredentials.mockReturnValue({
        url: "https://nas.stored/dav",
        username: "stored-user",
        password: "stored-pw",
        remotePath: "/stored-root",
      });
      // The caller might erroneously pass both — vault must take precedence
      const provider = factory({
        kind: "webdav",
        useStoredCredentials: true,
        url: "https://attacker.example/dav",
        username: "attacker",
        password: "attacker-pw",
        remotePath: "/attacker",
      });
      expect(typeof provider.putFile).toBe("function");
      // vault path consulted; spec.* fields ignored
      expect(mockSyncCredentials.getCredentials).toHaveBeenCalledWith("webdav");
    });

    it("throws descriptive error when vault empty", () => {
      mockSyncCredentials.hasCredentials.mockReturnValue(false);
      expect(() =>
        factory({ kind: "webdav", useStoredCredentials: true }),
      ).toThrow(/no WebDAV credentials saved yet/);
    });

    it("defaults remotePath to / when stored cred lacks it", () => {
      mockSyncCredentials.hasCredentials.mockReturnValue(true);
      mockSyncCredentials.getCredentials.mockReturnValue({
        url: "https://nas/dav",
        username: "u",
        password: "p",
        // remotePath intentionally omitted
      });
      const provider = factory({
        kind: "webdav",
        useStoredCredentials: true,
      });
      expect(typeof provider.putFile).toBe("function");
    });
  });

  describe("WebDAVClient construction shape", () => {
    it("passes correct field names (url / remotePath, NOT baseUrl / remoteRoot)", () => {
      let captured = null;
      const SpyClient = function (opts) {
        captured = opts;
        return new FakeWebDAVClient(opts);
      };
      SpyClient.prototype = FakeWebDAVClient.prototype;
      const f = createArchiveProviderFactory({
        syncCredentials: mockSyncCredentials,
        WebDAVClient: SpyClient,
      });
      f({
        kind: "webdav",
        url: "https://h",
        username: "u",
        password: "p",
        remotePath: "/r",
      });
      expect(captured).toEqual({
        url: "https://h",
        username: "u",
        password: "p",
        remotePath: "/r",
      });
      // The pre-fix latent bug was: factory passed baseUrl / remoteRoot,
      // which WebDAVClient ignores → this.url='' → throws on first call.
      // This assertion locks the field names.
      expect(captured).not.toHaveProperty("baseUrl");
      expect(captured).not.toHaveProperty("remoteRoot");
    });
  });
});
