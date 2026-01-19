const { logger, createLogger } = require('../utils/logger.js');

/**
 * 火山引擎豆包模型列表和智能选择器
 *
 * 基于火山引擎官方文档整理
 * 文档: https://www.volcengine.com/docs/82379/1330310
 * 更新时间: 2026-01-04
 */

/**
 * 模型能力枚举
 */
const ModelCapabilities = {
  TEXT_GENERATION: 'text_generation',       // 文本生成
  VISION: 'vision',                         // 视觉理解
  DEEP_THINKING: 'deep_thinking',           // 深度思考
  IMAGE_GENERATION: 'image_generation',     // 图像生成
  IMAGE_EDITING: 'image_editing',           // 图像编辑
  VIDEO_GENERATION: 'video_generation',     // 视频生成
  VIDEO_UNDERSTANDING: 'video_understanding', // 视频理解
  EMBEDDING: 'embedding',                   // 向量嵌入
  VISION_EMBEDDING: 'vision_embedding',     // 视觉嵌入
  TRANSLATION: 'translation',               // 翻译
  MODEL_3D: '3d_generation',               // 3D生成
  CODE_GENERATION: 'code_generation',       // 代码生成
  GUI_AGENT: 'gui_agent',                   // GUI自动化
  WEB_SEARCH: 'web_search',                 // 联网搜索
  FUNCTION_CALLING: 'function_calling',     // 函数调用
};

/**
 * 任务类型枚举
 */
const TaskTypes = {
  CHAT: 'chat',                             // 通用对话
  LONG_CONTEXT: 'long_context',             // 长文本处理
  COMPLEX_REASONING: 'complex_reasoning',   // 复杂推理
  IMAGE_UNDERSTANDING: 'image_understanding', // 图像理解
  VIDEO_UNDERSTANDING: 'video_understanding', // 视频理解
  IMAGE_CREATION: 'image_creation',         // 图像创作
  VIDEO_CREATION: 'video_creation',         // 视频创作
  TEXT_EMBEDDING: 'text_embedding',         // 文本向量化
  IMAGE_EMBEDDING: 'image_embedding',       // 图像向量化
  CODE_WRITING: 'code_writing',             // 代码编写
  TRANSLATION: 'translation',               // 翻译
  FAST_RESPONSE: 'fast_response',           // 快速响应
  COST_EFFECTIVE: 'cost_effective',         // 成本优化
  GUI_AUTOMATION: 'gui_automation',         // GUI自动化
  CREATIVE_WRITING: 'creative_writing',     // 创意写作
  KNOWLEDGE_QA: 'knowledge_qa',             // 知识问答
};

/**
 * 火山引擎豆包完整模型列表
 */
