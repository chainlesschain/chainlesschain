import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "crypto";

const PROTOCOL = "chainlesschain.remote-session.e2ee.v1";
const PAIRING_SCHEME = "chainlesschain://remote-session/pair#";

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function unb64(value) {
  return Buffer.from(value, "base64url");
}

function exportPublicKey(key) {
  return b64(key.export({ type: "spki", format: "der" }));
}

function importPublicKey(value) {
  let der = unb64(value);
  if (der.length === 32) {
    // RFC 8410 SubjectPublicKeyInfo prefix for a raw X25519 public key.
    der = Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), der]);
  }
  return createPublicKey({ key: der, type: "spki", format: "der" });
}

function aad(sessionId, senderId, sequence) {
  return Buffer.from(
    `${PROTOCOL}\n${sessionId}\n${senderId}\n${sequence}`,
    "utf8",
  );
}

function deriveKey(privateKey, peerPublicKey, sessionId, pairingToken) {
  const secret = diffieHellman({ privateKey, publicKey: peerPublicKey });
  const salt = createHash("sha256").update(pairingToken, "utf8").digest();
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      salt,
      Buffer.from(`${PROTOCOL}:${sessionId}`),
      32,
    ),
  );
}

export function createRemoteSessionKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: exportPublicKey(publicKey),
    privateKey: b64(privateKey.export({ type: "pkcs8", format: "der" })),
  };
}

export function createRemotePairingUri({
  relayUrl,
  remoteSessionId,
  hostPeerId,
  hostPublicKey,
  pairingToken,
  expiresAt,
}) {
  if (
    !relayUrl ||
    !remoteSessionId ||
    !hostPeerId ||
    !hostPublicKey ||
    !pairingToken
  ) {
    throw new Error("Incomplete Remote Session pairing payload");
  }
  const payload = {
    v: 1,
    relayUrl,
    remoteSessionId,
    hostPeerId,
    hostPublicKey,
    pairingToken,
    expiresAt,
  };
  return `${PAIRING_SCHEME}${b64(JSON.stringify(payload))}`;
}

export function parseRemotePairingUri(uri, now = Date.now()) {
  if (typeof uri !== "string" || !uri.startsWith(PAIRING_SCHEME)) {
    throw new Error("Invalid Remote Session pairing URI");
  }
  let payload;
  try {
    payload = JSON.parse(
      unb64(uri.slice(PAIRING_SCHEME.length)).toString("utf8"),
    );
  } catch {
    throw new Error("Malformed Remote Session pairing payload");
  }
  if (
    payload.v !== 1 ||
    !payload.relayUrl ||
    !payload.remoteSessionId ||
    !payload.hostPeerId ||
    !payload.hostPublicKey ||
    !payload.pairingToken
  ) {
    throw new Error("Incomplete Remote Session pairing payload");
  }
  if (payload.expiresAt && payload.expiresAt <= now) {
    throw new Error("Remote Session pairing payload expired");
  }
  return payload;
}

export class RemoteSessionCryptoContext {
  constructor({ sessionId, localPeerId, privateKey, publicKey } = {}) {
    if (!sessionId || !localPeerId)
      throw new Error("sessionId and localPeerId are required");
    let keyPair;
    if (!privateKey || !publicKey) keyPair = createRemoteSessionKeyPair();
    this.sessionId = sessionId;
    this.localPeerId = localPeerId;
    this.privateKey = createPrivateKey({
      key: unb64(privateKey || keyPair.privateKey),
      type: "pkcs8",
      format: "der",
    });
    this.publicKey = publicKey || keyPair.publicKey;
    this.keys = new Map();
    this.sendSequence = 0;
    this.receivedSequences = new Map();
  }

  pair(peerId, peerPublicKey, pairingToken) {
    if (!peerId || !peerPublicKey || !pairingToken)
      throw new Error("Incomplete peer key material");
    this.keys.set(
      peerId,
      deriveKey(
        this.privateKey,
        importPublicKey(peerPublicKey),
        this.sessionId,
        pairingToken,
      ),
    );
  }

  encrypt(peerId, message) {
    const key = this.keys.get(peerId);
    if (!key) throw new Error(`No encryption key for peer: ${peerId}`);
    const sequence = ++this.sendSequence;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(this.sessionId, this.localPeerId, sequence));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), "utf8"),
      cipher.final(),
    ]);
    return {
      v: 1,
      sessionId: this.sessionId,
      senderId: this.localPeerId,
      sequence,
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
      tag: b64(cipher.getAuthTag()),
    };
  }

  decrypt(envelope) {
    if (envelope?.v !== 1 || envelope.sessionId !== this.sessionId) {
      throw new Error("Invalid encrypted Remote Session envelope");
    }
    const key = this.keys.get(envelope.senderId);
    if (!key)
      throw new Error(`No encryption key for peer: ${envelope.senderId}`);
    const previous = this.receivedSequences.get(envelope.senderId) || 0;
    if (
      !Number.isSafeInteger(envelope.sequence) ||
      envelope.sequence <= previous
    ) {
      throw new Error(
        "Remote Session replay or out-of-order envelope rejected",
      );
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        unb64(envelope.nonce),
      );
      decipher.setAAD(
        aad(this.sessionId, envelope.senderId, envelope.sequence),
      );
      decipher.setAuthTag(unb64(envelope.tag));
      const plaintext = Buffer.concat([
        decipher.update(unb64(envelope.ciphertext)),
        decipher.final(),
      ]);
      const message = JSON.parse(plaintext.toString("utf8"));
      this.receivedSequences.set(envelope.senderId, envelope.sequence);
      return message;
    } catch (error) {
      throw new Error(
        `Remote Session envelope authentication failed: ${error.message}`,
      );
    }
  }
}
