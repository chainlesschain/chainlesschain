/**
 * Mock数据工厂
 *
 * 提供各种Mock对象和数据生成器，用于测试：
 * 1. 数据库Mock - 模拟SQLite数据库
 * 2. LLM服务Mock - 模拟AI服务
 * 3. 文件系统Mock - 模拟fs操作
 * 4. 测试数据生成 - 生成笔记、项目、用户等测试数据
 */

import { vi } from 'vitest';
import { randomData } from './test-helpers.js';

/**
 * Mock数据库工厂
 */
export class MockDatabase {
  constructor() {
    this.data = {};
    this.prepareStmt = vi.fn();
    this.saveToFileStmt = vi.fn();
    this._lastRunParams = null;
  }

  /**
   * 创建prepare语句
   */
  prepare(sql) {
    const stmt = {
      run: (params = []) => {
        this._lastRunParams = params;
        this.prepareStmt(sql, params);

        // 解析INSERT语句
        if (sql.includes('INSERT INTO')) {
          const tableMatch = sql.match(/INSERT INTO (\w+)/);
          if (tableMatch) {
            const tableName = tableMatch[1];
            if (!this.data[tableName]) {
              this.data[tableName] = [];
            }
            // 简化处理：将参数作为记录保存
            this.data[tableName].push(params);
          }
        }

        // 解析UPDATE语句
        if (sql.includes('UPDATE')) {
          const tableMatch = sql.match(/UPDATE (\w+)/);
          if (tableMatch) {
            const tableName = tableMatch[1];
            // 更新逻辑（简化）
          }
        }

        // 解析DELETE语句
        if (sql.includes('DELETE FROM')) {
          const tableMatch = sql.match(/DELETE FROM (\w+)/);
          if (tableMatch) {
            const tableName = tableMatch[1];
            // 删除逻辑（简化）
          }
        }

        return { changes: 1, lastInsertRowid: Date.now() };
      },

      get: (params = []) => {
        this.prepareStmt(sql, params);

        // 简化处理：返回第一条匹配记录
        if (sql.includes('SELECT') && sql.includes('WHERE')) {
          const tableMatch = sql.match(/FROM (\w+)/);
          if (tableMatch) {
            const tableName = tableMatch[1];
            return this.data[tableName]?.[0] || null;
          }
        }

        return null;
      },

      all: (params = []) => {
        this.prepareStmt(sql, params);

        // 简化处理：返回所有记录
        const tableMatch = sql.match(/FROM (\w+)/);
        if (tableMatch) {
          const tableName = tableMatch[1];
          return this.data[tableName] || [];
        }

        return [];
      }
    };

    return stmt;
  }

  /**
   * 保存到文件（Mock）
   */
  saveToFile() {
    this.saveToFileStmt();
  }

  /**
   * 添加测试数据
   */
  addData(tableName, records) {
    if (!this.data[tableName]) {
      this.data[tableName] = [];
    }
    this.data[tableName].push(...records);
  }

  /**
   * 清空所有数据
   */
  clear() {
    this.data = {};
    this._lastRunParams = null;
  }

  /**
   * 获取表数据
   */
  getTableData(tableName) {
    return this.data[tableName] || [];
  }
}

/**
 * Mock LLM服务工厂
 */
export class MockLLMService {
  constructor(options = {}) {
    this.responseTime = options.responseTime || 100;
    this.responses = options.responses || {};
    this.defaultResponse = options.defaultResponse || 'This is a mock LLM response.';
    this.callHistory = [];
  }

  /**
   * 查询LLM
   */
  async query(prompt, options = {}) {
    const startTime = Date.now();

    this.callHistory.push({
      prompt,
      options,
      timestamp: Date.now()
    });

    // 模拟响应延迟
    await new Promise(resolve => setTimeout(resolve, this.responseTime));

    // 检查是否有预设响应
    const response = this.responses[prompt] || this.defaultResponse;

    const duration = Date.now() - startTime;

    return {
      text: response,
      tokens: Math.floor(response.length / 4),
      model: options.model || 'mock-model',
      finishReason: 'stop',
      duration
    };
  }