const VOLCENGINE_MODELS = {
  // ============= 文本生成模型 =============

  'doubao-seed-1.6': {
    id: 'doubao-seed-1-6-251015',  // ✅ 真实存在 - 2025年10月15日版本
    name: '豆包 Seed 1.6',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
      ModelCapabilities.DEEP_THINKING,
      ModelCapabilities.FUNCTION_CALLING,
    ],
    contextLength: 256000,      // 256K
    maxInputTokens: 224000,     // 224K
    maxOutputTokens: 32000,     // 32K
    thinkingMode: ['thinking', 'non-thinking', 'auto'],
    pricing: {
      input: 0.0008,            // ¥0.8/百万tokens
      output: 0.002,            // ¥2/百万tokens
      cache: 0.0002,            // 缓存优惠
    },
    bestFor: [
      TaskTypes.CHAT,
      TaskTypes.LONG_CONTEXT,
      TaskTypes.COMPLEX_REASONING,
      TaskTypes.KNOWLEDGE_QA,
    ],
    description: '豆包最新主力模型，支持深度思考模式，256K上下文，适合复杂推理任务',
    recommended: true,
  },

  'doubao-seed-1.6-thinking': {
    id: 'doubao-seed-1-6-thinking-250715',  // ✅ 真实存在 - 强制深度思考，32K输出
    name: '豆包 Seed 1.6 思考版',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
      ModelCapabilities.DEEP_THINKING,
    ],
    contextLength: 256000,
    maxInputTokens: 224000,
    maxOutputTokens: 32000,
    pricing: {
      input: 0.001,
      output: 0.0025,
    },
    bestFor: [
      TaskTypes.COMPLEX_REASONING,
      TaskTypes.CODE_WRITING,
      TaskTypes.CREATIVE_WRITING,
    ],
    description: '专注深度思考的版本，强制开启思考模式，适合需要复杂推理的场景',
  },

  'doubao-seed-1.6-flash': {
    id: 'doubao-seed-1-6-flash-250828',  // ✅ 真实存在 - 2025年8月28日最新版
    name: '豆包 Seed 1.6 快速版',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
      ModelCapabilities.VISION,
    ],
    contextLength: 256000,
    maxOutputTokens: 32000,
    pricing: {
      input: 0.0004,            // 价格更低
      output: 0.001,
    },
    bestFor: [
      TaskTypes.FAST_RESPONSE,
      TaskTypes.COST_EFFECTIVE,
      TaskTypes.CHAT,
    ],
    description: '快速响应版本，延迟更低，成本更优，支持视频/图像理解，适合实时对话',
    recommended: false,
  },

  'doubao-seed-1.6-lite': {
    id: 'doubao-seed-1-6-lite-251015',  // ✅ 真实存在 - 2025年10月15日版本
    name: '豆包 Seed 1.6 轻量版',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
    ],
    contextLength: 256000,
    maxOutputTokens: 32000,
    pricing: {
      input: 0.0003,            // 最低价格
      output: 0.0008,
    },
    bestFor: [
      TaskTypes.COST_EFFECTIVE,
      TaskTypes.CHAT,
    ],
    description: '轻量高效版本，支持reasoning_effort调节思考长度，价格最低，适合大规模调用场景',
  },

  'doubao-pro-32k': {
    id: 'doubao-pro-32k-240515',  // 使用带日期的正确格式
    name: '豆包 Pro 32K',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
      ModelCapabilities.FUNCTION_CALLING,
    ],
    contextLength: 32000,
    pricing: {
      input: 0.0008,
      output: 0.002,
    },
    bestFor: [
      TaskTypes.CHAT,
      TaskTypes.KNOWLEDGE_QA,
    ],
    description: '专业版模型，32K上下文，平衡性能和成本',
  },

  'doubao-lite-32k': {
    id: 'doubao-lite-32k-240515',  // 使用带日期的正确格式
    name: '豆包 Lite 32K',
    type: 'text',
    capabilities: [
      ModelCapabilities.TEXT_GENERATION,
    ],
    contextLength: 32000,
    pricing: {
      input: 0.0003,
      output: 0.0006,
    },
    bestFor: [
      TaskTypes.COST_EFFECTIVE,
      TaskTypes.CHAT,
    ],
    description: '轻量版32K模型，价格实惠',
  },

  // ============= 多模态视觉模型 =============

  'doubao-seed-1.6-vision': {
    id: 'doubao-seed-1-6-vision-250115',  // 使用带日期的正确格式
    name: '豆包 Seed 1.6 视觉版',
    type: 'vision',
    capabilities: [
      ModelCapabilities.VISION,
      ModelCapabilities.VIDEO_UNDERSTANDING,
      ModelCapabilities.DEEP_THINKING,
      ModelCapabilities.GUI_AGENT,
      ModelCapabilities.FUNCTION_CALLING,
    ],
    contextLength: 256000,
    maxOutputTokens: 64000,
    pricing: {
      input: 0.0026,            // 视觉模型价格较高
      output: 0.0078,
      imagePrice: 0.01,         // 每张图片
    },
    bestFor: [
      TaskTypes.IMAGE_UNDERSTANDING,
      TaskTypes.VIDEO_UNDERSTANDING,
      TaskTypes.GUI_AUTOMATION,
      TaskTypes.COMPLEX_REASONING,
    ],
    description: '首个视觉深度思考模型，支持图像/视频理解、GUI Agent、工具调用',
    recommended: true,
  },

  'doubao-1.5-vision-pro': {
    id: 'doubao-1-5-vision-pro-240828',  // 使用带日期的正确格式
    name: '豆包 1.5 Vision Pro',
    type: 'vision',
    capabilities: [
      ModelCapabilities.VISION,
      ModelCapabilities.VIDEO_UNDERSTANDING,
    ],
    contextLength: 128000,
    maxOutputTokens: 32000,
    pricing: {
      input: 0.002,
      output: 0.006,
      imagePrice: 0.008,
    },
    bestFor: [
      TaskTypes.IMAGE_UNDERSTANDING,
      TaskTypes.VIDEO_UNDERSTANDING,
    ],
    description: '专业视觉理解模型',
  },

  'doubao-1.5-vision-lite': {
    id: 'doubao-1-5-vision-lite-240828',  // 使用带日期的正确格式
    name: '豆包 1.5 Vision Lite',
    type: 'vision',
    capabilities: [
      ModelCapabilities.VISION,
    ],
    contextLength: 64000,
    pricing: {
      input: 0.001,
      output: 0.003,
      imagePrice: 0.004,
    },
    bestFor: [
      TaskTypes.IMAGE_UNDERSTANDING,
      TaskTypes.COST_EFFECTIVE,
    ],
    description: '轻量视觉模型，成本优化',
  },

  'doubao-1.5-thinking-vision-pro': {
    id: 'doubao-1-5-thinking-vision-pro-240828',  // 使用带日期的正确格式
    name: '豆包 1.5 思考视觉版',
    type: 'vision',
    capabilities: [
      ModelCapabilities.VISION,
      ModelCapabilities.DEEP_THINKING,
    ],
    contextLength: 128000,
    pricing: {
      input: 0.0025,
      output: 0.0075,
      imagePrice: 0.01,
    },
    bestFor: [
      TaskTypes.COMPLEX_REASONING,
      TaskTypes.IMAGE_UNDERSTANDING,
    ],
    description: '结合深度思考能力的视觉模型（已被1.6-vision替代）',
  },

  // ============= 图像生成模型 =============

  'doubao-seedream-4.5': {
    id: 'doubao-seedream-4.5',
    name: '豆包 Seedream 4.5',
    type: 'image_generation',
    capabilities: [
      ModelCapabilities.IMAGE_GENERATION,
    ],
    pricing: {
      standard: 0.08,           // ¥0.08/张（标准质量）
      high: 0.15,               // ¥0.15/张（高质量）
    },
    bestFor: [
      TaskTypes.IMAGE_CREATION,
      TaskTypes.CREATIVE_WRITING,
    ],
    description: '最新图像生成模型，支持多种风格和比例',
    recommended: true,
  },

  'doubao-seedream-4.0': {
    id: 'doubao-seedream-4.0',
    name: '豆包 Seedream 4.0',
    type: 'image_generation',
    capabilities: [
      ModelCapabilities.IMAGE_GENERATION,
    ],
    pricing: {
      standard: 0.06,
      high: 0.12,
    },
    bestFor: [
      TaskTypes.IMAGE_CREATION,
    ],
    description: '上一代图像生成模型',
  },

  'doubao-seedream-3.0-t2i': {
    id: 'doubao-seedream-3.0-t2i',
    name: '豆包 Seedream 3.0 文生图',
    type: 'image_generation',
    capabilities: [
      ModelCapabilities.IMAGE_GENERATION,
    ],
    pricing: {
      standard: 0.04,
    },
    bestFor: [
      TaskTypes.IMAGE_CREATION,
      TaskTypes.COST_EFFECTIVE,
    ],
    description: '文本生成图像模型，成本较低',
  },

  'doubao-seededit-3.0-i2i': {
    id: 'doubao-seededit-3.0-i2i',
    name: '豆包 SeedEdit 3.0',
    type: 'image_editing',
    capabilities: [
      ModelCapabilities.IMAGE_EDITING,
    ],
    pricing: {
      standard: 0.05,
    },
    bestFor: [
      TaskTypes.IMAGE_CREATION,
    ],
    description: '图像编辑模型，支持背景移除、光线调整、姿态修改等',
  },

  // ============= 视频生成模型 =============

  'doubao-seedance-1.5-pro': {
    id: 'doubao-seedance-1.5-pro',
    name: '豆包 Seedance 1.5 Pro',
    type: 'video_generation',
    capabilities: [
      ModelCapabilities.VIDEO_GENERATION,
    ],
    pricing: {
      perSecond: 0.3,           // ¥0.3/秒
    },
    bestFor: [
      TaskTypes.VIDEO_CREATION,
    ],
    description: '最新专业视频生成模型，支持首尾帧控制',
    recommended: true,
  },

  'doubao-seedance-1.0-pro': {
    id: 'doubao-seedance-1.0-pro',
    name: '豆包 Seedance 1.0 Pro',
    type: 'video_generation',
    capabilities: [
      ModelCapabilities.VIDEO_GENERATION,
    ],
    pricing: {
      perSecond: 0.25,
    },
    bestFor: [
      TaskTypes.VIDEO_CREATION,
    ],
    description: '专业视频生成，支持多镜头语言和多种风格',
  },

  'doubao-seedance-1.0-lite': {
    id: 'doubao-seedance-1.0-lite',
    name: '豆包 Seedance 1.0 Lite',
    type: 'video_generation',
    capabilities: [
      ModelCapabilities.VIDEO_GENERATION,
    ],
    pricing: {
      perSecond: 0.15,
    },
    bestFor: [
      TaskTypes.VIDEO_CREATION,
      TaskTypes.COST_EFFECTIVE,
    ],
    description: '轻量视频生成，成本更优',
  },

  'doubao-pixeldance': {
    id: 'doubao-pixeldance',
    name: '豆包 PixelDance',
    type: 'video_generation',
    capabilities: [
      ModelCapabilities.VIDEO_GENERATION,
    ],
    pricing: {
      perSecond: 0.3,
    },
    bestFor: [
      TaskTypes.VIDEO_CREATION,
    ],
    description: '高动态视频生成，支持复杂连续动作和极致镜头控制',
  },

  // ============= 嵌入向量模型 =============

  'doubao-embedding-large': {
    id: 'doubao-embedding-large',
    name: '豆包 Embedding Large',
    type: 'embedding',
    capabilities: [
      ModelCapabilities.EMBEDDING,
    ],
    dimensions: 2048,           // 向量维度
    maxTokens: 8192,
    pricing: {
      input: 0.0002,            // ¥0.2/百万tokens
    },
    bestFor: [
      TaskTypes.TEXT_EMBEDDING,
      TaskTypes.KNOWLEDGE_QA,
    ],
    description: '大型嵌入模型，2048维，适合高精度检索',
    recommended: true,
  },

  'doubao-embedding': {
    id: 'doubao-embedding-text-240715',
    name: '豆包 Embedding',
    type: 'embedding',
    capabilities: [
      ModelCapabilities.EMBEDDING,
    ],
    dimensions: 1024,
    maxTokens: 8192,
    pricing: {
      input: 0.00015,
    },
    bestFor: [
      TaskTypes.TEXT_EMBEDDING,
      TaskTypes.COST_EFFECTIVE,
    ],
    description: '标准嵌入模型，1024维，支持中英文',
  },

  'doubao-embedding-vision': {
    id: 'doubao-embedding-vision',
    name: '豆包 Embedding Vision',
    type: 'embedding',
    capabilities: [
      ModelCapabilities.VISION_EMBEDDING,
    ],
    dimensions: 1536,
    pricing: {
      input: 0.0003,
      imagePrice: 0.001,        // 每张图片
    },
    bestFor: [
      TaskTypes.IMAGE_EMBEDDING,
    ],
    description: '视觉嵌入模型，支持图像向量化',
  },

  // ============= 专用模型 =============

  'doubao-seed-translation': {
    id: 'doubao-seed-translation',
    name: '豆包 翻译专用',
    type: 'text',
    capabilities: [
      ModelCapabilities.TRANSLATION,
    ],
    contextLength: 32000,
    pricing: {
      input: 0.0005,
      output: 0.0015,
    },
    bestFor: [
      TaskTypes.TRANSLATION,
    ],
    description: '专为翻译任务优化的模型',
  },

  'doubao-seed3d-1.0': {
    id: 'doubao-seed3d-1.0',
    name: '豆包 3D生成',
    type: '3d_generation',
    capabilities: [
      ModelCapabilities.MODEL_3D,
    ],
    pricing: {
      perModel: 1.5,            // ¥1.5/个3D模型
    },
    bestFor: [
      TaskTypes.IMAGE_CREATION,
    ],
    description: '3D模型生成',
  },

  'doubao-1.5-ui-tars': {
    id: 'doubao-1.5-ui-tars',
    name: '豆包 UI Tars',
    type: 'vision',
    capabilities: [
      ModelCapabilities.GUI_AGENT,
      ModelCapabilities.VISION,
    ],
    pricing: {
      input: 0.002,
      output: 0.006,
    },
    bestFor: [
      TaskTypes.GUI_AUTOMATION,
    ],
    description: 'GUI自动化专用模型',
  },

  'doubao-seed-1.6-code': {
    id: 'doubao-seed-code',  // Code模型使用特殊命名，不带日期
    name: '豆包 Code',
    type: 'text',
    capabilities: [
      ModelCapabilities.CODE_GENERATION,
    ],
    contextLength: 128000,
    pricing: {
      input: 0.0006,
      output: 0.0018,
    },
    bestFor: [
      TaskTypes.CODE_WRITING,
    ],
    description: '代码生成专用模型',
  },
};

