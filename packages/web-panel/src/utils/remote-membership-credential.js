const CHALLENGE_DOMAIN =
  "chainlesschain.remote-membership-authentication-challenge.v1\0";
const CREDENTIAL_SCHEMA = "cc-remote-membership-credential/v1";
const DATABASE_NAME = "cc-remote-membership";
const DATABASE_VERSION = 1;
const STORE_NAME = "credentials";
const LEGACY_STORAGE_PREFIX = "cc.remote-membership.ed25519.v1:";
const STORAGE_UNAVAILABLE = Object.freeze({ storageUnavailable: true });

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new Error(
        "Remote membership challenge contains a non-canonical number",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw new Error("Remote membership challenge is not canonical JSON");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function normalizeSessionId(value) {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (
    !sessionId ||
    sessionId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(sessionId)
  ) {
    throw new Error("Remote membership session id is invalid");
  }
  return sessionId;
}

function normalizePrincipalId(value, { optional = false } = {}) {
  if (optional && (value === null || value === undefined)) return null;
  const principalId = typeof value === "string" ? value.trim() : "";
  if (
    !principalId ||
    principalId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(principalId)
  ) {
    throw new Error("Remote membership principal id is invalid");
  }
  return principalId;
}

function purgeLegacySerializedCredential(sessionId, legacyStorage) {
  try {
    legacyStorage?.removeItem(`${LEGACY_STORAGE_PREFIX}${sessionId}`);
  } catch {
    // Storage can be denied in private mode. Never read or deserialize the old
    // extractable PKCS#8 value; best-effort removal is the only safe migration.
  }
}

function createIndexedDbCredentialStore(indexedDb = globalThis.indexedDB) {
  if (!indexedDb || typeof indexedDb.open !== "function") return null;
  let databasePromise = null;

  function database() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Remote membership database failed"));
      request.onblocked = () =>
        reject(new Error("Remote membership database upgrade is blocked"));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function requestResult(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      let duplicate = false;
      const request = operation(store);
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          duplicate = true;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      };
      transaction.oncomplete = () =>
        resolve(duplicate ? { duplicate: true } : { result });
      transaction.onerror = () =>
        reject(
          transaction.error ||
            request.error ||
            new Error("Credential transaction failed"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ||
            request.error ||
            new Error("Credential transaction aborted"),
        );
    });
  }

  return Object.freeze({
    async get(sessionId) {
      return (await requestResult("readonly", (store) => store.get(sessionId)))
        .result;
    },
    async add(record) {
      const outcome = await requestResult("readwrite", (store) =>
        store.add(record),
      );
      return outcome.duplicate !== true;
    },
    async put(record) {
      await requestResult("readwrite", (store) => store.put(record));
    },
    async delete(sessionId) {
      await requestResult("readwrite", (store) => store.delete(sessionId));
    },
  });
}

function validateCryptoKey(key, { type, usage, extractable }) {
  if (
    !key ||
    key.type !== type ||
    key.algorithm?.name !== "Ed25519" ||
    key.extractable !== extractable ||
    !Array.isArray(key.usages) ||
    key.usages.length !== 1 ||
    key.usages[0] !== usage
  ) {
    throw new Error("Remote membership credential record is invalid");
  }
}

function validateCredentialRecord(record, sessionId) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.schema !== CREDENTIAL_SCHEMA ||
    record.sessionId !== sessionId
  ) {
    throw new Error("Remote membership credential record is invalid");
  }
  validateCryptoKey(record.publicKey, {
    type: "public",
    usage: "verify",
    extractable: true,
  });
  validateCryptoKey(record.privateKey, {
    type: "private",
    usage: "sign",
    extractable: false,
  });
  normalizePrincipalId(record.principalId, { optional: true });
  return record;
}

