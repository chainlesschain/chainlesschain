import crypto from "node:crypto";

export const LINUX_SUBREAPER_SOURCE_DIGEST =
  "sha256:e920e24b4a79121484f2e8e97886755f88eaa1af93b55326dfa68c7a7f571424";
export const LINUX_SUBREAPER_ARCHITECTURES = Object.freeze(["x64", "arm64"]);
export const MAX_SUBREAPER_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_SUBREAPER_MANIFEST_BYTES = 4096;

export function subreaperDigest(bytes) {
  return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
}

function invalid(reason) {
  const error = new Error(
    `Linux process supervision helper unavailable: ${reason}`,
  );
  error.code = "EXTERNAL_AGENT_HELPER_UNAVAILABLE";
  return error;
}

/** Bounded ELF64 inspection; release images have no dynamic loader dependency. */
export function validateLinuxSubreaperElf(bytes, { arch, staticOnly = false }) {
  const machine = arch === "x64" ? 62 : arch === "arm64" ? 183 : null;
  if (
    !machine ||
    !Buffer.isBuffer(bytes) ||
    bytes.length < 64 ||
    bytes.length > MAX_SUBREAPER_IMAGE_BYTES ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    bytes.readUInt16LE(18) !== machine ||
    ![2, 3].includes(bytes.readUInt16LE(16)) ||
    bytes.readUInt32LE(20) !== 1 ||
    bytes.readUInt16LE(52) !== 64 ||
    bytes.readUInt16LE(54) !== 56
  )
    throw invalid("unexpected-helper-image");
  const offset = bytes.readBigUInt64LE(32);
  const count = bytes.readUInt16LE(56);
  if (
    offset < 64n ||
    count < 1 ||
    count > 128 ||
    offset + BigInt(count * 56) > BigInt(bytes.length)
  )
    throw invalid("invalid-helper-program-headers");
  const entry = bytes.readBigUInt64LE(24);
  let executableEntry = false;
  for (let index = 0; index < count; index++) {
    const at = Number(offset) + index * 56;
    const type = bytes.readUInt32LE(at);
    if (staticOnly && [2, 3].includes(type))
      throw invalid("helper-is-not-static");
    if (type !== 1) continue;
    const fileOffset = bytes.readBigUInt64LE(at + 8);
    const address = bytes.readBigUInt64LE(at + 16);
    const fileSize = bytes.readBigUInt64LE(at + 32);
    const memorySize = bytes.readBigUInt64LE(at + 40);
    if (fileSize > memorySize || fileOffset + fileSize > BigInt(bytes.length))
      throw invalid("invalid-helper-load-segment");
    if (
      bytes.readUInt32LE(at + 4) & 1 &&
      entry >= address &&
      entry < address + fileSize
    )
      executableEntry = true;
  }
  if (!executableEntry || (staticOnly && bytes.readUInt16LE(16) !== 2))
    throw invalid("invalid-helper-entry");
}

export function validateLinuxSubreaperArtifact(
  manifestBytes,
  imageBytes,
  { arch, commit } = {},
) {
  if (
    !Buffer.isBuffer(manifestBytes) ||
    manifestBytes.length > MAX_SUBREAPER_MANIFEST_BYTES
  )
    throw invalid("invalid-packaged-manifest");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw invalid("invalid-packaged-manifest");
  }
  const keys = [
    "schema",
    "platform",
    "arch",
    "sourceDigest",
    "imageDigest",
    "bytes",
    "linkage",
    "commit",
  ];
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== keys.length ||
    Object.keys(manifest).some((key) => !keys.includes(key)) ||
    manifest.schema !== "chainlesschain.linux-subreaper-artifact/v1" ||
    manifest.platform !== "linux" ||
    !LINUX_SUBREAPER_ARCHITECTURES.includes(arch) ||
    manifest.arch !== arch ||
    manifest.sourceDigest !== LINUX_SUBREAPER_SOURCE_DIGEST ||
    manifest.linkage !== "static" ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    (commit !== undefined && manifest.commit !== commit) ||
    manifest.bytes !== imageBytes.length ||
    manifest.imageDigest !== subreaperDigest(imageBytes)
  )
    throw invalid("packaged-identity-mismatch");
  validateLinuxSubreaperElf(imageBytes, { arch, staticOnly: true });
  return Object.freeze({ ...manifest });
}
