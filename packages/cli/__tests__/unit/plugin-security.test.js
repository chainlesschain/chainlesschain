import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalizePluginSource,
  _resetPluginManagedPolicyCache,
  enforcePluginPolicy,
  enforcePluginSourcePolicy,
  evaluatePluginSourcePolicy,
  loadPluginManagedPolicy,
  verifyPluginManifest,
} from "../../src/lib/plugin-security.js";

let dir;
beforeEach(() => {
  _resetPluginManagedPolicyCache();
  dir = mkdtempSync(join(tmpdir(), "cc-plugin-security-"));
});
afterEach(() => {
  _resetPluginManagedPolicyCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("managed plugin policy", () => {
  it("denies blocked plugins before installation", () => {
    expect(() =>
      enforcePluginPolicy(
        { name: "evil", source: "official", action: "install" },
        { deniedPlugins: ["evil"] },
      ),
    ).toThrow(/denied by managed settings/);
    expect(() =>
      enforcePluginPolicy(
        { name: "evil", action: "load" },
        { deniedPlugins: "evil" },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    for (const invalidEntry of [null, {}, { name: null }, { name: {} }]) {
      expect(() =>
        enforcePluginPolicy(
          { name: "evil", action: "load" },
          { deniedPlugins: [invalidEntry] },
        ),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
    }
  });

  it("requires both an allowed plugin and source when allowlists exist", () => {
    const policy = {
      allowedPlugins: ["review"],
      allowedPluginSources: ["company"],
    };
    expect(() =>
      enforcePluginPolicy({ name: "review", action: "install" }, policy),
    ).toThrow(/require --source/);
    expect(() =>
      enforcePluginPolicy(
        { name: "review", source: "public", action: "install" },
        policy,
      ),
    ).toThrow(/source.*not in/);
    expect(
      enforcePluginPolicy(
        { name: "review", source: "company", action: "install" },
        policy,
      ).allowed,
    ).toBe(true);
  });

  it("treats blocked marketplaces as blocked sources", () => {
    expect(() =>
      enforcePluginPolicy(
        { name: "x", source: "public", action: "install" },
        { blockedMarketplaces: ["public"] },
      ),
    ).toThrow(/source.*blocked/);
  });

  it("keeps opaque legacy marketplace identifiers exact", () => {
    expect(
      enforcePluginSourcePolicy("public", {
        blockedMarketplaces: ["Public"],
      }).allowed,
    ).toBe(true);
    expect(() =>
      enforcePluginSourcePolicy("Public", {
        blockedMarketplaces: ["Public"],
      }),
    ).toThrow(/source.*blocked/);
  });

  it("canonicalizes hosted HTTPS and official SSH spellings", () => {
    const sources = [
      "Acme/Review",
      "https://github.com/acme/review.git#main",
      "ssh://git@github.com/ACME/REVIEW.git#main",
      "git@github.com:acme/review.git#main",
    ];
    const identities = sources.map((source) =>
      canonicalizePluginSource(source),
    );
    expect(identities.slice(0, 2).map(({ key }) => key)).toEqual([
      "github:https://github.com/acme/review",
      "github:https://github.com/acme/review",
    ]);
    expect(identities[2].key).toMatch(
      /^github:ssh:\/\/\[principal:[a-f0-9]{64}\]@github\.com\/acme\/review$/u,
    );
    expect(identities[3]).toMatchObject({
      principalDigest: identities[2].principalDigest,
      pathMode: "absolute",
    });
    expect(identities[3].identityDigest).toBe(identities[2].identityDigest);
  });

  it("normalizes GitLab subgroups without conflating HTTPS and SSH policy identities", () => {
    const managed = {
      blockedMarketplaces: [
        {
          source: "git",
          url: "https://gitlab.com/Platform/Security/Plugins.git",
        },
      ],
    };
    for (const source of [
      "gitlab.com/platform/security/plugins",
      "https://gitlab.com/platform/security/plugins.git",
    ]) {
      expect(() => enforcePluginSourcePolicy(source, managed)).toThrowError(
        expect.objectContaining({
          code: "PLUGIN_SOURCE_POLICY_BLOCKED",
          sourceIdentity: "gitlab:https://gitlab.com/platform/security/plugins",
        }),
      );
    }
    expect(
      enforcePluginSourcePolicy(
        "git@gitlab.com:platform/security/plugins.git",
        managed,
      ).allowed,
    ).toBe(true);
  });

  it("keeps explicit URL marketplace query strings exact without extension guessing", () => {
    const policy = {
      allowedMarketplaces: [
        {
          source: "url",
          url: "https://catalog.example/marketplace?tenant=a%2Fb",
        },
      ],
    };
    expect(
      enforcePluginSourcePolicy(
        "https://CATALOG.example:443/marketplace?tenant=a%2Fb#ignored",
        policy,
        { kindHint: "registry" },
      ).allowed,
    ).toBe(true);
    expect(() =>
      enforcePluginSourcePolicy(
        "https://catalog.example/marketplace?tenant=a%2Fc",
        policy,
        { kindHint: "registry" },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
    );
  });

  it("never exposes URL query credentials in policy errors or audit identity", () => {
    let failure;
    try {
      enforcePluginSourcePolicy(
        "https://catalog.example/marketplace?token=secret",
        {
          blockedMarketplaces: [
            {
              source: "url",
              url: "https://catalog.example/marketplace?token=secret",
            },
          ],
        },
        { kindHint: "registry" },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "PLUGIN_SOURCE_POLICY_BLOCKED",
      sourceIdentity: "url:https://catalog.example/marketplace?[REDACTED]",
      sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(`${failure.message}\n${JSON.stringify(failure)}`).not.toContain(
      "secret",
    );
  });

  it("supports owner wildcards case-insensitively with blocked precedence", () => {
    const managed = {
      allowedMarketplaces: ["acme/review"],
      blockedMarketplaces: ["ACME/*"],
    };
    expect(() =>
      enforcePluginSourcePolicy("git@github.com:acme/review.git", managed),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
    );
    expect(() => enforcePluginSourcePolicy("acme/re*", managed)).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
  });

  it("accepts additional/allowed marketplace aliases and resolves named declarations", () => {
    const managed = {
      additionalMarketplaces: {
        company: {
          source: {
            source: "github",
            repo: "Acme/Review",
          },
        },
      },
      allowedMarketplaces: ["company"],
    };
    const decision = enforcePluginSourcePolicy("acme/review", managed);
    expect(decision).toMatchObject({
      allowed: true,
      status: "allowed",
      source: { key: "github:https://github.com/acme/review" },
      allowedBy: [{ setting: "allowedMarketplaces", index: 0 }],
    });
    expect(() =>
      enforcePluginSourcePolicy("company", managed, {
        cwd: dir,
        kindHint: "directory",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
    );

    for (const blockedAlias of [{ name: "company" }, { source: "company" }]) {
      expect(() =>
        enforcePluginSourcePolicy("acme/review", {
          additionalMarketplaces: managed.additionalMarketplaces,
          blockedMarketplaces: [blockedAlias],
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
      );
    }
  });

  it("intersects compatibility allowlists and exposes a stable rollback digest", () => {
    const initial = {
      strictKnownMarketplaces: ["acme/review"],
      allowedMarketplaces: ["acme/review"],
    };
    const first = evaluatePluginSourcePolicy("acme/review", initial);
    const changed = evaluatePluginSourcePolicy("acme/review", {
      ...initial,
      allowedMarketplaces: ["other/repo"],
    });
    const rolledBack = evaluatePluginSourcePolicy("acme/review", initial);
    expect(first.allowed).toBe(true);
    expect(changed).toMatchObject({
      allowed: false,
      status: "not-allowed",
      matchedRule: { setting: "allowedMarketplaces" },
    });
    expect(changed.policyDigest).not.toBe(first.policyDigest);
    expect(rolledBack.policyDigest).toBe(first.policyDigest);
  });

  it("fails closed for malformed managed source policy", () => {
    expect(() =>
      enforcePluginSourcePolicy("acme/review", {
        allowedMarketplaces: "acme/review",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    for (const invalidRule of [
      { source: "github", repo: "acme/review", branch: "release" },
      { source: "github", repo: "acme/review", ref: { value: "release" } },
      { source: "github", repo: "acme/review", path: ["plugin"] },
    ]) {
      expect(() =>
        enforcePluginSourcePolicy("acme/review", {
          allowedPluginSources: [invalidRule],
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
    }
    expect(() =>
      enforcePluginSourcePolicy("acme/review", {
        extraKnownMarketplaces: {
          company: { source: "github", repo: "acme/review" },
        },
        additionalMarketplaces: {
          company: { source: "github", repo: "other/review" },
        },
        allowedMarketplaces: ["company"],
      }),
    ).toThrow(/conflicts with its compatibility alias/);
    expect(() =>
      enforcePluginSourcePolicy("acme/review", {
        additionalMarketplaces: [
          { source: "unsupported", url: "https://example.invalid" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
  });

  it("matches repository ref and subpath exactly", () => {
    const exact = {
      source: "github",
      repo: "acme/review",
      ref: "release",
      path: "plugins/reviewer",
    };
    const managed = { allowedPluginSources: [exact] };
    expect(enforcePluginSourcePolicy(exact, managed).allowed).toBe(true);
    for (const candidate of [
      { ...exact, ref: "main" },
      { ...exact, ref: undefined },
      { ...exact, path: "plugins/other" },
      { ...exact, path: undefined },
    ]) {
      expect(() => enforcePluginSourcePolicy(candidate, managed)).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
      );
    }
  });

  it("limits owner wildcards to unqualified github.com repositories", () => {
    expect(() =>
      enforcePluginSourcePolicy("acme/review", {
        allowedPluginSources: [
          { source: "github", repo: "acme/*", ref: "main" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    expect(
      enforcePluginSourcePolicy("ssh://git@github.com:2222/acme/review.git", {
        blockedPluginSources: ["acme/*"],
      }).allowed,
    ).toBe(true);
    expect(
      enforcePluginSourcePolicy("ssh://deploy@github.com/acme/review.git", {
        blockedPluginSources: ["acme/*"],
      }).allowed,
    ).toBe(true);
    for (const downgraded of [
      "http://github.com/acme/review.git",
      "git://github.com/acme/review.git",
      "ssh://deploy@github.com/acme/review.git",
    ]) {
      expect(() =>
        enforcePluginSourcePolicy(downgraded, {
          allowedPluginSources: ["acme/*"],
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
      );
    }
  });

  it("distinguishes SSH principals and relative versus absolute paths", () => {
    const relativeScp = canonicalizePluginSource(
      "git@code.example:platform/review.git#release",
    );
    const absoluteScp = canonicalizePluginSource(
      "git@code.example:/platform/review.git#release",
    );
    const ssh = canonicalizePluginSource(
      "ssh://git@code.example/platform/review.git#release",
    );
    const other = canonicalizePluginSource(
      "ssh://deploy@code.example/platform/review.git#release",
    );
    expect(absoluteScp).toMatchObject({
      identityDigest: ssh.identityDigest,
      principalDigest: ssh.principalDigest,
      pathMode: "absolute",
      ref: "release",
    });
    expect(relativeScp).toMatchObject({
      principalDigest: ssh.principalDigest,
      pathMode: "relative",
    });
    expect(relativeScp.identityDigest).not.toBe(ssh.identityDigest);
    expect(other.identityDigest).not.toBe(ssh.identityDigest);
    expect(other.principalDigest).not.toBe(ssh.principalDigest);
    expect(JSON.stringify([relativeScp, absoluteScp, ssh, other])).not.toMatch(
      /git@|deploy@/u,
    );
    expect(() =>
      enforcePluginSourcePolicy(
        "ssh://deploy@code.example/platform/review.git#release",
        {
          allowedPluginSources: [
            "git@code.example:platform/review.git#release",
          ],
        },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
    );

    let failure;
    try {
      enforcePluginSourcePolicy(
        "ssh://git:password@code.example/platform/review.git#release",
        {
          blockedPluginSources: [
            "git@code.example:/platform/review.git#release",
          ],
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" });
    expect(`${failure.message}\n${JSON.stringify(failure)}`).not.toContain(
      "password",
    );
    expect(() =>
      canonicalizePluginSource(
        "ssh://%20git%20@code.example/platform/review.git",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
  });

  it("keeps generic .git and SCP percent spellings exact and redacts query-like suffixes", () => {
    const withDotGit = canonicalizePluginSource(
      "git@code.example:team/trusted.git",
    );
    const withoutDotGit = canonicalizePluginSource(
      "git@code.example:team/trusted",
    );
    const encoded = canonicalizePluginSource(
      "git@code.example:team/%72eview.git",
    );
    const plain = canonicalizePluginSource("git@code.example:team/review.git");
    expect(withDotGit.identityDigest).not.toBe(withoutDotGit.identityDigest);
    expect(encoded.identityDigest).not.toBe(plain.identityDigest);
    expect(
      canonicalizePluginSource("https://code.example/team/%72eview.git")
        .identityDigest,
    ).toBe(
      canonicalizePluginSource("https://code.example/team/review.git")
        .identityDigest,
    );
    expect(() =>
      enforcePluginSourcePolicy("https://code.example/team/%72eview.git", {
        blockedPluginSources: ["https://code.example/team/review.git"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
    );

    expect(
      canonicalizePluginSource("ssh://git@code.example/team/review%3Atest.git")
        .identityDigest,
    ).toBe(
      canonicalizePluginSource("ssh://git@code.example/team/review:test.git")
        .identityDigest,
    );
    expect(() =>
      enforcePluginSourcePolicy(
        "ssh://git@code.example/team/review%40test.git",
        {
          blockedPluginSources: ["ssh://git@code.example/team/review@test.git"],
        },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
    );

    const registryPlain = canonicalizePluginSource(
      "https://registry.example/index.json",
      { kindHint: "registry" },
    );
    const registryEncoded = canonicalizePluginSource(
      "https://registry.example/%69ndex.json",
      { kindHint: "registry" },
    );
    expect(registryEncoded.identityDigest).toBe(registryPlain.identityDigest);

    let failure;
    try {
      enforcePluginSourcePolicy(
        "git@code.example:team/review.git?token=secret",
        {
          blockedPluginSources: [
            "git@code.example:team/review.git?token=secret",
          ],
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "PLUGIN_SOURCE_POLICY_BLOCKED",
      sourceIdentity: expect.stringContaining("?[REDACTED]"),
    });
    expect(`${failure.message}\n${JSON.stringify(failure)}`).not.toContain(
      "secret",
    );
  });

  it("normalizes the DNS root dot before GitHub owner policy matching", () => {
    const dotted = canonicalizePluginSource(
      "https://github.com./acme/review.git",
    );
    const ordinary = canonicalizePluginSource(
      "https://github.com/acme/review.git",
    );
    expect(dotted.identityDigest).toBe(ordinary.identityDigest);
    expect(() =>
      enforcePluginSourcePolicy("https://github.com./acme/review.git", {
        blockedPluginSources: ["acme/*"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
    );
  });

  it("normalizes DNS, IDNA, and alternate IPv4 host spellings", () => {
    const canonicalLoopback = canonicalizePluginSource(
      "git@127.0.0.1:team/review.git",
    );
    for (const alternate of [
      "git@127.1:team/review.git",
      "git@2130706433:team/review.git",
    ]) {
      expect(canonicalizePluginSource(alternate).identityDigest).toBe(
        canonicalLoopback.identityDigest,
      );
      expect(() =>
        enforcePluginSourcePolicy(alternate, {
          blockedPluginSources: ["git@127.0.0.1:team/review.git"],
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
      );
    }
    expect(
      canonicalizePluginSource("git@bücher.example:team/review.git")
        .identityDigest,
    ).toBe(
      canonicalizePluginSource("git@xn--bcher-kva.example:team/review.git")
        .identityDigest,
    );
    expect(
      canonicalizePluginSource("ssh://git@[::ffff:127.0.0.1]/team/review.git")
        .identityDigest,
    ).toBe(
      canonicalizePluginSource("ssh://git@127.0.0.1/team/review.git")
        .identityDigest,
    );
    expect(() =>
      canonicalizePluginSource("ssh://code.example/team/review.git"),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    expect(() =>
      canonicalizePluginSource("code.example:team/review.git"),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
  });

  it("retains non-default ports, query bytes, file authorities, IPv6, and percent safety", () => {
    const localFile = pathToFileURL(join(dir, "share", "review.git")).href;
    const otherFile =
      process.platform === "win32"
        ? "file://build-host/share/review.git"
        : pathToFileURL(join(dir, "other", "review.git")).href;
    const identities = [
      canonicalizePluginSource(
        "ssh://git@[2001:db8::1]:2222/acme/review.git?tenant=a%2Fb",
      ),
      canonicalizePluginSource(otherFile),
      canonicalizePluginSource(localFile),
    ];
    expect(identities[0]).toMatchObject({
      authority: "[2001:db8::1]:2222",
      port: "2222",
      key: expect.stringMatching(
        /^git:ssh:\/\/\[principal:[a-f0-9]{64}\]@\[2001:db8::1\]:2222\/acme\/review\.git\?\[REDACTED\]$/u,
      ),
    });
    expect(identities[1].identityDigest).not.toBe(identities[2].identityDigest);
    expect(() =>
      canonicalizePluginSource("https://example.com/acme/%2E%2E/review.git"),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    expect(() =>
      canonicalizePluginSource("https://example.com/acme%2Freview.git"),
    ).toThrowError(
      expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
    );
    if (process.platform === "win32") {
      for (const aliased of [
        "file:///C:/NOTEXI~1/review.git",
        "C:\\NOTEXI~1\\review.git",
        "C:\\trusted.\\review.git",
      ]) {
        expect(() => canonicalizePluginSource(aliased)).toThrowError(
          expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
        );
      }
      const existingShortRoot = "C:\\PROGRA~1";
      if (existsSync(existingShortRoot)) {
        const expandedRoot = realpathSync.native(existingShortRoot);
        if (expandedRoot.toLowerCase() !== existingShortRoot.toLowerCase()) {
          expect(
            canonicalizePluginSource(existingShortRoot, {
              kindHint: "directory",
            }).key,
          ).toBe(
            canonicalizePluginSource(expandedRoot, {
              kindHint: "directory",
            }).key,
          );
          expect(
            canonicalizePluginSource(
              `${existingShortRoot}\\cc-nonexistent-review.git`,
              { kindHint: "directory" },
            ).key,
          ).toBe(
            canonicalizePluginSource(
              `${expandedRoot}\\cc-nonexistent-review.git`,
              { kindHint: "directory" },
            ).key,
          );
        }
      }
    }
  });

  it("memoizes both valid and invalid managed settings snapshots", () => {
    const managedSettingsFile = join(dir, "managed-settings.json");
    writeFileSync(
      managedSettingsFile,
      JSON.stringify({ blockedPluginSources: ["acme/review"] }),
    );
    const snapshot = loadPluginManagedPolicy({ managedSettingsFile });
    expect(snapshot).toMatchObject({
      blockedPluginSources: ["acme/review"],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.blockedPluginSources)).toBe(true);
    expect(() => snapshot.blockedPluginSources.push("evil/repo")).toThrow();
    writeFileSync(
      managedSettingsFile,
      JSON.stringify({ blockedPluginSources: ["other/repo"] }),
    );
    expect(loadPluginManagedPolicy({ managedSettingsFile })).toMatchObject({
      blockedPluginSources: ["acme/review"],
    });

    _resetPluginManagedPolicyCache();
    writeFileSync(managedSettingsFile, "{");
    let first;
    let second;
    try {
      loadPluginManagedPolicy({ managedSettingsFile, onWarn: () => {} });
    } catch (error) {
      first = error;
    }
    try {
      loadPluginManagedPolicy({ managedSettingsFile, onWarn: () => {} });
    } catch (error) {
      second = error;
    }
    expect(first).toMatchObject({ code: "CC_MANAGED_SETTINGS_INVALID" });
    expect(second).toBe(first);
  });
});

describe("plugin manifest integrity", () => {
  it("verifies SHA-256 and rejects a mismatch", () => {
    const manifest = join(dir, "plugin.json");
    writeFileSync(manifest, '{"name":"review"}');
    const result = verifyPluginManifest({ manifestFile: manifest });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        expectedSha256: "0".repeat(64),
      }),
    ).toThrow(/SHA-256 mismatch/);
  });

  it("verifies a detached Ed25519 signature", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"signed"}');
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const result = verifyPluginManifest({
      manifestFile: manifest,
      signatureFile,
      publicKeyFile,
      requireSignature: true,
    });
    expect(result.signatureVerified).toBe(true);
  });

  it("binds the exact signature document and public-key bytes before verification", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"remote-signed"}');
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const signature = sign(null, bytes, first.privateKey);
    const publicKeyDocument = Buffer.from(
      first.publicKey.export({ type: "spki", format: "pem" }),
    );
    const signatureSha256 = sha256(signature);
    const publicKeyDocumentSha256 = sha256(publicKeyDocument);
    const publicKeySha256 = sha256(
      first.publicKey.export({ type: "spki", format: "der" }),
    );
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, signature);
    writeFileSync(publicKeyFile, publicKeyDocument);

    expect(
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
        requireSignature: true,
      }),
    ).toMatchObject({
      signatureVerified: true,
      signatureSha256,
      publicKeyDocumentSha256,
      publicKeySha256,
    });

    writeFileSync(signatureFile, sign(null, bytes, second.privateKey));
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
      }),
    ).toThrow(/detached signature SHA-256 mismatch/);

    writeFileSync(signatureFile, signature);
    writeFileSync(
      publicKeyFile,
      second.publicKey.export({ type: "spki", format: "pem" }),
    );
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
      }),
    ).toThrow(/public-key document SHA-256 mismatch/);
  });

  it("rejects a private-key container passed as a public key", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"no-private-key-persistence"}');
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      privateKey.export({ type: "pkcs8", format: "pem" }),
    );

    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
      }),
    ).toThrow(/PEM SPKI PUBLIC KEY container/);
  });

  it("fails closed when managed policy requires a signature", () => {
    expect(() => verifyPluginManifest({ requireSignature: true })).toThrow(
      /require a signed plugin manifest/,
    );
  });

  it("rejects a valid signature from an untrusted key", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"self-signed"}');
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      publicKey.export({ type: "spki", format: "pem" }),
    );
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
        requireTrustedKey: true,
        trustedKeySha256: ["0".repeat(64)],
      }),
    ).toThrow(/signing key is not trusted/);
  });
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