/**
 * 智能模型选择器
 */
class VolcengineModelSelector {
  constructor() {
    this.models = VOLCENGINE_MODELS;
  }

  /**
   * 根据任务类型智能选择模型
   * @param {string} taskType - 任务类型
   * @param {Object} options - 选项
   * @param {boolean} options.preferCost - 优先考虑成本
   * @param {boolean} options.preferQuality - 优先考虑质量
   * @param {boolean} options.preferSpeed - 优先考虑速度
   * @param {number} options.contextLength - 所需上下文长度
   * @param {Array<string>} options.requiredCapabilities - 必需的能力
   * @returns {Object} 推荐的模型
   */
  selectModel(taskType, options = {}) {
    const {
      preferCost = false,
      preferQuality = false,
      preferSpeed = false,
      contextLength = 0,
      requiredCapabilities = [],
    } = options;

    // 1. 按任务类型筛选候选模型
    let candidates = Object.values(this.models).filter(model => {
      return model.bestFor && model.bestFor.includes(taskType);
    });

    if (candidates.length === 0) {
      logger.warn(`[ModelSelector] 未找到适合 ${taskType} 的模型，使用默认模型`);
      return this.models['doubao-seed-1.6'];
    }

    // 2. 按能力筛选
    if (requiredCapabilities.length > 0) {
      candidates = candidates.filter(model => {
        return requiredCapabilities.every(cap =>
          model.capabilities.includes(cap)
        );
      });
    }

    // 3. 按上下文长度筛选
    if (contextLength > 0) {
      candidates = candidates.filter(model =>
        model.contextLength && model.contextLength >= contextLength
      );
    }

    // 4. 根据偏好排序
    if (preferCost) {
      // 成本优先：选择价格最低的
      candidates.sort((a, b) => {
        const priceA = a.pricing?.input || 0;
        const priceB = b.pricing?.input || 0;
        return priceA - priceB;
      });
    } else if (preferSpeed) {
      // 速度优先：选择闪电版或轻量版
      candidates.sort((a, b) => {
        const isFlashA = a.id.includes('flash') ? 1 : 0;
        const isFlashB = b.id.includes('flash') ? 1 : 0;
        return isFlashB - isFlashA;
      });
    } else if (preferQuality) {
      // 质量优先：选择推荐模型或pro版本
      candidates.sort((a, b) => {
        const scoreA = (a.recommended ? 10 : 0) + (a.id.includes('pro') ? 5 : 0);
        const scoreB = (b.recommended ? 10 : 0) + (b.id.includes('pro') ? 5 : 0);
        return scoreB - scoreA;
      });
    }

    // 5. 返回最佳匹配
    const selectedModel = candidates[0];

    logger.info(`[ModelSelector] 为任务 ${taskType} 选择模型: ${selectedModel.name}`);
    logger.info(`[ModelSelector] 模型能力:`, selectedModel.capabilities);
    logger.info(`[ModelSelector] 预估成本: ¥${selectedModel.pricing?.input || 'N/A'}/百万tokens`);

    return selectedModel;
  }

