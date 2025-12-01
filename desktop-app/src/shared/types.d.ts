export interface KnowledgeItem {
    id: string;
    title: string;
    type: 'note' | 'document' | 'conversation' | 'web_clip';
    content_path: string | null;
    embedding_path: string | null;
    created_at: number;
    updated_at: number;
    git_commit_hash: string | null;
    device_id: string | null;
    sync_status: 'synced' | 'pending' | 'conflict';
    tags?: Tag[];
    content?: string;
}
export interface Tag {
    id: string;
    name: string;
    color: string;
    created_at: number;
}
export interface KnowledgeTag {
    knowledge_id: string;
    tag_id: string;
    created_at: number;
}
export interface QueryTemplate {
    id: string;
    name: string;
    template: string;
    category: string;
    created_at: number;
}
export interface Conversation {
    id: string;
    title: string;
    knowledge_id: string | null;
    messages: Message[];
    created_at: number;
    updated_at: number;
}
export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    tokens?: number;
}
export interface Device {
    id: string;
    name: string;
    type: 'desktop' | 'mobile';
    public_key: string;
    last_sync: number;
    created_at: number;
}
export interface UKeyStatus {
    detected: boolean;
    unlocked: boolean;
    deviceId?: string;
    publicKey?: string;
}
export interface GitStatus {
    branch: string;
    ahead: number;
    behind: number;
    modified: string[];
    untracked: string[];
    lastSync: number | null;
}
export interface LLMResponse {
    text: string;
    model: string;
    tokens: number;
    timestamp?: number;
}
export interface LLMServiceStatus {
    available: boolean;
    models: string[];
    currentModel?: string;
    error?: string;
}
export interface UserState {
    isAuthenticated: boolean;
    ukeyStatus: UKeyStatus;
    deviceId: string | null;
}
export interface AppConfig {
    theme: 'light' | 'dark';
    llmModel: string;
    gitRemote: string | null;
    autoSync: boolean;
    syncInterval: number;
}
export interface SearchResult {
    item: KnowledgeItem;
    score: number;
    highlights: string[];
}
export interface IPCResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}
export interface CreateKnowledgeItemInput {
    title: string;
    type: KnowledgeItem['type'];
    content?: string;
    tags?: string[];
}
export interface UpdateKnowledgeItemInput {
    title?: string;
    content?: string;
    tags?: string[];
}
//# sourceMappingURL=types.d.ts.map