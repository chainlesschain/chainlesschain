/**
 * ChainlessChain Mobile - LLM 云端 API 服务
 * 支持国内外主流大模型提供商
 */

class LLMService {
  constructor() {
    this.provider = "openai";
    this.config = {
      // 国际提供商
      openai: {
        apiKey: "",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-3.5-turbo",
        temperature: 0.7,
        maxTokens: 2000,
      },
      deepseek: {
        apiKey: "",
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        temperature: 0.7,
        maxTokens: 2000,
      },

      // 国内提供商
      volcengine: {
        apiKey: "",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-pro-32k",
        temperature: 0.7,
        maxTokens: 2000,
      },
      baidu_qianfan: {
        apiKey: "",
        secretKey: "", // 百度需要 Secret Key
        baseURL:
          "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat",
        model: "ERNIE-Speed-128K",
        temperature: 0.7,
        maxTokens: 2000,
      },
      aliyun_dashscope: {
        apiKey: "",
        baseURL:
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        model: "qwen-turbo",
        temperature: 0.7,
        maxTokens: 2000,
      },
      tencent_hunyuan: {
        apiKey: "", // SecretId
        secretKey: "", // SecretKey
        baseURL: "https://hunyuan.tencentcloudapi.com",
        model: "hunyuan-lite",
        temperature: 0.7,
        maxTokens: 2000,
      },
      xfyun_xinghuo: {
        apiKey: "", // APPID
        apiSecret: "", // APISecret
        baseURL: "wss://spark-api.xf-yun.com/v3.5/chat",
        model: "generalv3.5",
        temperature: 0.7,
        maxTokens: 2000,
      },
      zhipu_ai: {
        apiKey: "",
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4-flash",
        temperature: 0.7,
        maxTokens: 2000,
      },

      // 本地和自定义
      ollama: {
        baseURL: "http://localhost:11434",
        model: "qwen2:7b",
        temperature: 0.7,
      },
      custom: {
        apiKey: "",
        baseURL: "",
        model: "",
        temperature: 0.7,
        maxTokens: 2000,
      },
    };

    // 加载保存的配置
    this.loadConfig();
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      const savedConfig = uni.getStorageSync("llm_config");
      if (savedConfig) {
        Object.assign(this.config, JSON.parse(savedConfig));
      }

      const savedProvider = uni.getStorageSync("llm_provider");
      if (savedProvider) {
        this.provider = savedProvider;
      }
    } catch (error) {
      console.error("加载LLM配置失败:", error);
    }
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      uni.setStorageSync("llm_config", JSON.stringify(this.config));
      uni.setStorageSync("llm_provider", this.provider);
    } catch (error) {
      console.error("保存LLM配置失败:", error);
    }
  }

  /**
   * 设置提供商
   */
  setProvider(provider) {
    const validProviders = [
      "openai",
      "deepseek",
      "volcengine",
      "baidu_qianfan",
      "aliyun_dashscope",
      "tencent_hunyuan",
      "xfyun_xinghuo",
      "zhipu_ai",
      "ollama",
      "custom",
    ];
    if (validProviders.includes(provider)) {
      this.provider = provider;
      this.saveConfig();
    }
  }

  /**
   * 更新配置
   */
  updateConfig(provider, config) {
    if (this.config[provider]) {
      Object.assign(this.config[provider], config);
      this.saveConfig();
    }
  }

  /**
   * 发送查询请求
   * @param {string} message 用户消息
   * @param {Array} history 历史对话
   * @param {Object} options 选项
   * @returns {Promise<Object>} 响应结果
   */
  async query(message, history = [], options = {}) {
    const providerConfig = this.config[this.provider];

    // 构建消息数组
    const messages = [
      ...history.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: "user",
        content: message,
      },
    ];

    try {
      let response;

      if (this.provider === "ollama") {
        response = await this.queryOllama(messages, providerConfig, options);
      } else {
        response = await this.queryOpenAICompatible(
          messages,
          providerConfig,
          options,
        );
      }

      return response;
    } catch (error) {
      console.error("LLM查询失败:", error);
      throw error;
    }
  }

  /**
   * 查询 OpenAI 兼容 API
   */
  async queryOpenAICompatible(messages, config, options) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: `${config.baseURL}/chat/completions`,
        method: "POST",
        header: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        data: {
          model: config.model,
          messages: messages,
          temperature: options.temperature || config.temperature,
          max_tokens: options.maxTokens || config.maxTokens,
          stream: false,
        },
        timeout: 60000,
        success: (res) => {
          if (
            res.statusCode === 200 &&
            res.data.choices &&
            res.data.choices.length > 0
          ) {
            const choice = res.data.choices[0];
            resolve({
              content: choice.message.content,
              role: "assistant",
              tokens: res.data.usage ? res.data.usage.total_tokens : 0,
              model: res.data.model,
            });
          } else {
            reject(
              new Error(
                `API返回错误: ${res.statusCode} ${JSON.stringify(res.data)}`,
              ),
            );
          }
        },
        fail: (err) => {
          reject(new Error(`请求失败: ${err.errMsg}`));
        },
      });
    });
  }

  /**
   * 查询 Ollama API
   */
  async queryOllama(messages, config, options) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: `${config.baseURL}/api/chat`,
        method: "POST",
        header: {
          "Content-Type": "application/json",
        },
        data: {
          model: config.model,
          messages: messages,
          stream: false,
          options: {
            temperature: options.temperature || config.temperature,
          },
        },
        timeout: 120000, // Ollama 可能需要更长时间
        success: (res) => {
          if (res.statusCode === 200 && res.data.message) {
            resolve({
              content: res.data.message.content,
              role: "assistant",
              tokens: res.data.eval_count || 0,
              model: config.model,
            });
          } else {
            reject(new Error(`Ollama API返回错误: ${res.statusCode}`));
          }
        },
        fail: (err) => {
          reject(new Error(`Ollama请求失败: ${err.errMsg}`));
        },
      });
    });
  }

  /**
   * 流式查询
   * @param {string} message 用户消息
   * @param {Array} history 历史对话
   * @param {Function} onChunk 收到数据块时的回调 (content, done, error)
   * @param {Object} options 选项
   * @returns {Promise<Object>} 完整响应结果
   */
  async queryStream(message, history = [], onChunk, options = {}) {
    const providerConfig = this.config[this.provider];

    // 构建消息数组
    const messages = [
      ...history.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: "user",
        content: message,
      },
    ];

    try {
      if (this.provider === "ollama") {
        return await this._streamOllama(
          messages,
          providerConfig,
          onChunk,
          options,
        );
      } else {
        return await this._streamOpenAICompatible(
          messages,
          providerConfig,
          onChunk,
          options,
        );
      }
    } catch (error) {
      console.error("流式查询失败:", error);
      if (onChunk) {
        onChunk("", true, error);
      }
      throw error;
    }
  }

  /**
   * OpenAI 兼容 API 流式请求
   * @private
   */
  async _streamOpenAICompatible(messages, config, onChunk, options) {
    return new Promise((resolve, reject) => {
      let fullContent = "";
      let totalTokens = 0;

      // #ifdef H5
      // H5 平台使用 fetch + ReadableStream
      this._streamWithFetch(
        `${config.baseURL}/chat/completions`,
        {
          model: config.model,
          messages: messages,
          temperature: options.temperature || config.temperature,
          max_tokens: options.maxTokens || config.maxTokens,
          stream: true,
        },
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
      );
      // #endif

      // #ifdef APP-PLUS
      // APP 平台使用原生流式请求
      this._streamWithPlus(
        `${config.baseURL}/chat/completions`,
        {
          model: config.model,
          messages: messages,
          temperature: options.temperature || config.temperature,
          max_tokens: options.maxTokens || config.maxTokens,
          stream: true,
        },
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
      );
      // #endif

      // #ifdef MP-WEIXIN
      // 微信小程序使用 enableChunked
      this._streamWithWx(
        `${config.baseURL}/chat/completions`,
        {
          model: config.model,
          messages: messages,
          temperature: options.temperature || config.temperature,
          max_tokens: options.maxTokens || config.maxTokens,
          stream: true,
        },
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
      );
      // #endif
    });
  }

  /**
   * Ollama API 流式请求
   * @private
   */
  async _streamOllama(messages, config, onChunk, options) {
    return new Promise((resolve, reject) => {
      let fullContent = "";
      let totalTokens = 0;

      const requestData = {
        model: config.model,
        messages: messages,
        stream: true,
        options: {
          temperature: options.temperature || config.temperature,
        },
      };

      // #ifdef H5
      this._streamWithFetch(
        `${config.baseURL}/api/chat`,
        requestData,
        { "Content-Type": "application/json" },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
        "ollama",
      );
      // #endif

      // #ifdef APP-PLUS
      this._streamWithPlus(
        `${config.baseURL}/api/chat`,
        requestData,
        { "Content-Type": "application/json" },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
        "ollama",
      );
      // #endif

      // #ifdef MP-WEIXIN
      this._streamWithWx(
        `${config.baseURL}/api/chat`,
        requestData,
        { "Content-Type": "application/json" },
        (chunk, done, error) => {
          if (error) {
            reject(error);
            return;
          }
          if (chunk) {
            fullContent += chunk;
          }
          if (onChunk) {
            onChunk(chunk, done, error);
          }
          if (done) {
            resolve({
              content: fullContent,
              role: "assistant",
              tokens: totalTokens,
              model: config.model,
            });
          }
        },
        "ollama",
      );
      // #endif
    });
  }

  /**
   * H5 平台使用 fetch 流式请求
   * @private
   */
  async _streamWithFetch(url, data, headers, onChunk, format = "openai") {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          onChunk("", true, null);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          if (format === "ollama") {
            // Ollama 返回 NDJSON 格式
            try {
              const json = JSON.parse(line);
              if (json.message && json.message.content) {
                onChunk(json.message.content, json.done || false, null);
              }
              if (json.done) {
                onChunk("", true, null);
                return;
              }
            } catch (e) {
              console.warn("解析 Ollama 响应失败:", line);
            }
          } else {
            // OpenAI SSE 格式
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6);
              if (jsonStr === "[DONE]") {
                onChunk("", true, null);
                return;
              }
              try {
                const json = JSON.parse(jsonStr);
                if (json.choices && json.choices[0]) {
                  const delta = json.choices[0].delta;
                  if (delta && delta.content) {
                    onChunk(delta.content, false, null);
                  }
                  if (json.choices[0].finish_reason) {
                    onChunk("", true, null);
                    return;
                  }
                }
              } catch (e) {
                console.warn("解析 SSE 响应失败:", jsonStr);
              }
            }
          }
        }
      }
    } catch (error) {
      onChunk("", true, error);
    }
  }

  /**
   * APP-PLUS 平台使用原生流式请求
   * @private
   */
  _streamWithPlus(url, data, headers, onChunk, format = "openai") {
    // #ifdef APP-PLUS
    const xhr = new plus.net.XMLHttpRequest();
    let lastIndex = 0;

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) {
        // LOADING 状态，处理增量数据
        const responseText = xhr.responseText;
        const newText = responseText.substring(lastIndex);
        lastIndex = responseText.length;

        const lines = newText.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;

          if (format === "ollama") {
            try {
              const json = JSON.parse(line);
              if (json.message && json.message.content) {
                onChunk(json.message.content, json.done || false, null);
              }
            } catch (e) {
              // 可能是不完整的 JSON，等待下次
            }
          } else {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6);
              if (jsonStr === "[DONE]") {
                onChunk("", true, null);
                return;
              }
              try {
                const json = JSON.parse(jsonStr);
                if (json.choices && json.choices[0]) {
                  const delta = json.choices[0].delta;
                  if (delta && delta.content) {
                    onChunk(delta.content, false, null);
                  }
                }
              } catch (e) {
                // 可能是不完整的 JSON
              }
            }
          }
        }
      } else if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          onChunk("", true, null);
        } else {
          onChunk("", true, new Error(`请求失败: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = (e) => {
      onChunk("", true, new Error(`请求错误: ${e.message}`));
    };

    xhr.open("POST", url);
    for (const key in headers) {
      xhr.setRequestHeader(key, headers[key]);
    }
    xhr.send(JSON.stringify(data));
    // #endif
  }

  /**
   * 微信小程序使用 enableChunked 流式请求
   * @private
   */
  _streamWithWx(url, data, headers, onChunk, format = "openai") {
    // #ifdef MP-WEIXIN
    const requestTask = wx.request({
      url: url,
      method: "POST",
      header: headers,
      data: data,
      enableChunked: true,
      success: () => {
        onChunk("", true, null);
      },
      fail: (err) => {
        onChunk("", true, new Error(err.errMsg));
      },
    });

    let buffer = "";

    requestTask.onChunkReceived((res) => {
      // 将 ArrayBuffer 转换为字符串
      const text = this._arrayBufferToString(res.data);
      buffer += text;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (format === "ollama") {
          try {
            const json = JSON.parse(line);
            if (json.message && json.message.content) {
              onChunk(json.message.content, json.done || false, null);
            }
          } catch (e) {
            // 忽略解析错误
          }
        } else {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") {
              return;
            }
            try {
              const json = JSON.parse(jsonStr);
              if (json.choices && json.choices[0]) {
                const delta = json.choices[0].delta;
                if (delta && delta.content) {
                  onChunk(delta.content, false, null);
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    });
    // #endif
  }

  /**
   * ArrayBuffer 转字符串
   * @private
   */
  _arrayBufferToString(buffer) {
    // #ifdef MP-WEIXIN
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(new Uint8Array(buffer));
    // #endif
    // #ifndef MP-WEIXIN
    return String.fromCharCode.apply(null, new Uint8Array(buffer));
    // #endif
  }

  /**
   * 检查服务状态
   */
  async checkStatus() {
    try {
      const providerConfig = this.config[this.provider];

      if (this.provider === "ollama") {
        // 检查 Ollama 服务
        return new Promise((resolve) => {
          uni.request({
            url: `${providerConfig.baseURL}/api/tags`,
            method: "GET",
            timeout: 5000,
            success: (res) => {
              if (res.statusCode === 200) {
                resolve({
                  available: true,
                  provider: "ollama",
                  models: res.data.models || [],
                });
              } else {
                resolve({ available: false, provider: "ollama" });
              }
            },
            fail: () => {
              resolve({ available: false, provider: "ollama" });
            },
          });
        });
      } else {
        // OpenAI 兼容 API 需要有 API Key
        const hasApiKey =
          providerConfig.apiKey && providerConfig.apiKey.length > 0;
        return {
          available: hasApiKey,
          provider: this.provider,
          message: hasApiKey ? "配置正常" : "请设置 API Key",
        };
      }
    } catch (error) {
      return {
        available: false,
        provider: this.provider,
        error: error.message,
      };
    }
  }

  /**
   * 获取可用模型列表
   */
  async getModels() {
    if (this.provider === "ollama") {
      const providerConfig = this.config[this.provider];

      return new Promise((resolve, reject) => {
        uni.request({
          url: `${providerConfig.baseURL}/api/tags`,
          method: "GET",
          success: (res) => {
            if (res.statusCode === 200 && res.data.models) {
              resolve(res.data.models.map((m) => m.name));
            } else {
              reject(new Error("获取模型列表失败"));
            }
          },
          fail: (err) => {
            reject(new Error(`请求失败: ${err.errMsg}`));
          },
        });
      });
    } else {
      // OpenAI/DeepSeek 使用预定义模型列表
      const modelMap = {
        openai: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo"],
        deepseek: ["deepseek-chat", "deepseek-coder"],
        custom: [],
      };

      return Promise.resolve(modelMap[this.provider] || []);
    }
  }
}

// 导出单例
export const llm = new LLMService();
export default LLMService;
