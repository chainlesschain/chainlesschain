/**
 * Artifact Store — v6 shell 对话侧产物栈
 *
 * 持有当前激活 artifact、历史栈、动作派发。
 * 真实后端（DB + IPFS + 链上锚定）接入在 P3/P4；此 store 先提供 in-memory 样本，
 * 以便 ArtifactPanel / 渲染器组件可独立验证。
 */

import { defineStore } from "pinia";
import { logger } from "@/utils/logger";
import type {
  AnyArtifact,
  ArtifactSignature,
  NoteArtifact,
  SignArtifact,
  TxArtifact,
  P2PArtifact,
  VCArtifact,
  CoworkSessionArtifact,
} from "@/types/artifact";

interface ArtifactState {
  byId: Record<string, AnyArtifact>;
  currentId: string | null;
  history: string[];
  lastSeed: number;
}

function nowId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function seedSamples(): AnyArtifact[] {
  const me = "did:cc:demo:0xme";
  const peer = "did:cc:demo:0xpeer";

  const note: NoteArtifact = {
    id: "note-sample-1",
    type: "note",
    version: 1,
    createdAt: Date.now() - 3600_000,
    createdBy: me,
    spaceId: "spaces-personal:work",
    payload: {
      title: "桌面版 UI 重构笔记",
      bodyMarkdown:
        "1. chat-first 布局\n2. 扩展点插件化\n3. Artifact 信封统一\n",
      tags: ["design", "shell", "v6"],
      wordCount: 42,
    },
    signatures: [],
    permissions: { public: false, readers: [me] },
    lineage: [],
  };

  const sign: SignArtifact = {
    id: "sign-sample-1",
    type: "sign",
    version: 1,
    createdAt: Date.now() - 1800_000,
    createdBy: me,
    payload: {
      targetArtifactId: note.id,
      targetHash: "sha256:abc123…def456",
      purpose: "作者署名",
      statement: "我对上述笔记负责",
    },
    signatures: [
      {
        signer: me,
        alg: "stub",
        signature: "STUB_SIG_001",
        signedAt: Date.now() - 1800_000,
        over: "payload",
      },
    ],
    permissions: { public: true },
    lineage: [
      { parentId: note.id, relation: "references", at: Date.now() - 1800_000 },
    ],
  };

  const tx: TxArtifact = {
    id: "tx-sample-1",
    type: "tx",
    version: 1,
    createdAt: Date.now() - 900_000,
    createdBy: me,
    payload: {
      chain: "chainlesschain-mainnet",
      from: "cc1q…me",
      to: "cc1q…alice",
      amount: "12.5",
      token: "CCT",
      memo: "demo transfer",
      status: "draft",
    },
    signatures: [],
    permissions: { readers: [me] },
    lineage: [],
  };

  const p2p: P2PArtifact = {
    id: "p2p-sample-1",
    type: "p2p",
    version: 1,
    createdAt: Date.now() - 300_000,
    createdBy: me,
    payload: {
      peerDid: peer,
      channel: "direct",
      messages: [
        {
          from: me,
          at: Date.now() - 280_000,
          content: "Hi peer",
          encrypted: true,
        },
        {
          from: peer,
          at: Date.now() - 260_000,
          content: "Got it, ACK",
          encrypted: true,
        },
      ],
    },
    signatures: [],
    permissions: { readers: [me, peer] },
    lineage: [],
  };

  const vc: VCArtifact = {
    id: "vc-sample-1",
    type: "vc",
    version: 1,
    createdAt: Date.now() - 86400_000,
    createdBy: me,
    payload: {
      context: ["https://www.w3.org/2018/credentials/v1"],
      vcType: ["VerifiableCredential", "DesktopContributorCredential"],
      issuer: "did:cc:chainlesschain:issuer",
      subject: me,
      claims: { role: "contributor", tier: "core" },
      issuanceDate: new Date(Date.now() - 86400_000).toISOString(),
      status: "active",
    },
    signatures: [
      {
        signer: "did:cc:chainlesschain:issuer",
        alg: "ed25519",
        signature: "ISSUER_SIG_001",
        signedAt: Date.now() - 86400_000,
        over: "envelope",
      },
    ],
    permissions: { public: true },
    lineage: [],
  };

  const cowork: CoworkSessionArtifact = {
    id: "cowork-sample-1",
    type: "cowork-session",
    version: 1,
    createdAt: Date.now() - 600_000,
    createdBy: me,
    payload: {
      topic: "方案调研",
      agents: [
        { id: "researcher-1", role: "researcher" },
        { id: "writer-1", role: "writer" },
      ],
      status: "running",
      steps: [
        {
          id: "s1",
          agent: "researcher-1",
          description: "搜集 3 份对比资料",
          status: "done",
        },
        {
          id: "s2",
          agent: "writer-1",
          description: "整合为调研报告",
          status: "running",
        },
      ],
    },
    signatures: [],
    permissions: { readers: [me] },
    lineage: [],
  };

  return [note, sign, tx, p2p, vc, cowork];
}