export function createRemoteMembershipCredentialManager({
  subtle = globalThis.crypto?.subtle,
  credentialStore = createIndexedDbCredentialStore(),
  legacyStorage = (() => {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  })(),
} = {}) {
  if (!subtle) throw new Error("WebCrypto is required for durable pairing");
  const volatileCredentials = new Map();
  const inFlight = new Map();

  function withSessionLock(sessionId, operation) {
    const prior = inFlight.get(sessionId) || Promise.resolve();
    const current = prior.then(operation, operation);
    inFlight.set(sessionId, current);
    return current.finally(() => {
      if (inFlight.get(sessionId) === current) inFlight.delete(sessionId);
    });
  }

  async function removeInvalidRecord(sessionId) {
    volatileCredentials.delete(sessionId);
    try {
      await credentialStore?.delete(sessionId);
    } catch {
      // A corrupt/unsupported persistent record must never be used. If storage
      // is unavailable, the tab-scoped replacement remains fail-safe.
    }
  }

  async function loadRecord(sessionId) {
    const volatile = volatileCredentials.get(sessionId);
    if (volatile) {
      try {
        return {
          record: validateCredentialRecord(volatile, sessionId),
          persistence: "memory",
        };
      } catch {
        volatileCredentials.delete(sessionId);
      }
    }
    if (!credentialStore) return null;
    let persisted;
    try {
      persisted = await credentialStore.get(sessionId);
    } catch {
      return STORAGE_UNAVAILABLE;
    }
    if (!persisted) return null;
    try {
      return {
        record: validateCredentialRecord(persisted, sessionId),
        persistence: "indexeddb",
      };
    } catch {
      await removeInvalidRecord(sessionId);
      return null;
    }
  }

  async function materialize(record, persistence) {
    const publicKeySpki = await subtle.exportKey("spki", record.publicKey);
    const publicKey = toBase64Url(publicKeySpki);
    const credentialPrincipalId = `ed25519:${toHex(
      await subtle.digest("SHA-256", publicKeySpki),
    )}`;
    if (record.principalId && record.principalId !== credentialPrincipalId) {
      throw new Error("Remote membership principal binding changed");
    }
    return Object.freeze({
      publicKey,
      privateKey: record.privateKey,
      principalId: record.principalId || null,
      // The coordinator derives principal identity from SHA-256(SPKI). Keep
      // that deterministic candidate available before the one-shot join is
      // dispatched, so a lost join response can be reconciled by possession
      // proof without replaying the pairing token.
      credentialPrincipalId,
      persistence,
    });
  }

  async function createRecord(sessionId, { memoryOnly = false } = {}) {
    const pair = await subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ]);
    const record = validateCredentialRecord(
      {
        schema: CREDENTIAL_SCHEMA,
        sessionId,
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        principalId: null,
      },
      sessionId,
    );
    if (credentialStore && !memoryOnly) {
      let added;
      try {
        added = await credentialStore.add(record);
      } catch {
        // IndexedDB can be unavailable in private/embedded contexts. Retain a
        // non-extractable key in memory for this tab; never serialize PKCS#8.
        volatileCredentials.set(sessionId, record);
        return { record, persistence: "memory" };
      }
      if (added) return { record, persistence: "indexeddb" };
      const winner = await loadRecord(sessionId);
      if (winner && winner !== STORAGE_UNAVAILABLE) return winner;
      // Another browsing context won the unique-key race. If its record cannot
      // be read, do not mint a divergent principal key in memory.
      throw new Error("Concurrent credential creation did not persist a key");
    }
    volatileCredentials.set(sessionId, record);
    return { record, persistence: "memory" };
  }

  async function getOrCreateUnlocked(sessionId) {
    purgeLegacySerializedCredential(sessionId, legacyStorage);
    const existing = await loadRecord(sessionId);
    const selected =
      existing === STORAGE_UNAVAILABLE
        ? await createRecord(sessionId, { memoryOnly: true })
        : existing || (await createRecord(sessionId));
    return materialize(selected.record, selected.persistence);
  }

  return Object.freeze({
    getOrCreate(sessionIdValue) {
      const sessionId = normalizeSessionId(sessionIdValue);
      return withSessionLock(sessionId, () => getOrCreateUnlocked(sessionId));
    },
    rememberPrincipal(sessionIdValue, principalIdValue) {
      const sessionId = normalizeSessionId(sessionIdValue);
      const principalId = normalizePrincipalId(principalIdValue);
      return withSessionLock(sessionId, async () => {
        const existing = await loadRecord(sessionId);
        if (existing === STORAGE_UNAVAILABLE) {
          throw new Error(
            "Remote membership principal persistence is unavailable",
          );
        }
        const loaded = existing || (await createRecord(sessionId));
        const materialized = await materialize(
          loaded.record,
          loaded.persistence,
        );
        if (principalId !== materialized.credentialPrincipalId) {
          throw new Error("Remote membership principal binding changed");
        }
        if (
          loaded.record.principalId &&
          loaded.record.principalId !== principalId
        ) {
          throw new Error("Remote membership principal binding changed");
        }
        // A previously committed binding is already restart-safe and needs no
        // new write (important when a host close/re-enable happens while IDB is
        // temporarily read-only). A new marker, however, is the recovery point
        // for an outcome-unknown one-shot join and must be durable before that
        // join can be dispatched.
        if (
          loaded.record.principalId === principalId &&
          loaded.persistence === "indexeddb"
        ) {
          return materialized;
        }
        if (loaded.persistence !== "indexeddb" || !credentialStore) {
          throw new Error(
            "Remote membership principal could not be persisted before join",
          );
        }
        const record = validateCredentialRecord(
          { ...loaded.record, principalId },
          sessionId,
        );
        try {
          await credentialStore.put(record);
        } catch (cause) {
          throw new Error(
            "Remote membership principal could not be persisted before join",
            { cause },
          );
        }
        return materialize(record, "indexeddb");
      });
    },
    forget(sessionIdValue) {
      const sessionId = normalizeSessionId(sessionIdValue);
      return withSessionLock(sessionId, async () => {
        purgeLegacySerializedCredential(sessionId, legacyStorage);
        volatileCredentials.delete(sessionId);
        try {
          await credentialStore?.delete(sessionId);
        } catch {
          // Revocation is already authoritative on the host. Local cleanup is
          // best effort and must not recreate or expose the old private key.
        }
      });
    },
  });
}

let defaultManager = null;

function manager() {
  if (!defaultManager)
    defaultManager = createRemoteMembershipCredentialManager();
  return defaultManager;
}

export function getOrCreateRemoteMembershipCredential(sessionId) {
  return manager().getOrCreate(sessionId);
}

export function rememberRemoteMembershipPrincipal(sessionId, principalId) {
  return manager().rememberPrincipal(sessionId, principalId);
}

export function forgetRemoteMembershipCredential(sessionId) {
  return manager().forget(sessionId);
}

export async function signRemoteMembershipChallenge(challenge, privateKey) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !privateKey) {
    throw new Error("Remote membership signing credential is unavailable");
  }
  validateCryptoKey(privateKey, {
    type: "private",
    usage: "sign",
    extractable: false,
  });
  const encoder = new TextEncoder();
  const domain = encoder.encode(CHALLENGE_DOMAIN);
  const payload = encoder.encode(canonicalJson(challenge));
  const bytes = new Uint8Array(domain.length + payload.length);
  bytes.set(domain, 0);
  bytes.set(payload, domain.length);
  return toBase64Url(await subtle.sign({ name: "Ed25519" }, privateKey, bytes));
}
