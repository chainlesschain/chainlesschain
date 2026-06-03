/**
 * community-mtc WS handlers — web-shell parity for the full B4 suite.
 *
 * Mirrors the desktop-only `ipcMain.handle('channel:get-message-envelope' /
 * 'channel-archive:*' / 'governance-mofn:*' / 'cross-fed-trust:*')` IPC
 * surface so the Phase 1.6 default web-shell can drive identical UX from
 * the WS protocol.
 *
 * Topic naming convention (dotted, mirrors mtc-status-handlers.js style):
 *   mtc.envelope.get
 *   mtc.archive.push / .restore / .list
 *   mtc.governance-mofn.create / .sign / .status / .finalize / .list
 *   mtc.cross-fed-trust.establish / .revoke / .list / .get-trusted-dids
 *
 * Each handler factory takes an `opts` object with the manager dependency.
 * Missing managers (pre-bootstrap / disabled by config) yield a clean
 * `{success: false, error}` envelope rather than crashing the dispatcher
 * (matches the rest of the web-shell handlers' pattern).
 *
 * @module web-shell/handlers/community-mtc-handlers
 */

// ─────────────────────────────────────────────────────────────────────
// mtc.envelope.get  — channel-message Merkle inclusion proof + landmark
// ─────────────────────────────────────────────────────────────────────
function createEnvelopeGetHandler(opts = {}) {
  const { channelEventBatcher, channelEnvelopeDistribution, p2pManager } = opts;
  return async function envelopeGetHandler(payload = {}) {
    try {
      if (!channelEventBatcher) {
        return { success: false, error: "channelEventBatcher not initialized" };
      }
      const { communityId, messageId } = payload;
      if (!communityId || !messageId) {
        return { success: false, error: "communityId + messageId required" };
      }
      // 1. Local + previously-cached remote
      const local = channelEventBatcher.loadEnvelopeAndLandmark(
        communityId,
        messageId,
      );
      if (local && local.found) {
        return { success: true, ...local };
      }

      // 2. Lazy peer-pull (mirrors community-ipc.js channel:get-message-envelope)
      if (
        channelEnvelopeDistribution &&
        p2pManager &&
        typeof p2pManager.getConnectedPeers === "function"
      ) {
        let peers = [];
        try {
          peers = p2pManager.getConnectedPeers() || [];
        } catch (_err) {
          peers = [];
        }
        for (const p of peers) {
          const peerId = typeof p === "string" ? p : p && (p.peerId || p.id);
          if (!peerId) {
            continue;
          }
          try {
            const env = await channelEnvelopeDistribution.requestEnvelope(
              peerId,
              communityId,
              messageId,
            );
            if (env) {
              const refreshed = channelEventBatcher.loadEnvelopeAndLandmark(
                communityId,
                messageId,
              );
              return { success: true, ...refreshed };
            }
          } catch (_peerErr) {
            /* try next */
          }
        }
      }
      return {
        success: false,
        error: "envelope not found locally or among peers",
      };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// mtc.archive.* — push / restore / list via filesystem or webdav provider
// ─────────────────────────────────────────────────────────────────────
function _resolveProvider(archiveProviderFactory, providerSpec) {
  if (typeof archiveProviderFactory !== "function") {
    throw new Error(
      "archiveProviderFactory not injected — main process did not register B4-archive provider factory",
    );
  }
  if (!providerSpec || typeof providerSpec !== "object") {
    throw new Error("provider spec required ({kind, ...opts})");
  }
  return archiveProviderFactory(providerSpec);
}

function createArchivePushHandler(opts = {}) {
  const { channelEnvelopeArchiver, archiveProviderFactory } = opts;
  return async function archivePushHandler(payload = {}) {
    try {
      if (!channelEnvelopeArchiver) {
        return {
          success: false,
          error: "channelEnvelopeArchiver not initialized",
        };
      }
      const { communityId, providerSpec, packOpts } = payload;
      if (!communityId) {
        return { success: false, error: "communityId required" };
      }
      const provider = _resolveProvider(archiveProviderFactory, providerSpec);
      const result = await channelEnvelopeArchiver.push(
        provider,
        communityId,
        packOpts || {},
      );
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createArchiveRestoreHandler(opts = {}) {
  const { channelEnvelopeArchiver, archiveProviderFactory } = opts;
  return async function archiveRestoreHandler(payload = {}) {
    try {
      if (!channelEnvelopeArchiver) {
        return {
          success: false,
          error: "channelEnvelopeArchiver not initialized",
        };
      }
      const { communityId, archiveName, providerSpec } = payload;
      if (!communityId || !archiveName) {
        return { success: false, error: "communityId + archiveName required" };
      }
      const provider = _resolveProvider(archiveProviderFactory, providerSpec);
      const result = await channelEnvelopeArchiver.restore(
        provider,
        communityId,
        archiveName,
      );
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createArchiveListHandler(opts = {}) {
  const { channelEnvelopeArchiver, archiveProviderFactory } = opts;
  return async function archiveListHandler(payload = {}) {
    try {
      if (!channelEnvelopeArchiver) {
        return {
          success: false,
          error: "channelEnvelopeArchiver not initialized",
        };
      }
      const { communityId, providerSpec } = payload;
      if (!communityId) {
        return { success: false, error: "communityId required" };
      }
      const provider = _resolveProvider(archiveProviderFactory, providerSpec);
      const archives = await channelEnvelopeArchiver.list(
        provider,
        communityId,
      );
      return { success: true, archives };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// mtc.auto-archive.* — periodic ChannelEnvelopeArchiver.push runner
//   (B4-auto-archive v1)
// ─────────────────────────────────────────────────────────────────────

function createAutoArchiveConfigGetHandler(opts = {}) {
  const { autoArchiveScheduler } = opts;
  return async function () {
    try {
      if (!autoArchiveScheduler) {
        return {
          success: false,
          error: "autoArchiveScheduler not initialized",
        };
      }
      return { success: true, config: autoArchiveScheduler.getConfig() };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createAutoArchiveConfigSetHandler(opts = {}) {
  const { autoArchiveScheduler } = opts;
  return async function (payload = {}) {
    try {
      if (!autoArchiveScheduler) {
        return {
          success: false,
          error: "autoArchiveScheduler not initialized",
        };
      }
      const { patch } = payload;
      const config = await autoArchiveScheduler.setConfig(patch || {});
      return { success: true, config };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createAutoArchiveRunNowHandler(opts = {}) {
  const { autoArchiveScheduler } = opts;
  return async function () {
    try {
      if (!autoArchiveScheduler) {
        return {
          success: false,
          error: "autoArchiveScheduler not initialized",
        };
      }
      const result = await autoArchiveScheduler.runOnce();
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// B4-cred-persist v1: lightweight check so UI can render the
// "use stored WebDAV credentials" toggle as enabled/disabled.
// Returns only a boolean — never the credential itself. The check
// reuses the Phase 3c sync-credentials store so a single saved
// WebDAV config in Settings → 同步 → WebDAV powers both sync and
// archive without re-prompting the user.
function createArchiveHasStoredWebdavCredentialsHandler(opts = {}) {
  const { syncCredentials } = opts;
  return async function () {
    try {
      if (
        !syncCredentials ||
        typeof syncCredentials.hasCredentials !== "function"
      ) {
        return { success: false, error: "syncCredentials not injected" };
      }
      return {
        success: true,
        hasCredentials: syncCredentials.hasCredentials("webdav"),
      };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// mtc.governance-mofn.* — M-of-N proposal lifecycle
// ─────────────────────────────────────────────────────────────────────
function createGovernanceMofnCreateHandler(opts = {}) {
  const { governanceMultiSig } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      const proposal = governanceMultiSig.createProposal(payload);
      return { success: true, proposal };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGovernanceMofnSignHandler(opts = {}) {
  const { governanceMultiSig } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      const { communityId, proposalId, signerKeys } = payload;
      if (!signerKeys || !signerKeys.did) {
        return {
          success: false,
          error: "signerKeys missing did/secretKey/publicKey",
        };
      }
      const revived = {
        did: signerKeys.did,
        secretKey: Buffer.from(signerKeys.secretKey, "base64"),
        publicKey: Buffer.from(signerKeys.publicKey, "base64"),
      };
      const status = governanceMultiSig.addSignature(
        communityId,
        proposalId,
        revived,
      );
      return { success: true, status };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// B4-mofn-sign v2 — sign-as-self. Renderer sends ONLY (communityId,
// proposalId); main process resolves the current identity via DIDManager
// and signs locally. Private key NEVER crosses any wire (IPC or WS).
// This is the secure default the web-panel UI should drive.
function createGovernanceMofnSignAsSelfHandler(opts = {}) {
  const { governanceMultiSig, didManager } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      if (!didManager || typeof didManager.getCurrentIdentity !== "function") {
        return {
          success: false,
          error:
            "didManager not initialized (cannot resolve current identity to sign)",
        };
      }
      const { communityId, proposalId } = payload;
      const identity = didManager.getCurrentIdentity();
      if (!identity || !identity.did) {
        return {
          success: false,
          error: "no current DID identity (not logged in)",
        };
      }
      if (!identity.public_key_sign || !identity.private_key_ref) {
        return {
          success: false,
          error:
            "current identity missing signing keys (public_key_sign / private_key_ref)",
        };
      }
      let secretKeyB64;
      try {
        const ref = JSON.parse(identity.private_key_ref);
        secretKeyB64 = ref && ref.sign;
      } catch (err) {
        return {
          success: false,
          error: "private_key_ref not parseable JSON: " + err.message,
        };
      }
      if (!secretKeyB64) {
        return { success: false, error: "private_key_ref.sign missing" };
      }
      const signerKeys = {
        did: identity.did,
        secretKey: Buffer.from(secretKeyB64, "base64"),
        publicKey: Buffer.from(identity.public_key_sign, "base64"),
      };
      const status = governanceMultiSig.addSignature(
        communityId,
        proposalId,
        signerKeys,
      );
      return { success: true, status, signerDID: identity.did };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGovernanceMofnStatusHandler(opts = {}) {
  const { governanceMultiSig } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      const { communityId, proposalId } = payload;
      const status = governanceMultiSig.getStatus(communityId, proposalId);
      return { success: true, status };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGovernanceMofnFinalizeHandler(opts = {}) {
  const { governanceMultiSig } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      const { communityId, proposalId } = payload;
      const result = governanceMultiSig.finalize(communityId, proposalId);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGovernanceMofnListHandler(opts = {}) {
  const { governanceMultiSig } = opts;
  return async function (payload = {}) {
    try {
      if (!governanceMultiSig) {
        return { success: false, error: "governanceMultiSig not initialized" };
      }
      const { communityId } = payload;
      const proposals = governanceMultiSig.listProposals(communityId);
      return { success: true, proposals };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// mtc.cross-fed-trust.* — cross-federation trust anchor management
// ─────────────────────────────────────────────────────────────────────
function createCrossFedTrustEstablishHandler(opts = {}) {
  const { crossFedTrust } = opts;
  return async function (payload = {}) {
    try {
      if (!crossFedTrust) {
        return { success: false, error: "crossFedTrust not initialized" };
      }
      const { localCommunityId, ...rest } = payload;
      const record = crossFedTrust.establishTrust(localCommunityId, rest);
      return { success: true, record };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createCrossFedTrustRevokeHandler(opts = {}) {
  const { crossFedTrust } = opts;
  return async function (payload = {}) {
    try {
      if (!crossFedTrust) {
        return { success: false, error: "crossFedTrust not initialized" };
      }
      const { localCommunityId, remoteCommunityId } = payload;
      const removed = crossFedTrust.revokeTrust(
        localCommunityId,
        remoteCommunityId,
      );
      return { success: true, removed };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createCrossFedTrustListHandler(opts = {}) {
  const { crossFedTrust } = opts;
  return async function (payload = {}) {
    try {
      if (!crossFedTrust) {
        return { success: false, error: "crossFedTrust not initialized" };
      }
      const { localCommunityId } = payload;
      const records = crossFedTrust.listTrusted(localCommunityId);
      return { success: true, records };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createCrossFedTrustGetTrustedDidsHandler(opts = {}) {
  const { crossFedTrust } = opts;
  return async function (payload = {}) {
    try {
      if (!crossFedTrust) {
        return { success: false, error: "crossFedTrust not initialized" };
      }
      const { localCommunityId } = payload;
      const dids = crossFedTrust.getTrustedDIDs(localCommunityId);
      return { success: true, dids };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate factory — returns the full WS-topic → handler map
// ─────────────────────────────────────────────────────────────────────
function createCommunityMtcHandlers(opts = {}) {
  return {
    "mtc.envelope.get": createEnvelopeGetHandler(opts),

    "mtc.archive.push": createArchivePushHandler(opts),
    "mtc.archive.restore": createArchiveRestoreHandler(opts),
    "mtc.archive.list": createArchiveListHandler(opts),
    "mtc.archive.has-stored-webdav-credentials":
      createArchiveHasStoredWebdavCredentialsHandler(opts),

    "mtc.auto-archive.config-get": createAutoArchiveConfigGetHandler(opts),
    "mtc.auto-archive.config-set": createAutoArchiveConfigSetHandler(opts),
    "mtc.auto-archive.run-now": createAutoArchiveRunNowHandler(opts),

    "mtc.governance-mofn.create": createGovernanceMofnCreateHandler(opts),
    "mtc.governance-mofn.sign": createGovernanceMofnSignHandler(opts),
    "mtc.governance-mofn.sign-as-self":
      createGovernanceMofnSignAsSelfHandler(opts),
    "mtc.governance-mofn.status": createGovernanceMofnStatusHandler(opts),
    "mtc.governance-mofn.finalize": createGovernanceMofnFinalizeHandler(opts),
    "mtc.governance-mofn.list": createGovernanceMofnListHandler(opts),

    "mtc.cross-fed-trust.establish": createCrossFedTrustEstablishHandler(opts),
    "mtc.cross-fed-trust.revoke": createCrossFedTrustRevokeHandler(opts),
    "mtc.cross-fed-trust.list": createCrossFedTrustListHandler(opts),
    "mtc.cross-fed-trust.get-trusted-dids":
      createCrossFedTrustGetTrustedDidsHandler(opts),
  };
}

module.exports = {
  createCommunityMtcHandlers,
  // Per-handler exports kept for fine-grained testing / partial mounting
  createEnvelopeGetHandler,
  createArchivePushHandler,
  createArchiveRestoreHandler,
  createArchiveListHandler,
  createArchiveHasStoredWebdavCredentialsHandler,
  createAutoArchiveConfigGetHandler,
  createAutoArchiveConfigSetHandler,
  createAutoArchiveRunNowHandler,
  createGovernanceMofnCreateHandler,
  createGovernanceMofnSignHandler,
  createGovernanceMofnSignAsSelfHandler,
  createGovernanceMofnStatusHandler,
  createGovernanceMofnFinalizeHandler,
  createGovernanceMofnListHandler,
  createCrossFedTrustEstablishHandler,
  createCrossFedTrustRevokeHandler,
  createCrossFedTrustListHandler,
  createCrossFedTrustGetTrustedDidsHandler,
};
