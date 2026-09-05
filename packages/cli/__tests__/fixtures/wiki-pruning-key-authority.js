import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  pruningCanonical as canonical,
  pruningDigest as D,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import { WIKI_PRUNING_KMS_PROOF_SCHEMA } from "../../src/lib/evolution/governed-wiki-pruning-raw-shred.js";

// Test-owned software KMS boundary: real AES key/ciphertext files and signed
// intent/destruction/confirmation evidence. This is NOT a production key store,
// non-exportable HSM, physical secure erase or remote fault-domain guarantee.
export function openPruningKeyAuthority(
  root,
  {
    seed = false,
    tenantId = "tenant-pruning",
    afterKeyUnlink,
    transformProof,
  } = {},
) {
  const dir = path.join(root, "test-key-authority");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, "key.bin");
  const cipherPath = path.join(dir, "ciphertext.json");
  const keyRef = `kms://${tenantId}/dependency`;
  const sign = (value) =>
    createHmac("sha256", "test-only-independent-kms-authority")
      .update(canonical(value))
      .digest("hex");
  function write(name, bytes) {
    const target = path.join(dir, name);
    const fd = fs.openSync(target, "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (!fs.readFileSync(target).equals(Buffer.from(bytes)))
      throw new Error("KMS write readback differs");
  }
  function retain(name, core) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target))
      write(name, canonical({ core, signature: sign(core) }));
    const stored = read(name);
    if (canonical(stored) !== canonical(core))
      throw new Error("KMS request id collision");
    return stored;
  }
  function read(name) {
    const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    if (record.signature !== sign(record.core))
      throw new Error("KMS evidence signature differs");
    return record.core;
  }
  if (seed && !fs.existsSync(cipherPath)) {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update("private test recording", "utf8"),
      cipher.final(),
    ]);
    write("key.bin", key);
    write(
      "ciphertext.json",
      canonical({
        iv: iv.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      }),
    );
    key.fill(0);
  }
  const rawCipherDigest = () =>
    `sha256:${createHash("sha256").update(fs.readFileSync(cipherPath)).digest("hex")}`;
  function validateRequest(request) {
    if (
      request.tenantId !== tenantId ||
      request.keyRef !== keyRef ||
      request.rawCipherDigest !== rawCipherDigest()
    )
      throw new Error("KMS request target differs");
  }
  function requireDestroyed() {
    if (fs.existsSync(keyPath)) throw new Error("KMS key is still available");
  }
  return {
    rawCipherDigest,
    destroyKey(request) {
      validateRequest(request);
      retain("destruction-intent.json", request);
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
        afterKeyUnlink?.(request);
      }
      requireDestroyed();
      const core = {
        authenticated: true,
        durable: true,
        destroyed: true,
        keyRef,
        requestDigest: request.requestDigest,
      };
      return retain("destroyed.json", {
        ...core,
        receiptDigest: D("test-kms-destruction", core),
      });
    },
    confirmKeyDestroyed({
      tenantId: requestedTenant,
      keyRef: requestedKey,
      destructionReceiptDigest,
    }) {
      requireDestroyed();
      const destroyed = read("destroyed.json");
      if (
        requestedTenant !== tenantId ||
        requestedKey !== keyRef ||
        destructionReceiptDigest !== destroyed.receiptDigest
      )
        throw new Error("KMS confirmation binding differs");
      const core = {
        authenticated: true,
        destroyed: true,
        keyRef,
        destructionReceiptDigest,
      };
      return retain("confirmed.json", {
        ...core,
        receiptDigest: D("test-kms-confirmation", core),
      });
    },
    resolveDestruction({
      request,
      destructionReceiptDigest,
      confirmationReceiptDigest,
    }) {
      validateRequest(request);
      requireDestroyed();
      const intent = read("destruction-intent.json");
      const destroyed = read("destroyed.json");
      const confirmed = read("confirmed.json");
      if (
        canonical(intent) !== canonical(request) ||
        destroyed.requestDigest !== request.requestDigest ||
        destroyed.receiptDigest !== destructionReceiptDigest ||
        confirmed.destructionReceiptDigest !== destructionReceiptDigest ||
        confirmed.receiptDigest !== confirmationReceiptDigest
      )
        throw new Error("KMS persisted evidence was substituted");
      const proof = {
        schema: WIKI_PRUNING_KMS_PROOF_SCHEMA,
        authenticated: true,
        durable: true,
        destroyed: true,
        tenantId,
        keyRef,
        requestDigest: request.requestDigest,
        destructionReceiptDigest,
        confirmationReceiptDigest,
      };
      return transformProof ? transformProof(proof) : proof;
    },
    decrypt() {
      const key = fs.readFileSync(keyPath);
      try {
        const record = JSON.parse(fs.readFileSync(cipherPath, "utf8"));
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(record.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(record.tag, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");
      } finally {
        key.fill(0);
      }
    },
    inspect: () => ({
      keyAvailable: fs.existsSync(keyPath),
      rawCipherDigest: rawCipherDigest(),
      evidenceFiles: fs.readdirSync(dir).sort(),
    }),
  };
}
