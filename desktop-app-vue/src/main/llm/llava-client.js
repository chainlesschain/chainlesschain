/**
 * LLaVA 视觉模型客户端
 *
 * 支持本地 Ollama LLaVA 模型进行多模态视觉理解
 *
 * @module llava-client
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const axios = require("axios");
const EventEmitter = require("events");
const fs = require("fs").promises;
const path = require("path");

/**
 * 支持的图片格式
 */
const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

/**
 * 默认视觉模型
 */
const DEFAULT_VISION_MODEL = "llava:7b";

/**
 * LLaVA 客户端类
 * 继承 EventEmitter 以支持事件驱动
 */
class LLaVAClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.baseURL = config.baseURL || "http://localhost:11434";
    this.timeout = config.timeout || 180000; // 3分钟（视觉模型处理较慢）
    this.model = config.model || DEFAULT_VISION_MODEL;
    this.maxImageSize = config.maxImageSize || 5 * 1024 * 1024; // 5MB

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info(`[LLaVAClient] 初始化完成，模型: ${this.model}`);
  }

  /**
   * 检查 LLaVA 服务状态
   * @returns {Promise<Object>} 服务状态
   */
  async checkStatus() {
    try {
      const response = await this.client.get("/api/tags");
      const models = response.data.models || [];

      // 查找视觉模型
      const visionModels = models.filter(
        (m) =>
          m.name.includes("llava") ||
          m.name.includes("vision") ||
          m.name.includes("bakllava"),
      );

      return {
        available: true,
        models: models.map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })),
        visionModels: visionModels.map((m) => m.name),
        hasVisionModel: visionModels.length > 0,
        currentModel: this.model,
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        models: [],
        visionModels: [],
        hasVisionModel: false,
      };
    }
  }

  /**
   * 将图片转换为 Base64
   * @param {string} imagePath - 图片路径
   * @returns {Promise<string>} Base64 编码的图片
   */
  async imageToBase64(imagePath) {
    try {
      // 检查文件是否存在
      await fs.access(imagePath);

      // 检查文件大小
      const stats = await fs.stat(imagePath);
      if (stats.size > this.maxImageSize) {
        throw new Error(
          `图片大小超过限制 (${(this.maxImageSize / 1024 / 1024).toFixed(1)}MB)`,
        );
      }

      // 检查格式
      const ext = path.extname(imagePath).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        throw new Error(
          `不支持的图片格式: ${ext}. 支持: ${SUPPORTED_FORMATS.join(", ")}`,
        );
      }

      // 读取并编码
      const imageBuffer = await fs.readFile(imagePath);
      return imageBuffer.toString("base64");
    } catch (error) {
      logger.error("[LLaVAClient] 图片转换失败:", error);
      throw error;
    }
  }

  /**
   * 分析图片内容
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据（优先使用）
   * @param {string} [params.prompt] - 提示词
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeImage(
    { imagePath, imageBase64, prompt = "请详细描述这张图片的内容" },
    options = {},
  ) {
    try {
      this.emit("analyze-start", { imagePath, prompt });

      // 获取 Base64 图片数据
      let base64Data = imageBase64;
      if (!base64Data && imagePath) {
        base64Data = await this.imageToBase64(imagePath);
      }

      if (!base64Data) {
        throw new Error("未提供图片数据");
      }

      // 调用 Ollama API
      const response = await this.client.post("/api/generate", {
        model: options.model || this.model,
        prompt,
        stream: false,
        images: [base64Data],
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          num_predict: options.maxTokens || 2048,
        },
      });

      const result = {
        text: response.data.response,
        model: response.data.model,
        done: response.data.done,
        totalDuration: response.data.total_duration,
        tokens: response.data.eval_count || 0,
        imagePath,
        prompt,
      };

      this.emit("analyze-complete", result);
      logger.info("[LLaVAClient] 图片分析完成");

      return result;
    } catch (error) {
      logger.error("[LLaVAClient] 图片分析失败:", error);
      this.emit("analyze-error", { error, imagePath, prompt });
      throw error;
    }
  }

  /**
   * 流式分析图片
   * @param {Object} params - 分析参数
   * @param {Function} onChunk - 流式回调
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 完整分析结果
   */
  async analyzeImageStream(
    { imagePath, imageBase64, prompt = "请详细描述这张图片的内容" },
    onChunk,
    options = {},
  ) {
    try {
      this.emit("analyze-stream-start", { imagePath, prompt });

      // 获取 Base64 图片数据
      let base64Data = imageBase64;
      if (!base64Data && imagePath) {
        base64Data = await this.imageToBase64(imagePath);
      }

      if (!base64Data) {
        throw new Error("未提供图片数据");
      }

      const response = await this.client.post(
        "/api/generate",
        {
          model: options.model || this.model,
          prompt,
          stream: true,
          images: [base64Data],
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            num_predict: options.maxTokens || 2048,
          },
        },
        {
          responseType: "stream",
        },
      );

      let fullText = "";

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.response) {
                fullText += data.response;
                onChunk(data.response, fullText);
              }

              if (data.done) {
                const result = {
                  text: fullText,
                  model: data.model,
                  totalDuration: data.total_duration,
                  tokens: data.eval_count || 0,
                  imagePath,
                  prompt,
                };

                this.emit("analyze-stream-complete", result);
                resolve(result);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        response.data.on("error", (error) => {
          this.emit("analyze-stream-error", { error, imagePath, prompt });
          reject(error);
        });

        response.data.on("end", () => {
          if (fullText) {
            resolve({
              text: fullText,
              model: options.model || this.model,
              imagePath,
              prompt,
            });
          }
        });
      });
    } catch (error) {
      logger.error("[LLaVAClient] 流式图片分析失败:", error);
      throw error;
    }
  }

  /**
   * 视觉问答 (VQA)
   * @param {Object} params - 问答参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} params.question - 问题
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 问答结果
   */
  async visualQA({ imagePath, imageBase64, question }, options = {}) {
    const prompt = `请根据图片回答以下问题：\n${question}\n\n请用中文回答，答案要准确、简洁。`;

    return this.analyzeImage(
      { imagePath, imageBase64, prompt },
      {
        ...options,
        temperature: 0.5, // 问答使用较低温度
      },
    );
  }

  /**
   * 图片 OCR（文字识别）
   * @param {Object} params - OCR 参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.language] - 语言（默认中英文）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} OCR 结果
   */
  async performOCR(
    { imagePath, imageBase64, language = "中文和英文" },
    options = {},
  ) {
    const prompt = `请仔细识别并提取图片中的所有文字内容。
要求：
1. 保持原文的格式和布局
2. 区分不同区域的文字
3. 如果有表格，请用表格形式呈现
4. 主要识别${language}文字
5. 标注文字的大致位置（如：标题、正文、页脚等）

请直接输出识别到的文字内容：`;

    return this.analyzeImage(
      { imagePath, imageBase64, prompt },
      {
        ...options,
        temperature: 0.3, // OCR 使用低温度以提高准确性
        maxTokens: 4096,
      },
    );
  }

  /**
   * 图片描述（详细）
   * @param {Object} params - 描述参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.style] - 描述风格 (detailed|brief|technical)
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 描述结果
   */
  async describeImage(
    { imagePath, imageBase64, style = "detailed" },
    options = {},
  ) {
    const prompts = {
      detailed: `请详细描述这张图片的内容，包括：
1. 主体内容：图片中的主要对象或场景
2. 细节描述：颜色、形状、位置关系
3. 背景环境：场景背景、氛围
4. 情感氛围：传达的情感或意境
5. 其他细节：任何值得注意的元素

请用流畅的中文描述。`,

      brief: "请用一到两句话简要描述这张图片的主要内容。",

      technical: `请从技术角度分析这张图片：
1. 图片类型：照片/插画/图表/截图等
2. 主要元素：识别图片中的关键对象
3. 布局结构：元素的空间分布
4. 色彩分析：主色调和配色
5. 技术细节：如果是截图，识别软件/系统；如果是图表，分析数据

请用专业术语描述。`,
    };

    return this.analyzeImage(
      { imagePath, imageBase64, prompt: prompts[style] || prompts.detailed },
      options,
    );
  }

  /**
   * 聊天对话（带图片上下文）
   * @param {Array} messages - 消息数组（可包含图片）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 对话结果
   */
  async chat(messages, options = {}) {
    try {
      // 处理消息中的图片
      const processedMessages = await Promise.all(
        messages.map(async (msg) => {
          if (msg.images && msg.images.length > 0) {
            // 将图片路径转换为 Base64
            const base64Images = await Promise.all(
              msg.images.map(async (img) => {
                if (typeof img === "string" && !img.startsWith("data:")) {
                  // 是文件路径
                  return this.imageToBase64(img);
                }
                return img; // 已经是 Base64
              }),
            );
            return { ...msg, images: base64Images };
          }
          return msg;
        }),
      );

      const response = await this.client.post("/api/chat", {
        model: options.model || this.model,
        messages: processedMessages,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          num_predict: options.maxTokens || 2048,
        },
      });

      return {
        message: response.data.message,
        model: response.data.model,
        done: response.data.done,
        totalDuration: response.data.total_duration,
        tokens: response.data.eval_count || 0,
      };
    } catch (error) {
      logger.error("[LLaVAClient] 视觉聊天失败:", error);
      throw error;
    }
  }

  /**
   * 拉取视觉模型
   * @param {string} modelName - 模型名称
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 拉取结果
   */
  async pullModel(modelName = DEFAULT_VISION_MODEL, onProgress) {
    try {
      logger.info(`[LLaVAClient] 开始拉取模型: ${modelName}`);

      const response = await this.client.post(
        "/api/pull",
        {
          name: modelName,
          stream: true,
        },
        {
          responseType: "stream",
        },
      );

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (onProgress) {
                onProgress(data);
              }

              if (data.status === "success") {
                logger.info(`[LLaVAClient] 模型拉取成功: ${modelName}`);
                resolve(data);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        response.data.on("error", (error) => {
          reject(error);
        });
      });
    } catch (error) {
      logger.error("[LLaVAClient] 拉取模型失败:", error);
      throw error;
    }
  }

  /**
   * 更新配置
   * @param {Object} config - 新配置
   */
  updateConfig(config) {
    if (config.model) {
      this.model = config.model;
    }
    if (config.timeout) {
      this.timeout = config.timeout;
    }
    if (config.maxImageSize) {
      this.maxImageSize = config.maxImageSize;
    }
    if (config.baseURL) {
      this.baseURL = config.baseURL;
      this.client = axios.create({
        baseURL: this.baseURL,
        timeout: this.timeout,
        headers: { "Content-Type": "application/json" },
      });
    }
    logger.info("[LLaVAClient] 配置已更新");
  }
}

module.exports = {
  LLaVAClient,
  DEFAULT_VISION_MODEL,
  SUPPORTED_FORMATS,
};