  /**
   * 流式查询
   */
  async *queryStream(prompt, options = {}) {
    const response = this.responses[prompt] || this.defaultResponse;
    const chunks = response.match(/.{1,10}/g) || [response];

    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, this.responseTime / chunks.length));
      yield chunk;
    }
  }

  /**
   * 设置响应
   */
  setResponse(prompt, response) {
    this.responses[prompt] = response;
  }

  /**
   * 设置默认响应
   */
  setDefaultResponse(response) {
    this.defaultResponse = response;
  }

  /**
   * 设置响应时间
   */
  setResponseTime(ms) {
    this.responseTime = ms;
  }

  /**
   * 获取调用历史
   */
  getCallHistory() {
    return [...this.callHistory];
  }

  /**
   * 清空调用历史
   */
  clearHistory() {
    this.callHistory = [];
  }
}

/**
 * Mock文件系统工厂
 */
export class MockFileSystem {
  constructor() {
    this.files = new Map();
    this.directories = new Set(['/']);
  }

  /**
   * 写入文件
   */
  async writeFile(filePath, content) {
    this.files.set(filePath, content);
    // 确保父目录存在
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir) {
      this.directories.add(dir);
    }
  }

  /**
   * 读取文件
   */
  async readFile(filePath) {
    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }
    return this.files.get(filePath);
  }

  /**
   * 检查文件是否存在
   */
  async access(filePath) {
    if (!this.files.has(filePath) && !this.directories.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, access '${filePath}'`);
    }
  }

  /**
   * 删除文件
   */
  async unlink(filePath) {
    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${filePath}'`);
    }
    this.files.delete(filePath);
  }

  /**
   * 创建目录
   */
  async mkdir(dirPath, options = {}) {
    this.directories.add(dirPath);
  }

  /**
   * 读取目录
   */
  async readdir(dirPath) {
    const entries = [];
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';

    // 查找文件
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.substring(prefix.length);
        const name = relative.split('/')[0];
        if (!entries.includes(name)) {
          entries.push(name);
        }
      }
    }

    // 查找子目录
    for (const dir of this.directories) {
      if (dir.startsWith(prefix) && dir !== dirPath) {
        const relative = dir.substring(prefix.length);
        const name = relative.split('/')[0];
        if (!entries.includes(name)) {
          entries.push(name);
        }
      }
    }

    return entries;
  }

  /**
   * 清空所有数据
   */
  clear() {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
  }
}

/**
 * 测试数据生成器
 */
