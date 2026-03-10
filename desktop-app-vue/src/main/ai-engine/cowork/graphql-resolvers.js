const { logger } = require("../../utils/logger.js");

function createResolvers(deps = {}) {
  const {
    webauthnManager,
    zkpEngine,
    zkpVC,
    flManager,
    flAggregator,
    ipfsClusterManager,
    graphqlManager,
  } = deps;

  return {
    // Query resolvers
    did: async ({ id }, context) => {
      if (context.didManager) {
        try {
          return await context.didManager.resolve(id);
        } catch (_err) {
          return null;
        }
      }
      return null;
    },
    dids: async ({ filter }, context) => {
      if (context.didManager) {
        try {
          return await context.didManager.list(filter || {});
        } catch (_err) {
          return [];
        }
      }
      return [];
    },
    passkey: ({ credentialId }) => {
      if (!webauthnManager?.initialized) {
        return null;
      }
      const passkeys = webauthnManager.listPasskeys({ credentialId });
      return passkeys[0] || null;
    },
    passkeys: ({ rpId }) => {
      if (!webauthnManager?.initialized) {
        return [];
      }
      return webauthnManager.listPasskeys(rpId ? { rpId } : {});
    },
    proof: ({ id }) => {
      if (!zkpEngine?.initialized) {
        return null;
      }
      return zkpEngine.getProof(id);
    },
    proofs: ({ filter }) => {
      if (!zkpEngine?.initialized) {
        return [];
      }
      return zkpEngine.listProofs(filter || {});
    },
    credential: ({ id }) => {
      if (!zkpVC?.initialized) {
        return null;
      }
      const creds = zkpVC.listCredentials({ id });
      return creds[0] || null;
    },
    credentials: ({ filter }) => {
      if (!zkpVC?.initialized) {
        return [];
      }
      return zkpVC.listCredentials(filter || {});
    },
    flTask: ({ id }) => {
      if (!flManager?.initialized) {
        return null;
      }
      return flManager.getTaskStatus(id);
    },
    flTasks: ({ filter }) => {
      if (!flManager?.initialized) {
        return [];
      }
      return flManager.listTasks(filter || {});
    },
    flParticipants: ({ taskId }) => {
      if (!flManager?.initialized) {
        return [];
      }
      const status = flManager.getTaskStatus(taskId);
      return status?.participants || [];
    },
    clusterNode: ({ id }) => {
      if (!ipfsClusterManager?.initialized) {
        return null;
      }
      return ipfsClusterManager.getNodeStatus(id);
    },
    clusterNodes: ({ filter }) => {
      if (!ipfsClusterManager?.initialized) {
        return [];
      }
      return ipfsClusterManager.listNodes(filter || {});
    },
    clusterPin: ({ id }) => {
      if (!ipfsClusterManager?.initialized) {
        return null;
      }
      return ipfsClusterManager.getPinStatus(id);
    },
    clusterPins: ({ filter }) => {
      if (!ipfsClusterManager?.initialized) {
        return [];
      }
      return ipfsClusterManager.listPins(filter || {});
    },
    clusterHealth: () => {
      if (!ipfsClusterManager?.initialized) {
        return {
          healthy: 0,
          degraded: 0,
          offline: 0,
          totalNodes: 0,
          underReplicatedPins: 0,
        };
      }
      return ipfsClusterManager.checkHealth();
    },
    stats: () => {
      return {
        totalPasskeys: webauthnManager?.initialized
          ? webauthnManager.getStats().totalPasskeys
          : 0,
        totalProofs: zkpEngine?.initialized
          ? zkpEngine.getStats().totalProofs
          : 0,
        totalCredentials: zkpVC?.initialized
          ? zkpVC.getStats().totalCredentials
          : 0,
        totalFLTasks: flManager?.initialized
          ? flManager.getStats().totalTasks
          : 0,
        totalClusterNodes: ipfsClusterManager?.initialized
          ? ipfsClusterManager.getStats().totalNodes
          : 0,
        totalClusterPins: ipfsClusterManager?.initialized
          ? ipfsClusterManager.getStats().totalPins
          : 0,
        totalApiKeys: graphqlManager?.initialized
          ? graphqlManager.getStats().totalApiKeys
          : 0,
        totalQueries: graphqlManager?.initialized
          ? graphqlManager.getStats().totalQueries
          : 0,
      };
    },
    apiKeys: () => {
      if (!graphqlManager?.initialized) {
        return [];
      }
      return graphqlManager.listAPIKeys();
    },
    queryLog: ({ limit }) => {
      if (!graphqlManager?.initialized) {
        return [];
      }
      return graphqlManager.getQueryLog({ limit: limit || 100 });
    },

    // Mutation resolvers
    beginRegistration: async ({ rpId, rpName, userId, userName }) => {
      if (!webauthnManager?.initialized) {
        throw new Error("WebAuthn not initialized");
      }
      return await webauthnManager.beginRegistration(
        rpId,
        rpName,
        userId,
        userName,
      );
    },
    completeRegistration: async ({ ceremonyId, attestation }) => {
      if (!webauthnManager?.initialized) {
        throw new Error("WebAuthn not initialized");
      }
      return await webauthnManager.completeRegistration(
        ceremonyId,
        JSON.parse(attestation),
      );
    },
    deletePasskey: ({ credentialId }) => {
      if (!webauthnManager?.initialized) {
        throw new Error("WebAuthn not initialized");
      }
      webauthnManager.deletePasskey(credentialId);
      return true;
    },
    bindDID: ({ credentialId, did }) => {
      if (!webauthnManager?.initialized) {
        throw new Error("WebAuthn not initialized");
      }
      return webauthnManager.bindDID(credentialId, did);
    },
    generateIdentityProof: async ({ proverDid, claims }) => {
      if (!zkpEngine?.initialized) {
        throw new Error("ZKP Engine not initialized");
      }
      const parsedClaims = claims ? JSON.parse(claims) : {};
      return await zkpEngine.generateIdentityProof(proverDid, parsedClaims);
    },
    generateRangeProof: async ({ proverDid, value, min, max }) => {
      if (!zkpEngine?.initialized) {
        throw new Error("ZKP Engine not initialized");
      }
      return await zkpEngine.generateRangeProof(proverDid, value, min, max);
    },
    issueCredential: ({ type, issuerDid, subjectDid, claims }) => {
      if (!zkpVC?.initialized) {
        throw new Error("ZKP VC not initialized");
      }
      return zkpVC.issueCredential({
        type,
        issuerDid,
        subjectDid,
        claims: JSON.parse(claims),
      });
    },
    revokeCredential: ({ id, revokedBy, reason }) => {
      if (!zkpVC?.initialized) {
        throw new Error("ZKP VC not initialized");
      }
      zkpVC.revokeCredential(id, revokedBy, reason);
      return true;
    },
    createFLTask: ({ name, modelType, strategy }) => {
      if (!flManager?.initialized) {
        throw new Error("FL Manager not initialized");
      }
      return flManager.createTask({
        name,
        modelType,
        aggregationStrategy: strategy,
      });
    },
    joinFLTask: ({ taskId, agentDid }) => {
      if (!flManager?.initialized) {
        throw new Error("FL Manager not initialized");
      }
      return flManager.joinTask(taskId, agentDid);
    },
    startTraining: async ({ taskId }) => {
      if (!flManager?.initialized) {
        throw new Error("FL Manager not initialized");
      }
      const result = await flManager.startTraining(taskId);
      return { taskId: result.taskId, round: result.round, status: "training" };
    },
    addClusterNode: ({ peerId, endpoint, region }) => {
      if (!ipfsClusterManager?.initialized) {
        throw new Error("IPFS Cluster not initialized");
      }
      return ipfsClusterManager.addNode({ peerId, endpoint, region });
    },
    removeClusterNode: ({ nodeId }) => {
      if (!ipfsClusterManager?.initialized) {
        throw new Error("IPFS Cluster not initialized");
      }
      ipfsClusterManager.removeNode(nodeId);
      return true;
    },
    pinContent: ({ cid, name, replicationFactor }) => {
      if (!ipfsClusterManager?.initialized) {
        throw new Error("IPFS Cluster not initialized");
      }
      return ipfsClusterManager.pinContent({ cid, name, replicationFactor });
    },
    unpinContent: ({ pinId }) => {
      if (!ipfsClusterManager?.initialized) {
        throw new Error("IPFS Cluster not initialized");
      }
      ipfsClusterManager.unpinContent(pinId);
      return true;
    },
    rebalanceCluster: () => {
      if (!ipfsClusterManager?.initialized) {
        throw new Error("IPFS Cluster not initialized");
      }
      return ipfsClusterManager.rebalance();
    },
    createAPIKey: ({ name, permissions }) => {
      if (!graphqlManager?.initialized) {
        throw new Error("GraphQL Manager not initialized");
      }
      return graphqlManager.createAPIKey(name, { permissions });
    },
    revokeAPIKey: ({ id }) => {
      if (!graphqlManager?.initialized) {
        throw new Error("GraphQL Manager not initialized");
      }
      graphqlManager.revokeAPIKey(id);
      return true;
    },
  };
}

module.exports = { createResolvers };
