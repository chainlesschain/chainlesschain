const typeDefs = `
  type Query {
    # Identity & Auth
    did(id: String!): DID
    dids(filter: DIDFilter): [DID!]!
    passkey(credentialId: String!): Passkey
    passkeys(rpId: String): [Passkey!]!

    # ZKP
    proof(id: String!): ZKPProof
    proofs(filter: ProofFilter): [ZKPProof!]!
    credential(id: String!): VerifiableCredential
    credentials(filter: CredentialFilter): [VerifiableCredential!]!

    # Federated Learning
    flTask(id: String!): FLTask
    flTasks(filter: FLTaskFilter): [FLTask!]!
    flParticipants(taskId: String!): [FLParticipant!]!

    # IPFS Cluster
    clusterNode(id: String!): ClusterNode
    clusterNodes(filter: NodeFilter): [ClusterNode!]!
    clusterPin(id: String!): ClusterPin
    clusterPins(filter: PinFilter): [ClusterPin!]!
    clusterHealth: ClusterHealth!

    # System
    stats: SystemStats!
    apiKeys: [APIKey!]!
    queryLog(limit: Int): [QueryLogEntry!]!
  }

  type Mutation {
    # WebAuthn
    beginRegistration(rpId: String!, rpName: String!, userId: String!, userName: String!): CeremonyOptions!
    completeRegistration(ceremonyId: String!, attestation: String!): Passkey!
    deletePasskey(credentialId: String!): Boolean!
    bindDID(credentialId: String!, did: String!): Passkey!

    # ZKP
    generateIdentityProof(proverDid: String!, claims: String): ZKPProof!
    generateRangeProof(proverDid: String!, value: Float!, min: Float!, max: Float!): ZKPProof!
    issueCredential(type: String!, issuerDid: String!, subjectDid: String!, claims: String!): VerifiableCredential!
    revokeCredential(id: String!, revokedBy: String!, reason: String): Boolean!

    # Federated Learning
    createFLTask(name: String!, modelType: String!, strategy: String): FLTask!
    joinFLTask(taskId: String!, agentDid: String!): FLParticipant!
    startTraining(taskId: String!): TrainingStatus!

    # IPFS Cluster
    addClusterNode(peerId: String!, endpoint: String!, region: String): ClusterNode!
    removeClusterNode(nodeId: String!): Boolean!
    pinContent(cid: String!, name: String, replicationFactor: Int): ClusterPin!
    unpinContent(pinId: String!): Boolean!
    rebalanceCluster: RebalanceResult!

    # API Keys
    createAPIKey(name: String!, permissions: [String!]): APIKeyWithSecret!
    revokeAPIKey(id: String!): Boolean!
  }

  type Subscription {
    passkeyRegistered: Passkey!
    proofGenerated: ZKPProof!
    credentialIssued: VerifiableCredential!
    flRoundCompleted(taskId: String!): FLRoundResult!
    clusterHealthChanged: ClusterHealth!
  }

  # Types
  type DID { id: String!, method: String!, document: String, created_at: String }
  input DIDFilter { method: String }

  type Passkey { id: String!, credentialId: String!, rpId: String!, rpName: String, userId: String!, userName: String, status: String!, didBinding: String, signCount: Int!, createdAt: String! }
  type CeremonyOptions { ceremonyId: String!, challenge: String!, rp: RPInfo!, user: UserInfo!, timeout: Int! }
  type RPInfo { id: String!, name: String! }
  type UserInfo { id: String!, name: String!, displayName: String }

  type ZKPProof { id: String!, proofType: String!, scheme: String!, proverDid: String, status: String!, publicInputs: String, createdAt: String! }
  input ProofFilter { proofType: String, proverDid: String, status: String }

  type VerifiableCredential { id: String!, credentialType: String!, issuerDid: String!, subjectDid: String!, claims: String!, status: String!, expiresAt: String, createdAt: String! }
  input CredentialFilter { type: String, issuerDid: String, subjectDid: String, status: String }

  type FLTask { id: String!, name: String!, modelType: String!, strategy: String!, currentRound: Int!, maxRounds: Int!, status: String!, participantCount: Int, createdAt: String! }
  type FLParticipant { id: String!, taskId: String!, agentDid: String!, status: String!, roundsCompleted: Int! }
  type TrainingStatus { taskId: String!, round: Int!, status: String! }
  type FLRoundResult { taskId: String!, roundNumber: Int!, method: String!, participantCount: Int! }
  input FLTaskFilter { status: String, modelType: String }

  type ClusterNode { id: String!, peerId: String!, endpoint: String!, status: String!, region: String, storageCapacity: Int!, storageUsed: Int!, pinCount: Int!, lastHeartbeat: String! }
  type ClusterPin { id: String!, cid: String!, name: String, replicationFactor: Int!, currentReplicas: Int!, pinStatus: String!, priority: Int!, createdAt: String! }
  type ClusterHealth { healthy: Int!, degraded: Int!, offline: Int!, totalNodes: Int!, underReplicatedPins: Int! }
  type RebalanceResult { moved: Int!, duration: Int! }
  input NodeFilter { status: String, region: String }
  input PinFilter { pinStatus: String, cid: String }

  type APIKey { id: String!, name: String!, permissions: [String!]!, rateLimit: Int!, requestsToday: Int!, status: String!, createdAt: String! }
  type APIKeyWithSecret { id: String!, key: String!, name: String!, permissions: [String!]!, rateLimit: Int!, createdAt: String! }
  type QueryLogEntry { id: String!, operationType: String!, operationName: String, durationMs: Int!, status: String!, createdAt: String! }

  type SystemStats { totalPasskeys: Int!, totalProofs: Int!, totalCredentials: Int!, totalFLTasks: Int!, totalClusterNodes: Int!, totalClusterPins: Int!, totalApiKeys: Int!, totalQueries: Int! }
`;

module.exports = { typeDefs };