export const dataGenerators = {
  /**
   * 生成测试笔记
   */
  generateNote(overrides = {}) {
    return {
      id: randomData.uuid(),
      title: overrides.title || `测试笔记 ${randomData.string(5)}`,
      content: overrides.content || `这是测试内容。\n\n## 章节1\n\n${randomData.string(100)}`,
      tags: overrides.tags || ['测试', '笔记'],
      category: overrides.category || 'general',
      created_at: overrides.created_at || Date.now(),
      updated_at: overrides.updated_at || Date.now(),
      is_favorite: overrides.is_favorite ?? false,
      is_archived: overrides.is_archived ?? false,
      ...overrides
    };
  },

  /**
   * 生成多个测试笔记
   */
  generateNotes(count = 10, overrides = {}) {
    return Array.from({ length: count }, () => this.generateNote(overrides));
  },

  /**
   * 生成测试项目
   */
  generateProject(overrides = {}) {
    return {
      id: randomData.uuid(),
      user_id: overrides.user_id || randomData.uuid(),
      name: overrides.name || `测试项目 ${randomData.string(5)}`,
      description: overrides.description || `项目描述 ${randomData.string(20)}`,
      type: overrides.type || randomData.choice(['web', 'document', 'data', 'app']),
      project_type: overrides.project_type || 'web',
      status: overrides.status || randomData.choice(['draft', 'active', 'completed', 'archived']),
      folder_path: overrides.folder_path || `/projects/${randomData.string(10)}`,
      created_at: overrides.created_at || Date.now(),
      updated_at: overrides.updated_at || Date.now(),
      ...overrides
    };
  },

  /**
   * 生成测试用户
   */
  generateUser(overrides = {}) {
    const username = randomData.string(8).toLowerCase();
    return {
      id: randomData.uuid(),
      username: overrides.username || username,
      email: overrides.email || randomData.email(),
      display_name: overrides.display_name || `User ${randomData.string(5)}`,
      avatar: overrides.avatar || `https://avatar.example.com/${username}.jpg`,
      created_at: overrides.created_at || Date.now(),
      ...overrides
    };
  },

  /**
   * 生成测试模板
   */
  generateTemplate(overrides = {}) {
    return {
      id: randomData.uuid(),
      name: overrides.name || `template_${randomData.string(8)}`,
      display_name: overrides.display_name || `测试模板 ${randomData.string(5)}`,
      description: overrides.description || `模板描述 ${randomData.string(20)}`,
      category: overrides.category || randomData.choice(['writing', 'ppt', 'excel', 'web']),
      project_type: overrides.project_type || 'document',
      prompt_template: overrides.prompt_template || '这是提示词模板：{{variable}}',
      variables_schema: overrides.variables_schema || [
        { name: 'variable', type: 'text', required: true }
      ],
      is_builtin: overrides.is_builtin ?? true,
      usage_count: overrides.usage_count || randomData.integer(0, 100),
      rating: overrides.rating || randomData.integer(3, 5),
      created_at: overrides.created_at || Date.now(),
      updated_at: overrides.updated_at || Date.now(),
      ...overrides
    };
  },

  /**
   * 生成测试会话
   */
  generateConversation(overrides = {}) {
    return {
      id: randomData.uuid(),
      title: overrides.title || `对话 ${randomData.string(5)}`,
      messages: overrides.messages || [
        {
          role: 'user',
          content: '你好',
          timestamp: Date.now() - 10000
        },
        {
          role: 'assistant',
          content: '你好！有什么我可以帮助你的吗？',
          timestamp: Date.now() - 5000
        }
      ],
      created_at: overrides.created_at || Date.now(),
      updated_at: overrides.updated_at || Date.now(),
      ...overrides
    };
  },

  /**
   * 生成测试DID身份
   */
  generateDID(overrides = {}) {
    return {
      id: randomData.uuid(),
      did: overrides.did || `did:key:${randomData.string(40)}`,
      display_name: overrides.display_name || `DID用户 ${randomData.string(5)}`,
      public_key: overrides.public_key || randomData.string(64),
      created_at: overrides.created_at || Date.now(),
      ...overrides
    };
  },

  /**
   * 生成测试文件
   */
  generateFile(overrides = {}) {
    const ext = overrides.extension || '.txt';
    return {
      id: randomData.uuid(),
      name: overrides.name || `file_${randomData.string(8)}${ext}`,
      path: overrides.path || `/files/${randomData.string(10)}${ext}`,
      size: overrides.size || randomData.integer(100, 10000),
      mime_type: overrides.mime_type || 'text/plain',
      hash: overrides.hash || randomData.string(32),
      created_at: overrides.created_at || Date.now(),
      ...overrides
    };
  }
};

/**
 * Mock P2P网络工厂
 */
export class MockP2PNetwork {
  constructor() {
    this.peers = new Map();
    this.messages = [];
  }

  /**
   * 连接到peer
   */
  async connect(peerId) {
    this.peers.set(peerId, {
      id: peerId,
      connected: true,
      timestamp: Date.now()
    });
  }

  /**
   * 断开peer
   */
  async disconnect(peerId) {
    if (this.peers.has(peerId)) {
      this.peers.get(peerId).connected = false;
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(peerId, message) {
    if (!this.peers.has(peerId) || !this.peers.get(peerId).connected) {
      throw new Error(`Peer ${peerId} not connected`);
    }

    this.messages.push({
      to: peerId,
      message,
      timestamp: Date.now()
    });
  }

  /**
   * 获取已连接的peers
   */
  getPeers() {
    return Array.from(this.peers.values()).filter(p => p.connected);
  }

  /**
   * 获取消息历史
   */
  getMessages() {
    return [...this.messages];
  }

  /**
   * 清空
   */
  clear() {
    this.peers.clear();
    this.messages = [];
  }
}

/**
 * 导出工厂
 */
export default {
  MockDatabase,
  MockLLMService,
  MockFileSystem,
  MockP2PNetwork,
  dataGenerators
};
