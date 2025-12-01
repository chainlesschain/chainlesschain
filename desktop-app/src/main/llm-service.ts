import axios, { AxiosInstance } from 'axios';

export interface LLMResponse {
  text: string;
  model: string;
  tokens: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
}

/**
 * LLM服务管理器
 * 连接到本地Ollama服务或远程API
 */
export class LLMService {
  private ollamaClient: AxiosInstance;
  private ollamaBaseURL: string;
  private defaultModel: string;

  constructor() {
    // 默认连接到本地Ollama
    this.ollamaBaseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'qwen2:7b';

    this.ollamaClient = axios.create({
      baseURL: this.ollamaBaseURL,
      timeout: 120000, // 2分钟超时
    });

    console.log(`[LLM] 初始化LLM服务: ${this.ollamaBaseURL}`);
  }

  /**
   * 检查Ollama连接状态
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.ollamaClient.get('/api/tags');
      console.log('[LLM] Ollama连接成功,可用模型:', response.data);
      return true;
    } catch (error) {
      console.warn('[LLM] Ollama连接失败:', (error as Error).message);
      console.warn('[LLM] 请确保Docker服务已启动: npm run docker:up');
      return false;
    }
  }

  /**
   * 查询LLM
   */
  async query(prompt: string, context?: string[], model?: string): Promise<LLMResponse> {
    try {
      const useModel = model || this.defaultModel;

      console.log(`[LLM] 查询模型: ${useModel}`);
      console.log(`[LLM] Prompt: ${prompt.substring(0, 100)}...`);

      // 构建完整的prompt
      let fullPrompt = prompt;
      if (context && context.length > 0) {
        fullPrompt = `参考以下上下文:\n\n${context.join('\n\n')}\n\n问题: ${prompt}`;
      }

      const response = await this.ollamaClient.post('/api/generate', {
        model: useModel,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
        },
      });

      const result = response.data;

      console.log('[LLM] 查询完成');

      return {
        text: result.response,
        model: useModel,
        tokens: result.eval_count || 0,
      };
    } catch (error) {
      console.error('[LLM] 查询失败:', error);
      throw new Error(`LLM查询失败: ${(error as Error).message}`);
    }
  }

  /**
   * 流式查询 (用于实时响应)
   */
  async *queryStream(prompt: string, context?: string[], model?: string): AsyncGenerator<string> {
    try {
      const useModel = model || this.defaultModel;

      let fullPrompt = prompt;
      if (context && context.length > 0) {
        fullPrompt = `参考以下上下文:\n\n${context.join('\n\n')}\n\n问题: ${prompt}`;
      }

      const response = await this.ollamaClient.post('/api/generate', {
        model: useModel,
        prompt: fullPrompt,
        stream: true,
        options: {
          temperature: 0.7,
        },
      }, {
        responseType: 'stream',
      });

      const stream = response.data;

      for await (const chunk of stream) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              yield json.response;
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      console.error('[LLM] 流式查询失败:', error);
      throw error;
    }
  }

  /**
   * 文本向量化 (Embedding)
   */
  async embed(text: string, model?: string): Promise<EmbeddingResponse> {
    try {
      const useModel = model || 'nomic-embed-text';

      console.log(`[LLM] 向量化文本 (${text.substring(0, 50)}...)`);

      const response = await this.ollamaClient.post('/api/embeddings', {
        model: useModel,
        prompt: text,
      });

      return {
        embedding: response.data.embedding,
        model: useModel,
      };
    } catch (error) {
      console.error('[LLM] 向量化失败:', error);
      throw new Error(`向量化失败: ${(error as Error).message}`);
    }
  }

  /**
   * 批量向量化
   */
  async batchEmbed(texts: string[], model?: string): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      const result = await this.embed(text, model);
      embeddings.push(result.embedding);
    }

    return embeddings;
  }

  /**
   * 拉取模型 (如果不存在)
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      console.log(`[LLM] 正在拉取模型: ${modelName}`);

      await this.ollamaClient.post('/api/pull', {
        name: modelName,
        stream: false,
      });

      console.log(`[LLM] 模型 ${modelName} 拉取完成`);
    } catch (error) {
      console.error('[LLM] 拉取模型失败:', error);
      throw error;
    }
  }

  /**
   * 列出可用模型
   */
  async listModels(): Promise<any[]> {
    try {
      const response = await this.ollamaClient.get('/api/tags');
      return response.data.models || [];
    } catch (error) {
      console.error('[LLM] 获取模型列表失败:', error);
      return [];
    }
  }

  /**
   * 检查模型是否存在
   */
  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some((m: any) => m.name === modelName);
  }

  /**
   * 确保模型存在 (不存在则拉取)
   */
  async ensureModel(modelName: string): Promise<void> {
    const exists = await this.hasModel(modelName);
    if (!exists) {
      console.log(`[LLM] 模型 ${modelName} 不存在,开始拉取...`);
      await this.pullModel(modelName);
    }
  }
}