  /**
   * 根据具体场景智能选择
   * @param {Object} scenario - 场景描述
   * @returns {Object} 推荐的模型
   */
  selectByScenario(scenario) {
    const {
      hasImage = false,
      hasVideo = false,
      needsThinking = false,
      needsWebSearch = false,
      needsFunctionCalling = false,
      needsEmbedding = false,
      needsImageGeneration = false,
      needsVideoGeneration = false,
      textLength = 0,
      userBudget = 'medium', // 'low' | 'medium' | 'high'
    } = scenario;

    // 图像生成
    if (needsImageGeneration) {
      return userBudget === 'low'
        ? this.models['doubao-seedream-3.0-t2i']
        : this.models['doubao-seedream-4.5'];
    }

    // 视频生成
    if (needsVideoGeneration) {
      return userBudget === 'low'
        ? this.models['doubao-seedance-1.0-lite']
        : this.models['doubao-seedance-1.5-pro'];
    }

    // 嵌入向量
    if (needsEmbedding) {
      if (hasImage) {
        return this.models['doubao-embedding-vision'];
      }
      return userBudget === 'low'
        ? this.models['doubao-embedding']
        : this.models['doubao-embedding-large'];
    }

    // 视觉理解
    if (hasImage || hasVideo) {
      if (needsThinking || needsFunctionCalling) {
        return this.models['doubao-seed-1.6-vision'];
      }
      return userBudget === 'low'
        ? this.models['doubao-1.5-vision-lite']
        : this.models['doubao-1.5-vision-pro'];
    }

    // 文本生成
    const requiredCapabilities = [];
    if (needsThinking) {
      requiredCapabilities.push(ModelCapabilities.DEEP_THINKING);
    }
    if (needsFunctionCalling) {
      requiredCapabilities.push(ModelCapabilities.FUNCTION_CALLING);
    }

    const options = {
      requiredCapabilities,
      contextLength: textLength,
      preferCost: userBudget === 'low',
      preferQuality: userBudget === 'high',
      preferSpeed: userBudget === 'medium',
    };

    return this.selectModel(TaskTypes.CHAT, options);
  }

