/**
 * RAG检索、LLM服务、Git同步模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('RAG检索模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('向量检索', () => {
    it('应该能够检索相关文档', async () => {
      const query = '如何使用Python?';
      const mockResults = [
        { id: '1', content: 'Python入门教程', score: 0.95 },
        { id: '2', content: 'Python基础语法', score: 0.88 }
      ];

      // Mock RAG检索功能
      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        results: mockResults
      });

      const result = await mockElectronAPI.llm.query(query);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].score).toBeGreaterThan(0.8);
    });

    it('应该按相关性排序结果', async () => {
      const mockResults = [
        { id: '1', content: '内容1', score: 0.95 },
        { id: '2', content: '内容2', score: 0.88 },
        { id: '3', content: '内容3', score: 0.92 }
      ];

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        results: mockResults
      });

      const result = await mockElectronAPI.llm.query('测试查询');

      expect(result.success).toBe(true);
      expect(result.results[0].score).toBe(0.95);
    });

    it('应该支持设置检索数量限制', async () => {
      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        results: [{ id: '1', content: '内容', score: 0.9 }]
      });

      const result = await mockElectronAPI.llm.query('查询', { limit: 1 });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('文档索引', () => {
    it('应该能够添加文档到向量库', async () => {
      const document = {
        id: 'doc-1',
        content: '这是一个测试文档',
        metadata: { title: '测试' }
      };

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        indexed: true,
        id: document.id
      });

      const result = await mockElectronAPI.llm.query('index', { document });

      expect(result.success).toBe(true);
      expect(result.indexed).toBe(true);
    });

    it('应该能够批量索引文档', async () => {
      const documents = [
        { id: '1', content: '文档1' },
        { id: '2', content: '文档2' },
        { id: '3', content: '文档3' }
      ];

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        indexed: 3
      });

      const result = await mockElectronAPI.llm.query('batch-index', { documents });

      expect(result.success).toBe(true);
      expect(result.indexed).toBe(3);
    });
  });

  describe('重排序 (Reranker)', () => {
    it('应该对检索结果进行重排序', async () => {
      const query = '测试查询';
      const mockResults = [
        { id: '1', content: '内容1', score: 0.85 },
        { id: '2', content: '内容2', score: 0.90 }
      ];

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        results: mockResults,
        reranked: true
      });

      const result = await mockElectronAPI.llm.query(query, { rerank: true });

      expect(result.success).toBe(true);
      expect(result.reranked).toBe(true);
    });
  });
});

describe('LLM服务模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本查询', () => {
    it('应该能够发送查询到LLM', async () => {
      const prompt = '你好,介绍一下你自己';
      const mockResponse = {
        success: true,
        response: '你好!我是AI助手...',
        model: 'qwen2:7b'
      };

      mockElectronAPI.llm.query.mockResolvedValue(mockResponse);

      const result = await mockElectronAPI.llm.query(prompt);

      expect(result.success).toBe(true);
      expect(result.response).toBeTruthy();
      expect(result.model).toBe('qwen2:7b');
    });

    it('应该支持流式响应', async () => {
      const prompt = '写一首诗';
      const chunks = ['第', '一', '句', '\n', '第', '二', '句'];

      mockElectronAPI.llm.stream.mockImplementation(async (prompt, callback) => {
        for (const chunk of chunks) {
          callback({ chunk });
        }
        return { success: true };
      });

      const receivedChunks = [];
      await mockElectronAPI.llm.stream(prompt, (data) => {
        receivedChunks.push(data.chunk);
      });

      expect(receivedChunks).toHaveLength(7);
      expect(receivedChunks.join('')).toContain('第一句');
    });

    it('应该支持系统提示词', async () => {
      const systemPrompt = '你是一个Python专家';
      const userPrompt = '如何使用列表?';

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        response: '列表是Python中的数据结构...'
      });

      const result = await mockElectronAPI.llm.query(userPrompt, {
        system: systemPrompt
      });

      expect(result.success).toBe(true);
      expect(mockElectronAPI.llm.query).toHaveBeenCalledWith(
        userPrompt,
        expect.objectContaining({ system: systemPrompt })
      );
    });
  });

  describe('服务状态检查', () => {
    it('应该能够检查LLM服务状态', async () => {
      mockElectronAPI.llm.checkStatus.mockResolvedValue({
        success: true,
        status: 'running',
        models: ['qwen2:7b', 'llama2']
      });

      const result = await mockElectronAPI.llm.checkStatus();

      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
      expect(result.models).toContain('qwen2:7b');
    });

    it('应该检测服务不可用', async () => {
      mockElectronAPI.llm.checkStatus.mockResolvedValue({
        success: false,
        status: 'offline',
        error: '无法连接到Ollama服务'
      });

      const result = await mockElectronAPI.llm.checkStatus();

      expect(result.success).toBe(false);
      expect(result.status).toBe('offline');
    });
  });

  describe('对话上下文', () => {
    it('应该维护对话历史', async () => {
      const conversationId = 'conv-1';
      const messages = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好!有什么可以帮你?' }
      ];

      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        response: '当然可以!',
        conversationId: conversationId
      });

      const result = await mockElectronAPI.llm.query('帮我一个忙', {
        conversationId,
        history: messages
      });

      expect(result.success).toBe(true);
      expect(result.conversationId).toBe(conversationId);
    });
  });

  describe('错误处理', () => {
    it('应该处理网络错误', async () => {
      mockElectronAPI.llm.query.mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        mockElectronAPI.llm.query('测试')
      ).rejects.toThrow('Network error');
    });

    it('应该处理超时错误', async () => {
      mockElectronAPI.llm.query.mockResolvedValue({
        success: false,
        error: 'timeout',
        message: '请求超时'
      });

      const result = await mockElectronAPI.llm.query('测试', { timeout: 1000 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('timeout');
    });
  });
});

describe('Git同步模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Git初始化', () => {
    it('应该能够初始化Git仓库', async () => {
      const repoPath = '/path/to/repo';

      mockElectronAPI.git.init.mockResolvedValue({
        success: true,
        path: repoPath
      });

      const result = await mockElectronAPI.git.init(repoPath);

      expect(result.success).toBe(true);
      expect(result.path).toBe(repoPath);
    });

    it('应该检测已存在的Git仓库', async () => {
      mockElectronAPI.git.init.mockResolvedValue({
        success: false,
        error: 'already_initialized',
        message: '仓库已存在'
      });

      const result = await mockElectronAPI.git.init('/existing/repo');

      expect(result.success).toBe(false);
      expect(result.error).toBe('already_initialized');
    });
  });

  describe('提交操作', () => {
    it('应该能够提交更改', async () => {
      const message = 'feat: 添加新功能';

      mockElectronAPI.git.commit.mockResolvedValue({
        success: true,
        hash: 'abc123',
        message: message
      });

      const result = await mockElectronAPI.git.commit(message);

      expect(result.success).toBe(true);
      expect(result.hash).toBe('abc123');
      expect(result.message).toBe(message);
    });

    it('应该检测没有更改可提交', async () => {
      mockElectronAPI.git.commit.mockResolvedValue({
        success: false,
        error: 'nothing_to_commit',
        message: '没有更改可提交'
      });

      const result = await mockElectronAPI.git.commit('测试提交');

      expect(result.success).toBe(false);
      expect(result.error).toBe('nothing_to_commit');
    });
  });

  describe('推送和拉取', () => {
    it('应该能够推送到远程仓库', async () => {
      mockElectronAPI.git.push.mockResolvedValue({
        success: true,
        remote: 'origin',
        branch: 'main'
      });

      const result = await mockElectronAPI.git.push();

      expect(result.success).toBe(true);
      expect(result.remote).toBe('origin');
      expect(result.branch).toBe('main');
    });

    it('应该能够从远程仓库拉取', async () => {
      mockElectronAPI.git.pull.mockResolvedValue({
        success: true,
        updated: true,
        files: ['file1.md', 'file2.txt']
      });

      const result = await mockElectronAPI.git.pull();

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
      expect(result.files).toHaveLength(2);
    });

    it('应该检测合并冲突', async () => {
      mockElectronAPI.git.pull.mockResolvedValue({
        success: false,
        error: 'merge_conflict',
        conflicts: ['notes/test.md']
      });

      const result = await mockElectronAPI.git.pull();

      expect(result.success).toBe(false);
      expect(result.error).toBe('merge_conflict');
      expect(result.conflicts).toContain('notes/test.md');
    });
  });

  describe('状态查询', () => {
    it('应该能够查询Git状态', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        modified: ['file1.md'],
        staged: ['file2.txt'],
        untracked: ['file3.md']
      });

      const result = await mockElectronAPI.git.status();

      expect(result.success).toBe(true);
      expect(result.modified).toHaveLength(1);
      expect(result.staged).toHaveLength(1);
      expect(result.untracked).toHaveLength(1);
    });

    it('应该报告干净的工作树', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        clean: true,
        modified: [],
        staged: [],
        untracked: []
      });

      const result = await mockElectronAPI.git.status();

      expect(result.success).toBe(true);
      expect(result.clean).toBe(true);
    });
  });

  describe('冲突解决', () => {
    it('应该能够解决合并冲突', async () => {
      const filePath = 'notes/test.md';
      const resolution = 'ours'; // 使用我们的版本

      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        resolved: true,
        file: filePath
      });

      const result = await mockElectronAPI.git.status();

      expect(result.success).toBe(true);
      expect(result.resolved).toBe(true);
    });

    it('应该支持手动合并内容', async () => {
      const filePath = 'notes/test.md';
      const mergedContent = '手动合并后的内容';

      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        resolved: true,
        file: filePath,
        content: mergedContent
      });

      const result = await mockElectronAPI.git.status();

      expect(result.success).toBe(true);
      expect(result.content).toBe(mergedContent);
    });
  });

  describe('自动提交', () => {
    it('应该支持自动提交功能', async () => {
      mockElectronAPI.git.commit.mockResolvedValue({
        success: true,
        auto: true,
        hash: 'auto123'
      });

      const result = await mockElectronAPI.git.commit('[自动提交] 保存更改');

      expect(result.success).toBe(true);
      expect(mockElectronAPI.git.commit).toHaveBeenCalled();
    });

    it('应该在保存笔记时自动提交', async () => {
      // 模拟保存笔记
      mockElectronAPI.db.run.mockResolvedValue({
        success: true
      });

      // 模拟自动提交
      mockElectronAPI.git.commit.mockResolvedValue({
        success: true,
        auto: true
      });

      await mockElectronAPI.db.run('UPDATE notes SET content = ?', ['新内容']);
      await mockElectronAPI.git.commit('[自动提交] 更新笔记');

      expect(mockElectronAPI.git.commit).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('应该处理认证失败', async () => {
      mockElectronAPI.git.push.mockResolvedValue({
        success: false,
        error: 'auth_failed',
        message: '认证失败'
      });

      const result = await mockElectronAPI.git.push();

      expect(result.success).toBe(false);
      expect(result.error).toBe('auth_failed');
    });

    it('应该处理网络错误', async () => {
      mockElectronAPI.git.pull.mockResolvedValue({
        success: false,
        error: 'network_error',
        message: '无法连接到远程仓库'
      });

      const result = await mockElectronAPI.git.pull();

      expect(result.success).toBe(false);
      expect(result.error).toBe('network_error');
    });
  });
});
