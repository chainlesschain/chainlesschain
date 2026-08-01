#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  signPackUpdateManifest,
  verifyPackUpdateManifest,
} from "../src/lib/packer/pack-update-signature.js";

function main() {
  const [manifestPath, privateKeyPath, publicKeyPath] = process.argv.slice(2);
  if (!manifestPath || !privateKeyPath) {
    throw new Error(
      "usage: sign-pack-update-manifest.mjs <manifest.json> <ed25519-private.pem> [trusted-public.pem]",
    );
  }
  const file = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = fs.readFileSync(path.resolve(privateKeyPath), "utf8");
  const signed = signPackUpdateManifest(manifest, key);
  if (publicKeyPath) {
    const trusted = fs.readFileSync(path.resolve(publicKeyPath), "utf8");
    verifyPackUpdateManifest(signed, trusted);
  }
  fs.writeFileSync(file, `${JSON.stringify(signed, null, 2)}\n`, "utf8");
  process.stdout.write(`signed ${file} with key ${signed.signature.keyId}\n`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`pack update signing failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