  /**
   * 获取模型详情
   * @param {string} modelId - 模型ID
   * @returns {Object|null} 模型详情
   */
  getModelDetails(modelId) {
    return this.models[modelId] || null;
  }

  /**
   * 列出所有模型
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模型列表
   */
  listModels(filters = {}) {
    const { type, capability, recommended } = filters;

    let models = Object.values(this.models);

    if (type) {
      models = models.filter(m => m.type === type);
    }

    if (capability) {
      models = models.filter(m => m.capabilities.includes(capability));
    }

    if (recommended !== undefined) {
      models = models.filter(m => m.recommended === recommended);
    }

    return models;
  }

  /**
   * 估算成本
   * @param {string} modelId - 模型ID
   * @param {number} inputTokens - 输入tokens
   * @param {number} outputTokens - 输出tokens
   * @param {number} imageCount - 图片数量
   * @returns {number} 预估成本（人民币）
   */
  estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0) {
    const model = this.models[modelId];
    if (!model || !model.pricing) {
      return 0;
    }

    let cost = 0;

    // 文本成本（按百万tokens计费）
    if (model.pricing.input) {
      cost += (inputTokens / 1000000) * model.pricing.input;
    }
    if (model.pricing.output) {
      cost += (outputTokens / 1000000) * model.pricing.output;
    }

    // 图片成本
    if (imageCount > 0 && model.pricing.imagePrice) {
      cost += imageCount * model.pricing.imagePrice;
    }

    return cost;
  }
}

// 创建单例
let modelSelectorInstance = null;

function getModelSelector() {
  if (!modelSelectorInstance) {
    modelSelectorInstance = new VolcengineModelSelector();
  }
  return modelSelectorInstance;
}

module.exports = {
  VOLCENGINE_MODELS,
  ModelCapabilities,
  TaskTypes,
  VolcengineModelSelector,
  getModelSelector,
};
