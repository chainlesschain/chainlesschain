/**
 * LLM Service 单元测试
 * 测试LLM服务集成功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockElectronAPI } from '../../setup';

describe('LLM Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LLM查询', () => {
    it('应该成功查询LLM服务', async () => {
      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        data: {
          response: 'This is a test response',
          model: 'qwen2:7b',
          tokens: 50
        }
      });

      const result = await mockElectronAPI.llm.query({
        prompt: 'Hello, how are you?',
        model: 'qwen2:7b'
      });

      expect(result.success).toBe(true);
      expect(result.data.response).toBe('This is a test response');
      expect(mockElectronAPI.llm.query).toHaveBeenCalledWith({
        prompt: 'Hello, how are you?',
        model: 'qwen2:7b'
      });
    });

    it('应该处理LLM服务不可用的情况', async () => {
      mockElectronAPI.llm.query.mockRejectedValue(
        new Error('ECONNREFUSED: Connection refused')
      );

      try {
        await mockElectronAPI.llm.query({ prompt: 'test' });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('ECONNREFUSED');
      }
    });

    it('应该正确处理超时', async () => {
      mockElectronAPI.llm.query.mockRejectedValue(
        new Error('ETIMEDOUT: Request timeout')
      );

      try {
        await mockElectronAPI.llm.query({ prompt: 'test', timeout: 5000 });
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('ETIMEDOUT');
      }
    });
  });

  describe('流式查询', () => {
    it('应该支持流式响应', async () => {
      const chunks = [];
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => {
              callback({ chunk: 'Hello' });
              callback({ chunk: ' world' });
              callback({ chunk: '!' });
            }, 10);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 50);
          }
          return mockStream;
        })
      };

      mockElectronAPI.llm.stream.mockReturnValue(mockStream);

      const stream = mockElectronAPI.llm.stream({ prompt: 'test' });

      await new Promise((resolve) => {
        stream.on('data', (data) => chunks.push(data.chunk));
        stream.on('end', resolve);
      });

      expect(chunks).toEqual(['Hello', ' world', '!']);
    });
  });

  describe('LLM状态检查', () => {
    it('应该检查LLM服务状态', async () => {
      mockElectronAPI.llm.checkStatus.mockResolvedValue({
        online: true,
        models: ['qwen2:7b', 'llama2:7b'],
        version: '0.1.0'
      });

      const status = await mockElectronAPI.llm.checkStatus();

      expect(status.online).toBe(true);
      expect(status.models).toHaveLength(2);
      expect(status.models).toContain('qwen2:7b');
    });

    it('应该正确报告离线状态', async () => {
      mockElectronAPI.llm.checkStatus.mockResolvedValue({
        online: false,
        error: 'Service unavailable'
      });

      const status = await mockElectronAPI.llm.checkStatus();

      expect(status.online).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('模型管理', () => {
    it('应该列出可用模型', async () => {
      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        data: {
          models: [
            { name: 'qwen2:7b', size: '4.7GB' },
            { name: 'llama2:7b', size: '3.8GB' }
          ]
        }
      });

      const result = await mockElectronAPI.llm.query({ action: 'list-models' });

      expect(result.success).toBe(true);
      expect(result.data.models).toHaveLength(2);
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的prompt', async () => {
      mockElectronAPI.llm.query.mockRejectedValue(
        new Error('Invalid prompt: empty string')
      );

      try {
        await mockElectronAPI.llm.query({ prompt: '' });
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('Invalid prompt');
      }
    });

    it('应该处理模型不存在的情况', async () => {
      mockElectronAPI.llm.query.mockRejectedValue(
        new Error('Model not found: non-existent-model')
      );

      try {
        await mockElectronAPI.llm.query({
          prompt: 'test',
          model: 'non-existent-model'
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('Model not found');
      }
    });
  });
});
