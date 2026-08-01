#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function finalizeNativeArtifact(options) {
  const artifact = path.resolve(options.artifact);
  const sidecar = path.resolve(
    options.sidecar || `${artifact}.pack-manifest.json`,
  );
  const manifest = fs.existsSync(sidecar)
    ? JSON.parse(fs.readFileSync(sidecar, "utf8"))
    : { schema: 1 };
  const bytes = fs.readFileSync(artifact);
  const finalized = {
    ...manifest,
    target: options.target || manifest.targets?.[0] || null,
    artifact: path.basename(artifact),
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    signed: true,
    signature: {
      type: "sigstore-bundle",
      file: path.basename(options.signatureBundle),
      ...(options.platformSignature
        ? { platform: options.platformSignature }
        : {}),
    },
  };
  fs.writeFileSync(sidecar, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
  return finalized;
}

function main() {
  const [artifact, target, signatureBundle, platformSignature] =
    process.argv.slice(2);
  if (!artifact || !target || !signatureBundle) {
    throw new Error(
      "usage: finalize-native-artifact.mjs <artifact> <target> <sigstore-bundle> [platform-signature]",
    );
  }
  const result = finalizeNativeArtifact({
    artifact,
    target,
    signatureBundle,
    platformSignature,
  });
  process.stdout.write(`${result.sha256}  ${result.artifact}\n`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `native artifact finalization failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
