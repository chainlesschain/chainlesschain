/**
 * LLM (AI) Service
 *
 * Handles communication with AI backend
 */

import axios from 'axios';
import type {ChatMessage} from '../types';

interface LLMConfig {
  serverUrl: string;
  model: string;
  timeout: number;
}

class LLMService {
  private config: LLMConfig = {
    serverUrl: 'http://localhost:11434', // Default Ollama endpoint
    model: 'qwen2:7b',
    timeout: 30000,
  };

  private isConnected: boolean = false;

  /**
   * Set LLM service configuration
   */
  setConfig(config: Partial<LLMConfig>): void {
    this.config = {...this.config, ...config};
  }

  /**
   * Check if LLM service is available
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.serverUrl}/api/tags`, {
        timeout: 5000,
      });

      this.isConnected = response.status === 200;
      return this.isConnected;
    } catch (error) {
      console.log('[LLM] Connection check failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Send a query to the LLM
   */
  async query(
    message: string,
    context?: string,
    history?: ChatMessage[]
  ): Promise<string> {
    try {
      if (!this.isConnected) {
        const connected = await this.checkConnection();
        if (!connected) {
          throw new Error('LLM service not available');
        }
      }

      // Build messages array from history
      const messages = [
        ...(history || []).map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: context ? `Context:\n${context}\n\nQuestion: ${message}` : message,
        },
      ];

      const response = await axios.post(
        `${this.config.serverUrl}/api/chat`,
        {
          model: this.config.model,
          messages,
          stream: false,
        },
        {
          timeout: this.config.timeout,
        }
      );

      if (response.data && response.data.message) {
        return response.data.message.content;
      }

      throw new Error('Invalid response from LLM service');
    } catch (error) {
      console.error('[LLM] Query failed:', error);

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('无法连接到 AI 服务。请检查服务器是否运行。');
        } else if (error.code === 'ETIMEDOUT') {
          throw new Error('AI 服务响应超时。请稍后重试。');
        }
      }

      throw new Error('AI 查询失败。请检查网络连接。');
    }
  }

  /**
   * Stream query response (for real-time responses)
   */
  async *streamQuery(
    message: string,
    context?: string,
    history?: ChatMessage[]
  ): AsyncGenerator<string> {
    try {
      if (!this.isConnected) {
        const connected = await this.checkConnection();
        if (!connected) {
          throw new Error('LLM service not available');
        }
      }

      const messages = [
        ...(history || []).map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: context ? `Context:\n${context}\n\nQuestion: ${message}` : message,
        },
      ];

      const response = await axios.post(
        `${this.config.serverUrl}/api/chat`,
        {
          model: this.config.model,
          messages,
          stream: true,
        },
        {
          responseType: 'stream',
          timeout: this.config.timeout,
        }
      );

      // Note: Streaming implementation depends on your platform
      // This is a placeholder - you'll need to implement based on React Native's capabilities
      yield* this.parseStreamResponse(response.data);
    } catch (error) {
      console.error('[LLM] Stream query failed:', error);
      throw error;
    }
  }

  private async *parseStreamResponse(stream: any): AsyncGenerator<string> {
    // Placeholder for stream parsing
    // Implementation depends on your streaming library
    yield 'Streaming not yet implemented';
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.serverUrl}/api/tags`, {
        timeout: 5000,
      });

      if (response.data && response.data.models) {
        return response.data.models.map((model: any) => model.name);
      }

      return [];
    } catch (error) {
      console.error('[LLM] Get models failed:', error);
      return [];
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const llmService = new LLMService();
