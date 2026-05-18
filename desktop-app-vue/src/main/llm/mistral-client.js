/**
 * Mistral AI 客户端
 *
 * Mistral API 兼容 OpenAI 格式，继承 OpenAIClient。
 * 与 DeepSeekClient 采用相同的继承模式。
 *
 * @see https://docs.mistral.ai/api/
 */

const { OpenAIClient } = require("./openai-client");

class MistralClient extends OpenAIClient {
  constructor(config = {}) {
    super({
      ...config,
      baseURL: config.baseURL || "https://api.mistral.ai/v1",
      model: config.model || "mistral-large-latest",
      embeddingModel: config.embeddingModel || "mistral-embed",
    });
  }
}

module.exports = { MistralClient };
