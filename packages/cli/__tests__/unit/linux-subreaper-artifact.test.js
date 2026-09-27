import { describe, expect, it } from "vitest";
import {
  validateLinuxSubreaperArtifact,
  validateLinuxSubreaperElf,
  subreaperDigest,
} from "../../src/lib/process-execution-broker/linux-subreaper-artifact.js";
import {
  ARTIFACT_COMMIT,
  artifactFixture,
} from "./linux-subreaper-artifact-fixture.js";

describe("packaged Linux subreaper identity", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value));
  it.each(["x64", "arm64"])("validates exact static %s identity", (arch) => {
    const { image, manifest } = artifactFixture(arch);
    expect(
      validateLinuxSubreaperArtifact(encode(manifest), image, {
        arch,
        commit: ARTIFACT_COMMIT,
      }),
    ).toEqual(manifest);
  });
  it.each([
    "arch",
    "sourceDigest",
    "imageDigest",
    "bytes",
    "commit",
    "linkage",
    "path",
  ])("rejects changed %s metadata", (field) => {
    const { image, manifest } = artifactFixture();
    manifest[field] = field === "bytes" ? image.length + 1 : "untrusted";
    expect(() =>
      validateLinuxSubreaperArtifact(encode(manifest), image, {
        arch: "x64",
        commit: ARTIFACT_COMMIT,
      }),
    ).toThrow();
  });
  it("rejects a payload built for another exact commit", () => {
    const { image, manifest } = artifactFixture();
    expect(() =>
      validateLinuxSubreaperArtifact(encode(manifest), image, {
        arch: "x64",
        commit: "a".repeat(40),
      }),
    ).toThrow("identity-mismatch");
  });
  it.each([
    "dynamic",
    "interpreter",
    "header-overflow",
    "segment-overflow",
    "missing-executable",
    "wrong-machine",
  ])("rejects %s even with a matching file digest", (kind) => {
    const { image, manifest } = artifactFixture();
    if (kind === "dynamic") image.writeUInt32LE(2, 64);
    if (kind === "interpreter") image.writeUInt32LE(3, 64);
    if (kind === "header-overflow") image.writeBigUInt64LE(2n ** 63n, 32);
    if (kind === "segment-overflow") image.writeBigUInt64LE(2n ** 63n, 72);
    if (kind === "missing-executable") image.writeUInt32LE(4, 68);
    if (kind === "wrong-machine") image.writeUInt16LE(183, 18);
    manifest.imageDigest = subreaperDigest(image);
    expect(() =>
      validateLinuxSubreaperArtifact(encode(manifest), image, { arch: "x64" }),
    ).toThrow();
  });
  it("bounds malformed and oversized inputs", () => {
    const { image } = artifactFixture();
    expect(() =>
      validateLinuxSubreaperArtifact(Buffer.from("{"), image, { arch: "x64" }),
    ).toThrow();
    expect(() =>
      validateLinuxSubreaperArtifact(Buffer.alloc(4097), image, {
        arch: "x64",
      }),
    ).toThrow();
    expect(() =>
      validateLinuxSubreaperElf(Buffer.alloc(4 * 1024 * 1024 + 1), {
        arch: "x64",
      }),
    ).toThrow();
  });
});
