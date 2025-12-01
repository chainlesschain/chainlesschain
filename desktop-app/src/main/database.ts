import { v4 as uuidv4 } from 'uuid';

export interface KnowledgeItem {
  id: string;
  title: string;
  type: 'note' | 'document' | 'conversation' | 'web_clip';
  content_path: string | null;
  content?: string; // 直接存储内容(内存版本)
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
  created_at: number;
}

/**
 * 内存数据库实现 - MVP版本
 * 生产环境将替换为SQLCipher加密数据库
 */
export class Database {
  private knowledgeItems: Map<string, KnowledgeItem> = new Map();
  // @ts-ignore - 用于未来实现
  private tags: Map<string, Tag> = new Map();

  async initialize(): Promise<void> {
    console.log('初始化内存数据库 (MVP版本)');

    // 创建一些示例数据
    const sampleNote: KnowledgeItem = {
      id: uuidv4(),
      title: '欢迎使用 ChainlessChain',
      type: 'note',
      content_path: null,
      content: '# 欢迎使用 ChainlessChain\n\n这是一个基于U盾加密的个人AI知识库系统。\n\n## 特性\n\n- 完全本地化，数据100%掌控\n- 硬件级加密(U盾/SIMKey)\n- AI原生支持\n- 去中心化同步\n\n开始创建你的第一个笔记吧！',
      embedding_path: null,
      created_at: Date.now() - 86400000, // 1天前
      updated_at: Date.now() - 86400000,
      git_commit_hash: null,
      device_id: 'device-001',
      sync_status: 'synced',
    };

    this.knowledgeItems.set(sampleNote.id, sampleNote);

    console.log(`加载了 ${this.knowledgeItems.size} 个知识项`);
  }

  // 获取知识库项列表
  getKnowledgeItems(limit: number = 100, offset: number = 0): KnowledgeItem[] {
    const items = Array.from(this.knowledgeItems.values());
    // 按更新时间倒序排序
    items.sort((a, b) => b.updated_at - a.updated_at);
    return items.slice(offset, offset + limit);
  }

  // 根据ID获取知识库项
  getKnowledgeItemById(id: string): KnowledgeItem | null {
    return this.knowledgeItems.get(id) || null;
  }

  // 添加知识库项
  addKnowledgeItem(input: {
    title: string;
    type: KnowledgeItem['type'];
    content?: string;
  }): KnowledgeItem {
    const now = Date.now();
    const item: KnowledgeItem = {
      id: uuidv4(),
      title: input.title,
      type: input.type,
      content_path: null,
      content: input.content || '',
      embedding_path: null,
      created_at: now,
      updated_at: now,
      git_commit_hash: null,
      device_id: 'device-001',
      sync_status: 'pending',
    };

    this.knowledgeItems.set(item.id, item);
    console.log(`添加知识项: ${item.title}`);

    return item;
  }

  // 更新知识库项
  updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): boolean {
    const item = this.knowledgeItems.get(id);

    if (!item) {
      return false;
    }

    const updatedItem: KnowledgeItem = {
      ...item,
      ...updates,
      updated_at: Date.now(),
      sync_status: 'pending',
    };

    this.knowledgeItems.set(id, updatedItem);
    console.log(`更新知识项: ${updatedItem.title}`);

    return true;
  }

  // 删除知识库项
  deleteKnowledgeItem(id: string): boolean {
    const item = this.knowledgeItems.get(id);

    if (!item) {
      return false;
    }

    this.knowledgeItems.delete(id);
    console.log(`删除知识项: ${item.title}`);

    return true;
  }

  // 搜索知识库
  searchKnowledge(query: string): KnowledgeItem[] {
    const queryLower = query.toLowerCase();
    const results: KnowledgeItem[] = [];

    for (const item of this.knowledgeItems.values()) {
      if (
        item.title.toLowerCase().includes(queryLower) ||
        item.content?.toLowerCase().includes(queryLower)
      ) {
        results.push(item);
      }
    }

    // 按更新时间倒序排序
    results.sort((a, b) => b.updated_at - a.updated_at);

    return results;
  }

  // 关闭数据库
  close(): void {
    console.log('关闭内存数据库');
    // 内存版本无需清理
  }
}
