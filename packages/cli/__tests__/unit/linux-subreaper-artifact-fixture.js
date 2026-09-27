import {
  LINUX_SUBREAPER_SOURCE_DIGEST,
  subreaperDigest,
} from "../../src/lib/process-execution-broker/linux-subreaper-artifact.js";
export const ARTIFACT_COMMIT = "0123456789abcdef0123456789abcdef01234567";

// Structural ELF fixture only. Actual execution is verified by native builds
// and the packaged-helper smoke, never by this header-only byte vector.
export function artifactFixture(arch = "x64") {
  const image = Buffer.alloc(128);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(image);
  image.writeUInt16LE(2, 16);
  image.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(0x400078n, 24);
  image.writeBigUInt64LE(64n, 32);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(1, 56);
  image.writeUInt32LE(1, 64);
  image.writeUInt32LE(5, 68);
  image.writeBigUInt64LE(0x400000n, 80);
  image.writeBigUInt64LE(128n, 96);
  image.writeBigUInt64LE(128n, 104);
  const manifest = {
    schema: "chainlesschain.linux-subreaper-artifact/v1",
    platform: "linux",
    arch,
    sourceDigest: LINUX_SUBREAPER_SOURCE_DIGEST,
    imageDigest: subreaperDigest(image),
    bytes: image.length,
    linkage: "static",
    commit: ARTIFACT_COMMIT,
  };
  return { image, manifest };
}
