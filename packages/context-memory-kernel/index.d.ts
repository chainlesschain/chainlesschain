export type ContextScope = "turn" | "session" | "agent" | "project" | "user" | "global";
export type ContextTrust = "host" | "verified" | "user" | "external" | "untrusted";
export type Sensitivity = "public" | "internal" | "personal" | "secret" | "restricted";
export type MemoryState = "candidate" | "active" | "reinforced" | "superseded" | "archived" | "expired" | "deleted" | "purged";

export interface SourceRef {
  store: string;
  id: string;
  revision?: number;
  eventSequence?: number;
  digest?: string;
  uri?: string;
}

export interface Provenance {
  source: string;
  actor?: string;
  observedAt: string;
  parentDigests?: string[];
  degraded?: boolean;
}

export interface ContentRef {
  store: string;
  objectId: string;
  digest: string;
  byteLength: number;
  mimeType?: string;
  summary: string;
  recoverable: boolean;
  accessPolicy?: string;
}

export interface ContextBinding {
  taskState?: "pending" | "running" | "waiting" | "terminal";
  toolCallId?: string;
  toolRole?: "call" | "result";
  toolOutcome?: "pending" | "succeeded" | "failed" | "unknown";
  approvalId?: string;
  questionId?: string;
  humanTaskId?: string;
  requiredForRecovery?: boolean;
  cwdIdentity?: string;
  worktreeIdentity?: string;
  permissionCeilingDigest?: string;
  budgetRevision?: number;
}

export interface ContextItem {
  schemaVersion: 1;
  itemId: string;
  kind: "system-policy" | "tool-schema" | "skill" | "task-state" | "message" | "tool-evidence" | "memory" | "project-rule" | "artifact-ref";
  scope: ContextScope;
  scopeId?: string;
  sourceRef: SourceRef;
  provenance: Provenance;
  trust: ContextTrust;
  sensitivity: Sensitivity;
  allowedSinks: string[];
  tokenEstimate: number;
  priority: number;
  pinned: boolean;
  createdAt: string;
  expiresAt?: string;
  digest: string;
  content?: string;
  contentRef?: ContentRef;
  binding?: ContextBinding;
}

export interface RetentionPolicy {
  mode: "ephemeral" | "session" | "durable" | "until_expired" | "legal_hold";
  expiresAt?: string;
  maxAgeDays?: number;
  legalHoldId?: string;
}

export interface MemoryRecord {
  schemaVersion: 1;
  memoryId: string;
  scope: ContextScope;
  scopeId?: string;
  category: string;
  content: string;
  contentRef?: ContentRef;
  summary?: string;
  provenance: Provenance;
  evidenceRefs: SourceRef[];
  confidence: number;
  importance: number;
  tags: string[];
  sensitivity: Sensitivity;
  allowedSinks: string[];
  state: MemoryState;
  retentionPolicy: RetentionPolicy;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  supersedes?: string[];
  revision: number;
  digest: string;
  deletionFence?: string;
}

export interface ContextPlan {
  schema: "chainlesschain.context-plan/v1";
  schemaVersion: 1;
  digest: string;
  selected: ContextItem[];
  selectedItemIds: string[];
  dropped: Array<{ itemId: string; digest: string; reason: string; protected: boolean }>;
  inputBudget: number;
  selectedTokens: number;
}

export class ContextMemoryKernelError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export function canonicalJson(value: unknown): string;
export function canonicalDigest(value: unknown, domain?: string): string;
export const CONTEXT_MEMORY_SCHEMA: Readonly<Record<string, unknown>>;
export interface ContextMemoryValidationError { path: string; message: string }
export interface ContextMemoryValidationResult { ok: boolean; errors: readonly ContextMemoryValidationError[] }
export function validateContextMemorySchema(value: unknown): ContextMemoryValidationResult;
export function validateContextMemoryDefinition(name: string, value: unknown): ContextMemoryValidationResult;
export function assertContextMemoryDefinition(name: string, value: unknown): void;
export const INVENTORY_SCHEMA: "chainlesschain.context-memory-writer-inventory/v1";
export const INVENTORY_PATH: string;
export function loadContextMemoryWriterInventory(path?: string): Readonly<Record<string, unknown>>;
export function discoverUnclassifiedContextMemoryWriters(inventory: Record<string, unknown>, options?: Record<string, unknown>): readonly string[];
export function validateContextMemoryWriterInventory(inventory: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function normalizeContextItem(input: unknown): ContextItem;
export function normalizeMemoryRecord(input: unknown): MemoryRecord;
export function planContext(request: Record<string, unknown>): ContextPlan;
export function createMemoryCandidate(request: Record<string, unknown>, options?: Record<string, unknown>): MemoryRecord;
export function applyMemoryCommand(record: MemoryRecord, command: Record<string, unknown>, options?: Record<string, unknown>): { record: MemoryRecord; event: Record<string, unknown>; receipt: Record<string, unknown> };
export function mergeReplicaRecord(local: MemoryRecord, incoming: MemoryRecord): MemoryRecord;

export class ContextMemoryKernel {
  constructor(options?: Record<string, unknown>);
  planContext(request: Record<string, unknown>): Promise<ContextPlan>;
  compactContext(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  recallMemory(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  proposeMemory(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  decideMemory(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteMemory(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  reconcile(operationId: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export class ContextMemoryAuthorityRegistry {
  constructor(options?: Record<string, unknown>);
  bind(input: Record<string, unknown>): Record<string, unknown>;
  get(scopeKey: string): Record<string, unknown> | null;
  assertWriter(input: Record<string, unknown>): Record<string, unknown>;
}

export class InMemorySessionContextPort {
  constructor(seed?: Array<Record<string, unknown>>);
}
export class InMemoryMemoryPort {
  constructor(seed?: MemoryRecord[]);
}
export class InMemoryContentPort {}
export class InMemoryProjectionPurgePort {
  constructor(name: string);
}
