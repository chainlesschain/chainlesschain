import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  buildMarketplacePayloadSbom,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import {
  SOURCE_CACHE_AUTHORITY_FILENAME,
  marketplaceSourceCacheSpec,
  publishMarketplaceSourceCache,
  readMarketplaceSourceCache,
} from "../../src/lib/plugin-runtime/marketplace-source-cache.js";

let root;
let source;
let cacheDir;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-source-cache-"));
  source = path.join(root, "source");
  cacheDir = path.join(root, "cache");
  fs.mkdirSync(source);
  fs.writeFileSync(
    path.join(source, "plugin.json"),
    JSON.stringify({ name: "cached-plugin", version: "1.0.0" }),
  );
  fs.writeFileSync(path.join(source, "index.js"), "export const value = 1;\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function metadata() {
  const manifestSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(source, "plugin.json")))
    .digest("hex");
  const payload = buildMarketplacePayloadSbom(source, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  return {
    type: "registry",
    source: "https://registry.example/index.json",
    registry: "https://registry.example/index.json",
    resolvedSource: "https://git.example/acme/cached-plugin.git",
    ref: "v1.0.0",
    catalogAuthority: {
      artifactExpectations: {
        manifest: { sha256: manifestSha256 },
        sbom: {
          format: payload.schemaVersion,
          payloadSha256: payload.digest,
        },
      },
    },
  };
}

describe("Marketplace source package cache", () => {
  it("publishes and revalidates an exact semantic payload", () => {
    const sourceMetadata = metadata();
    const spec = marketplaceSourceCacheSpec(sourceMetadata);
    expect(spec.cacheKey).toMatch(/^[a-f0-9]{64}$/);

    const published = publishMarketplaceSourceCache(source, sourceMetadata, {
      cacheDir,
    });
    expect(published).toMatchObject({
      status: "published",
      cacheKey: spec.cacheKey,
    });
    const cached = readMarketplaceSourceCache(sourceMetadata, { cacheDir });
    expect(fs.readFileSync(path.join(cached.dir, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(cached.authority).toMatchObject({
      cacheKey: spec.cacheKey,
      manifestSha256: spec.manifestSha256,
      payload: {
        schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
        sha256: spec.payload.sha256,
        fileCount: 2,
      },
    });

    expect(
      publishMarketplaceSourceCache(source, sourceMetadata, { cacheDir }),
    ).toMatchObject({ status: "reused", cacheKey: spec.cacheKey });
  });

  it("rejects payload tampering and hard-linked cache authority", () => {
    const sourceMetadata = metadata();
    const published = publishMarketplaceSourceCache(source, sourceMetadata, {
      cacheDir,
    });
    fs.writeFileSync(path.join(published.dir, "index.js"), "tampered\n");
    expect(() =>
      readMarketplaceSourceCache(sourceMetadata, { cacheDir }),
    ).toThrow(/payload digest mismatch/);

    fs.writeFileSync(
      path.join(published.dir, "index.js"),
      "export const value = 1;\n",
    );
    const authorityFile = path.join(
      path.dirname(published.dir),
      SOURCE_CACHE_AUTHORITY_FILENAME,
    );
    fs.linkSync(authorityFile, path.join(root, "authority-hardlink.json"));
    expect(() =>
      readMarketplaceSourceCache(sourceMetadata, { cacheDir }),
    ).toThrow(/single-link/);
  });

  it("refuses a remote source without a semantic payload anchor", () => {
    const sourceMetadata = metadata();
    delete sourceMetadata.catalogAuthority.artifactExpectations.sbom
      .payloadSha256;
    expect(marketplaceSourceCacheSpec(sourceMetadata)).toBeNull();
    expect(() =>
      readMarketplaceSourceCache(sourceMetadata, { cacheDir }),
    ).toThrow(
      /requires registry manifest SHA-256 and a repository-defined payload/,
    );
  });
});
