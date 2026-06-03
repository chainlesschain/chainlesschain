/**
 * 统一 Artifact 数据模型（v6 shell）
 *
 * 所有 Artifact 共享同一信封结构：type / created / payload / signatures /
 * permissions / lineage。各类型在 payload 上定义自己的 schema。
 */

export interface ArtifactSignature {
  signer: string;
  alg: "ed25519" | "secp256k1" | "ukey-pkcs11" | "stub";
  signature: string;
  signedAt: number;
  keyRef?: string;
  over: "payload" | "envelope";
}

export interface ArtifactLineageEntry {
  parentId: string;
  relation: "derived-from" | "references" | "replies-to" | "supersedes";
  at: number;
}

export interface ArtifactPermissions {
  readers?: string[];
  writers?: string[];
  public?: boolean;
}

export interface ArtifactEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  version: number;
  createdAt: number;
  createdBy: string;
  spaceId?: string;
  payload: TPayload;
  signatures: ArtifactSignature[];
  permissions: ArtifactPermissions;
  lineage: ArtifactLineageEntry[];
}

// ==================== 5 核心类型 ====================

export interface NotePayload {
  title: string;
  bodyMarkdown: string;
  tags: string[];
  wordCount: number;
}
export type NoteArtifact = ArtifactEnvelope<"note", NotePayload>;

export interface SignPayload {
  targetArtifactId: string;
  targetHash: string;
  purpose: string;
  statement?: string;
}
export type SignArtifact = ArtifactEnvelope<"sign", SignPayload>;

export interface TxPayload {
  chain: string;
  from: string;
  to: string;
  amount: string;
  token: string;
  memo?: string;
  status: "draft" | "signed" | "broadcast" | "confirmed" | "failed";
  txHash?: string;
}
export type TxArtifact = ArtifactEnvelope<"tx", TxPayload>;

export interface P2PPayload {
  peerDid: string;
  channel: string;
  messages: Array<{
    from: string;
    at: number;
    content: string;
    encrypted: boolean;
  }>;
}
export type P2PArtifact = ArtifactEnvelope<"p2p", P2PPayload>;

export interface VCPayload {
  context: string[];
  vcType: string[];
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
  issuanceDate: string;
  expirationDate?: string;
  status: "active" | "revoked" | "expired";
}
export type VCArtifact = ArtifactEnvelope<"vc", VCPayload>;

export interface MessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}
export type MessageArtifact = ArtifactEnvelope<"message", MessagePayload>;

export interface CoworkSessionPayload {
  topic: string;
  agents: Array<{ id: string; role: string }>;
  planId?: string;
  status: "planning" | "running" | "paused" | "done" | "aborted";
  steps: Array<{
    id: string;
    agent: string;
    description: string;
    status: "pending" | "running" | "done" | "failed";
  }>;
}
export type CoworkSessionArtifact = ArtifactEnvelope<
  "cowork-session",
  CoworkSessionPayload
>;

// ==================== 联合类型 ====================

export type AnyArtifact =
  | NoteArtifact
  | SignArtifact
  | TxArtifact
  | P2PArtifact
  | VCArtifact
  | MessageArtifact
  | CoworkSessionArtifact;

export type ArtifactType = AnyArtifact["type"];
