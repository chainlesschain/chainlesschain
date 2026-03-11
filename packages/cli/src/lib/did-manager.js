/**
 * DID Manager — Decentralized Identity management for CLI.
 * Ed25519 key generation, DID document creation, signing, and verification.
 * Uses Node.js built-in crypto module (no external dependencies).
 */

import crypto from "crypto";

/**
 * Ensure DID tables exist.
 */
export function ensureDIDTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS did_identities (
      did TEXT PRIMARY KEY,
      display_name TEXT,
      public_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      did_document TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Generate an Ed25519 keypair.
 * Returns { publicKey, secretKey } as hex strings.
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("hex"),
    secretKey: privateKey.toString("hex"),
  };
}

/**
 * Generate a DID from a public key.
 * Format: did:chainless:<base64url-of-sha256-of-pubkey>
 */
export function generateDID(publicKeyHex) {
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest();
  const id = hash.toString("base64url").slice(0, 32);
  return `did:chainless:${id}`;
}

/**
 * Create a DID Document (W3C DID Core spec subset).
 */
export function createDIDDocument(did, publicKeyHex, displayName) {
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex: publicKeyHex,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    service: displayName
      ? [
          {
            id: `${did}#profile`,
            type: "ProfileService",
            serviceEndpoint: { name: displayName },
          },
        ]
      : [],
    created: new Date().toISOString(),
  };
}

/**
 * Create a new DID identity and store in DB.
 */
export function createIdentity(db, displayName) {
  ensureDIDTables(db);

  const keys = generateKeyPair();
  const did = generateDID(keys.publicKey);
  const doc = createDIDDocument(did, keys.publicKey, displayName);

  // If no identities exist, this becomes the default
  const count = db.prepare("SELECT COUNT(*) as c FROM did_identities").get().c;
  const isDefault = count === 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO did_identities (did, display_name, public_key, secret_key, did_document, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    did,
    displayName || null,
    keys.publicKey,
    keys.secretKey,
    JSON.stringify(doc),
    isDefault,
  );

  return {
    did,
    displayName,
    publicKey: keys.publicKey,
    document: doc,
    isDefault: isDefault === 1,
  };
}

/**
 * Get identity by DID or prefix.
 */
export function getIdentity(db, didOrPrefix) {
  ensureDIDTables(db);
  return db
    .prepare("SELECT * FROM did_identities WHERE did LIKE ?")
    .get(`${didOrPrefix}%`);
}

/**
 * Get all identities.
 */
export function getAllIdentities(db) {
  ensureDIDTables(db);
  return db
    .prepare(
      "SELECT * FROM did_identities ORDER BY is_default DESC, created_at DESC",
    )
    .all();
}

/**
 * Get the default identity.
 */
export function getDefaultIdentity(db) {
  ensureDIDTables(db);
  return db.prepare("SELECT * FROM did_identities WHERE is_default = 1").get();
}

/**
 * Set an identity as the default.
 */
export function setDefaultIdentity(db, did) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) return false;

  db.prepare("UPDATE did_identities SET is_default = ? WHERE did LIKE ?").run(
    0,
    "%",
  );
  db.prepare("UPDATE did_identities SET is_default = ? WHERE did = ?").run(
    1,
    identity.did,
  );
  return true;
}

/**
 * Delete an identity by DID.
 */
export function deleteIdentity(db, did) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) return false;

  const result = db
    .prepare("DELETE FROM did_identities WHERE did = ?")
    .run(identity.did);
  if (result.changes > 0 && identity.is_default) {
    // Promote next identity to default
    const next = db
      .prepare("SELECT did FROM did_identities ORDER BY created_at ASC LIMIT 1")
      .get();
    if (next) {
      db.prepare("UPDATE did_identities SET is_default = 1 WHERE did = ?").run(
        next.did,
      );
    }
  }
  return result.changes > 0;
}

/**
 * Sign a message using an identity's secret key.
 * Returns the signature as hex string.
 */
export function signMessage(db, did, message) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) throw new Error(`Identity not found: ${did}`);

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(identity.secret_key, "hex"),
    format: "der",
    type: "pkcs8",
  });

  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return signature.toString("hex");
}

/**
 * Verify a signature against a message and public key.
 */
export function verifySignature(publicKeyHex, message, signatureHex) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });

    return crypto.verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureHex, "hex"),
    );
  } catch (_err) {
    // Invalid key or signature format
    return false;
  }
}

/**
 * Verify a signature using a DID from the database.
 */
export function verifyWithDID(db, did, message, signatureHex) {
  const identity = getIdentity(db, did);
  if (!identity) throw new Error(`Identity not found: ${did}`);
  return verifySignature(identity.public_key, message, signatureHex);
}

/**
 * Export identity (public data only, no secret key).
 */
export function exportIdentity(db, did) {
  const identity = getIdentity(db, did);
  if (!identity) return null;

  return {
    did: identity.did,
    displayName: identity.display_name,
    publicKey: identity.public_key,
    document: JSON.parse(identity.did_document || "{}"),
    createdAt: identity.created_at,
  };
}

/**
 * Resolve a DID — returns the DID document.
 * Currently local-only resolution.
 */
export function resolveDID(db, did) {
  const identity = getIdentity(db, did);
  if (!identity) return null;
  return JSON.parse(identity.did_document || "{}");
}