export const useArtifactStore = defineStore("artifacts", {
  state: (): ArtifactState => ({
    byId: {},
    currentId: null,
    history: [],
    lastSeed: 0,
  }),

  getters: {
    currentArtifact: (state): AnyArtifact | null =>
      state.currentId ? state.byId[state.currentId] || null : null,

    all: (state): AnyArtifact[] => Object.values(state.byId),

    byType: (state) => (type: string) =>
      Object.values(state.byId).filter((a) => a.type === type),
  },

  actions: {
    seedIfEmpty() {
      if (Object.keys(this.byId).length > 0) return;
      for (const a of seedSamples()) {
        this.byId[a.id] = a;
      }
      this.lastSeed = Date.now();
      logger.debug("[artifacts] seeded", {
        count: Object.keys(this.byId).length,
      });
    },

    open(id: string) {
      if (!this.byId[id]) {
        logger.warn("[artifacts] open: unknown id", id);
        return;
      }
      this.currentId = id;
      this.history = [id, ...this.history.filter((h) => h !== id)].slice(0, 20);
    },

    close() {
      this.currentId = null;
    },

    add(artifact: AnyArtifact) {
      this.byId[artifact.id] = artifact;
    },

    appendSignature(id: string, sig: ArtifactSignature) {
      const art = this.byId[id];
      if (!art) return;
      art.signatures = [...art.signatures, sig];
    },

    async runAction(artifactId: string, actionId: string) {
      const art = this.byId[artifactId];
      if (!art) return;

      logger.debug("[artifacts] runAction", { artifactId, actionId });

      if (actionId === "sign") {
        await this.signArtifact(artifactId);
        return;
      }

      const api: any = (globalThis as any).window?.electronAPI?.artifact;
      if (api && typeof api.runAction === "function") {
        try {
          await api.runAction({ artifactId, actionId });
        } catch (err) {
          logger.warn("[artifacts] IPC action failed:", err);
        }
      }
    },

    async signArtifact(artifactId: string) {
      const art = this.byId[artifactId];
      if (!art) return;

      const api: any = (globalThis as any).window?.electronAPI?.ukey;
      let sig: ArtifactSignature;
      if (api && typeof api.signArtifact === "function") {
        try {
          const result = await api.signArtifact({
            artifactId,
            payload: art.payload,
          });
          sig = {
            signer: result.signer || "did:cc:local:unknown",
            alg: result.alg || "ukey-pkcs11",
            signature: result.signature || nowId("sig"),
            signedAt: Date.now(),
            keyRef: result.keyRef,
            over: "payload",
          };
        } catch (err) {
          logger.warn("[artifacts] U-Key sign failed, fallback to stub:", err);
          sig = {
            signer: art.createdBy,
            alg: "stub",
            signature: nowId("stub-sig"),
            signedAt: Date.now(),
            over: "payload",
          };
        }
      } else {
        sig = {
          signer: art.createdBy,
          alg: "stub",
          signature: nowId("stub-sig"),
          signedAt: Date.now(),
          over: "payload",
        };
      }
      this.appendSignature(artifactId, sig);
    },
  },
});
