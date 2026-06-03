/**
 * 视觉工具集
 *
 * 提供图片分析、OCR、视觉问答等工具
 *
 * @module extended-tools-vision
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * Vision 工具处理器
 */
class VisionToolsHandler {
  constructor() {
    this.visionManager = null;
  }

  /**
   * 设置 VisionManager 引用
   * @param {Object} visionManager - VisionManager 实例
   */
  setVisionManager(visionManager) {
    this.visionManager = visionManager;
    logger.info('[VisionTools] VisionManager 已设置');
  }

  /**
   * 注册所有视觉工具
   * @param {FunctionCaller} functionCaller - 函数调用器实例
   */
  register(functionCaller) {
    const self = this;

    // ====== 图片分析工具 ======

    functionCaller.registerTool(
      'vision_analyze',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePath,
          imageBase64,
          prompt = '请详细分析这张图片',
        } = params;

        if (!imagePath && !imageBase64) {
          throw new Error('请提供图片路径或 Base64 数据');
        }

        const result = await self.visionManager.analyzeImage({
          imagePath,
          imageBase64,
          prompt,
          type: 'analyze',
        });

        return {
          success: true,
          analysis: result.text,
          model: result.model,
          duration: result.duration,
        };
      },
      {
        name: 'vision_analyze',
        description: '分析图片内容，提取图片中的信息和细节',
        parameters: {
          imagePath: {
            type: 'string',
            description: '图片文件路径',
            required: false,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 编码的图片数据',
            required: false,
          },
          prompt: {
            type: 'string',
            description: '分析提示词，指导如何分析图片',
            default: '请详细分析这张图片',
          },
        },
      }
    );

    // ====== 图片描述工具 ======

    functionCaller.registerTool(
      'vision_describe',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePath,
          imageBase64,
          style = 'detailed', // detailed | brief | technical
        } = params;

        if (!imagePath && !imageBase64) {
          throw new Error('请提供图片路径或 Base64 数据');
        }

        const result = await self.visionManager.describeImage({
          imagePath,
          imageBase64,
          style,
        });

        return {
          success: true,
          description: result.text,
          style,
          model: result.model,
          duration: result.duration,
        };
      },
      {
        name: 'vision_describe',
        description: '生成图片的文字描述',
        parameters: {
          imagePath: {
            type: 'string',
            description: '图片文件路径',
            required: false,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 编码的图片数据',
            required: false,
          },
          style: {
            type: 'string',
            description: '描述风格：detailed(详细)、brief(简洁)、technical(技术性)',
            enum: ['detailed', 'brief', 'technical'],
            default: 'detailed',
          },
        },
      }
    );

    // ====== OCR 文字识别工具 ======

    functionCaller.registerTool(
      'vision_ocr',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePath,
          imageBase64,
          language = '中文和英文',
        } = params;

        if (!imagePath && !imageBase64) {
          throw new Error('请提供图片路径或 Base64 数据');
        }

        const result = await self.visionManager.performOCR({
          imagePath,
          imageBase64,
          language,
        });

        return {
          success: true,
          text: result.text,
          language,
          model: result.model,
          duration: result.duration,
        };
      },
      {
        name: 'vision_ocr',
        description: '识别图片中的文字内容（OCR）',
        parameters: {
          imagePath: {
            type: 'string',
            description: '图片文件路径',
            required: false,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 编码的图片数据',
            required: false,
          },
          language: {
            type: 'string',
            description: '要识别的语言',
            default: '中文和英文',
          },
        },
      }
    );

    // ====== 视觉问答工具 ======

    functionCaller.registerTool(
      'vision_qa',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePath,
          imageBase64,
          question,
        } = params;

        if (!imagePath && !imageBase64) {
          throw new Error('请提供图片路径或 Base64 数据');
        }

        if (!question) {
          throw new Error('请提供要回答的问题');
        }

        const result = await self.visionManager.visualQA({
          imagePath,
          imageBase64,
          question,
        });

        return {
          success: true,
          answer: result.text,
          question,
          model: result.model,
          duration: result.duration,
        };
      },
      {
        name: 'vision_qa',
        description: '基于图片内容回答问题（视觉问答）',
        parameters: {
          imagePath: {
            type: 'string',
            description: '图片文件路径',
            required: false,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 编码的图片数据',
            required: false,
          },
          question: {
            type: 'string',
            description: '关于图片的问题',
            required: true,
          },
        },
      }
    );

    // ====== 批量图片分析工具 ======

    functionCaller.registerTool(
      'vision_batch_analyze',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePaths = [],
          type = 'describe',
          concurrency = 2,
        } = params;

        if (!imagePaths || imagePaths.length === 0) {
          throw new Error('请提供图片路径列表');
        }

        const imageList = imagePaths.map(imagePath => ({
          imagePath,
          type,
        }));

        const results = await self.visionManager.batchAnalyze(imageList, {
          concurrency,
        });

        return {
          success: true,
          total: imagePaths.length,
          successful: results.filter(r => !r.error).length,
          failed: results.filter(r => r.error).length,
          results,
        };
      },
      {
        name: 'vision_batch_analyze',
        description: '批量分析多张图片',
        parameters: {
          imagePaths: {
            type: 'array',
            description: '图片路径数组',
            required: true,
            items: { type: 'string' },
          },
          type: {
            type: 'string',
            description: '分析类型：describe(描述)、ocr(文字识别)、analyze(通用分析)',
            enum: ['describe', 'ocr', 'analyze'],
            default: 'describe',
          },
          concurrency: {
            type: 'number',
            description: '并发数量',
            default: 2,
          },
        },
      }
    );

    // ====== 图片内容提取工具 ======

    functionCaller.registerTool(
      'vision_extract',
      async (params, context) => {
        if (!self.visionManager) {
          throw new Error('VisionManager 未初始化');
        }

        const {
          imagePath,
          imageBase64,
          extractType = 'all', // all | objects | text | colors | faces
        } = params;

        if (!imagePath && !imageBase64) {
          throw new Error('请提供图片路径或 Base64 数据');
        }

        const prompts = {
          all: '请从图片中提取所有可识别的信息，包括：对象、文字、颜色、场景等。以结构化的格式输出。',
          objects: '请识别并列出图片中的所有对象/物体，包括其位置和特征。',
          text: '请提取图片中的所有文字内容，保持原有格式。',
          colors: '请分析图片中的主要颜色和配色方案。',
          faces: '请识别图片中的人脸，描述其特征（如性别、年龄估计、表情等）。',
        };

        const result = await self.visionManager.analyzeImage({
          imagePath,
          imageBase64,
          prompt: prompts[extractType] || prompts.all,
          type: 'extract',
        });

        return {
          success: true,
          extractType,
          extracted: result.text,
          model: result.model,
          duration: result.duration,
        };
      },
      {
        name: 'vision_extract',
        description: '从图片中提取特定类型的信息',
        parameters: {
          imagePath: {
            type: 'string',
            description: '图片文件路径',
            required: false,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 编码的图片数据',
            required: false,
          },
          extractType: {
            type: 'string',
            description: '提取类型：all(全部)、objects(对象)、text(文字)、colors(颜色)、faces(人脸)',
            enum: ['all', 'objects', 'text', 'colors', 'faces'],
            default: 'all',
          },
        },
      }
    );

    logger.info('[VisionTools] ✓ 6 个视觉工具已注册');
  }
}

// 单例实例
let visionToolsInstance = null;

/**
 * 获取 VisionToolsHandler 单例
 * @returns {VisionToolsHandler}
 */
function getVisionTools() {
  if (!visionToolsInstance) {
    visionToolsInstance = new VisionToolsHandler();
  }
  return visionToolsInstance;
}

module.exports = {
  VisionToolsHandler,
  getVisionTools,
};
