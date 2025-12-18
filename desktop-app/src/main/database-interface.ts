/**
 * 数据库接口定义
 * 用于统一内存数据库和SQLCipher数据库的API
 */

export interface KnowledgeItem {
  id: string;
  title: string;
  type: 'note' | 'document' | 'conversation' | 'web_clip';
  content_path: string | null;
  content?: string;
  embedding_path: string | null;
  created_at: number;
  updated_at: number;
  git_commit_hash: string | null;
  device_id: string | null;
  sync_status: 'synced' | 'pending' | 'conflict';
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  parent_tag_id?: string | null;
}

/**
 * 数据库接口 - 所有数据库实现都必须实现这些方法
 */
export interface IDatabase {
  // 初始化
  initialize(encryptionKey?: string): Promise<void>;

  // 知识库操作
  getKnowledgeItems(limit?: number, offset?: number): KnowledgeItem[];
  getKnowledgeItemById(id: string): KnowledgeItem | null;
  addKnowledgeItem(input: {
    title: string;
    type: KnowledgeItem['type'];
    content?: string;
  }): KnowledgeItem;
  updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): boolean;
  deleteKnowledgeItem(id: string): boolean;
  searchKnowledge(query: string): KnowledgeItem[];

  // 清理
  close(): void;
}
