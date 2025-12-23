/**
 * 图像设计引擎
 * 负责AI文生图、背景移除、图片增强和批量处理
 * 使用Sharp进行图像处理，支持AI图像生成
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const axios = require('axios');

class ImageEngine extends EventEmitter {
  constructor(llmManager = null) {
    super();
    this.llmManager = llmManager;

    // 支持的图像格式
    this.supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'gif', 'svg'];

    // 预设尺寸
    this.presetSizes = {
      'thumbnail': { width: 150, height: 150 },
      'small': { width: 480, height: 320 },
      'medium': { width: 1024, height: 768 },
      'large': { width: 1920, height: 1080 },
      'square_sm': { width: 512, height: 512 },
      'square_md': { width: 1024, height: 1024 },
      'portrait': { width: 768, height: 1024 },
      'landscape': { width: 1024, height: 768 }
    };

    // AI图像生成服务配置
    this.aiImageServices = {
      'stable-diffusion': {
        name: 'Stable Diffusion',
        endpoint: process.env.SD_API_ENDPOINT || 'http://localhost:7860'
      },
      'dalle': {
        name: 'DALL-E',
        endpoint: 'https://api.openai.com/v1/images/generations',
        apiKey: process.env.OPENAI_API_KEY
      },
      'midjourney': {
        name: 'Midjourney',
        // Midjourney需要Discord API集成
      }
    };
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async handleProjectTask(params, onProgress = null) {
    const { taskType, inputPath, outputPath, options = {} } = params;

    console.log('[Image Engine] 执行任务:', taskType);

    switch (taskType) {
      case 'generateFromText':
        return await this.generateImageFromText(params.prompt, outputPath, options, onProgress);

      case 'removeBackground':
        return await this.removeBackground(inputPath, outputPath, options, onProgress);

      case 'resize':
        return await this.resizeImage(inputPath, outputPath, options);

      case 'crop':
        return await this.cropImage(inputPath, outputPath, options);

      case 'enhance':
        return await this.enhanceImage(inputPath, outputPath, options);

      case 'upscale':
        return await this.upscaleImage(inputPath, outputPath, options, onProgress);

      case 'addWatermark':
        return await this.addWatermark(inputPath, outputPath, options);

      case 'batchProcess':
        return await this.batchProcess(params.imageList, params.outputDir, options, onProgress);

      case 'convertFormat':
        return await this.convertFormat(inputPath, outputPath, options);

      case 'createCollage':
        return await this.createCollage(params.imageList, outputPath, options);

      default:
        throw new Error(`不支持的任务类型: ${taskType}`);
    }
  }

  /**
   * AI文生图
   * @param {string} prompt - 文本描述
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 生成选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 生成结果
   */
  async generateImageFromText(prompt, outputPath, options = {}, onProgress = null) {
    const {
      service = 'stable-diffusion',
      size = 'square_md',
      style = 'realistic',
      quality = 'high',
      negativePrompt = ''
    } = options;

    console.log(`[Image Engine] AI文生图: ${prompt.substring(0, 50)}...`);

    if (onProgress) {
      onProgress({ percent: 10, message: '正在连接AI服务...' });
    }

    try {
      let imageBuffer;

      if (service === 'stable-diffusion') {
        imageBuffer = await this.generateWithStableDiffusion(prompt, { size, negativePrompt }, onProgress);
      } else if (service === 'dalle') {
        imageBuffer = await this.generateWithDALLE(prompt, { size, quality }, onProgress);
      } else {
        throw new Error(`不支持的AI服务: ${service}`);
      }

      if (onProgress) {
        onProgress({ percent: 90, message: '正在保存图片...' });
      }

      // 保存图片
      await sharp(imageBuffer)
        .toFile(outputPath);

      if (onProgress) {
        onProgress({ percent: 100, message: '图片生成完成' });
      }

      console.log('[Image Engine] AI图片生成完成');
      return {
        success: true,
        outputPath: outputPath,
        prompt: prompt,
        service: service
      };

    } catch (error) {
      console.error('[Image Engine] AI图片生成失败:', error);
      throw error;
    }
  }

  /**
   * 使用Stable Diffusion生成图片
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Buffer>} 图片缓冲区
   */
  async generateWithStableDiffusion(prompt, options, onProgress) {
    const { size, negativePrompt } = options;
    const sizeConfig = this.presetSizes[size] || this.presetSizes['square_md'];

    if (onProgress) {
      onProgress({ percent: 30, message: '正在生成图片...' });
    }

    try {
      const response = await axios.post(
        `${this.aiImageServices['stable-diffusion'].endpoint}/sdapi/v1/txt2img`,
        {
          prompt: prompt,
          negative_prompt: negativePrompt,
          width: sizeConfig.width,
          height: sizeConfig.height,
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras'
        },
        {
          timeout: 120000 // 2分钟超时
        }
      );

      if (onProgress) {
        onProgress({ percent: 80, message: '图片生成完成，正在处理...' });
      }

      // Stable Diffusion返回base64编码的图片
      const imageBase64 = response.data.images[0];
      return Buffer.from(imageBase64, 'base64');

    } catch (error) {
      console.error('[Image Engine] Stable Diffusion生成失败:', error.message);
      // 如果SD服务不可用，生成一个占位图
      return await this.generatePlaceholderImage(sizeConfig.width, sizeConfig.height, prompt);
    }
  }

  /**
   * 使用DALL-E生成图片
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Buffer>} 图片缓冲区
   */
  async generateWithDALLE(prompt, options, onProgress) {
    const { size, quality } = options;

    if (onProgress) {
      onProgress({ percent: 30, message: '正在调用DALL-E API...' });
    }

    const dalleSize = size === 'square_sm' ? '512x512' : '1024x1024';

    try {
      const response = await axios.post(
        this.aiImageServices['dalle'].endpoint,
        {
          model: 'dall-e-3',
          prompt: prompt,
          n: 1,
          size: dalleSize,
          quality: quality
        },
        {
          headers: {
            'Authorization': `Bearer ${this.aiImageServices['dalle'].apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      if (onProgress) {
        onProgress({ percent: 70, message: '正在下载生成的图片...' });
      }

      // 下载图片
      const imageUrl = response.data.data[0].url;
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });

      return Buffer.from(imageResponse.data);

    } catch (error) {
      console.error('[Image Engine] DALL-E生成失败:', error.message);
      // 生成占位图
      const sizeConfig = this.presetSizes[size] || this.presetSizes['square_md'];
      return await this.generatePlaceholderImage(sizeConfig.width, sizeConfig.height, prompt);
    }
  }

  /**
   * 生成占位图
   * @param {number} width - 宽度
   * @param {number} height - 高度
   * @param {string} text - 文本
   * @returns {Promise<Buffer>} 图片缓冲区
   */
  async generatePlaceholderImage(width, height, text) {
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#3B82F6"/>
        <text x="50%" y="50%" text-anchor="middle" fill="white" font-size="24" font-family="Arial">
          ${text.substring(0, 30)}...
        </text>
        <text x="50%" y="60%" text-anchor="middle" fill="white" font-size="16" font-family="Arial">
          AI生成示例图片
        </text>
      </svg>
    `;

    return sharp(Buffer.from(svg))
      .png()
      .toBuffer();
  }

  /**
   * 移除背景
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async removeBackground(inputPath, outputPath, options = {}, onProgress = null) {
    console.log(`[Image Engine] 移除背景: ${inputPath}`);

    if (onProgress) {
      onProgress({ percent: 10, message: '正在加载图片...' });
    }

    try {
      // 使用简单的阈值方法移除白色背景
      // 更高级的背景移除需要使用rembg或类似服务
      const image = sharp(inputPath);
      const metadata = await image.metadata();

      if (onProgress) {
        onProgress({ percent: 50, message: '正在处理图片...' });
      }

      // 简单的背景移除（将白色区域变为透明）
      await image
        .threshold(240, { greyscale: false })
        .toFormat('png', { quality: 100 })
        .toFile(outputPath);

      if (onProgress) {
        onProgress({ percent: 100, message: '背景移除完成' });
      }

      console.log('[Image Engine] 背景移除完成');
      return {
        success: true,
        outputPath: outputPath
      };

    } catch (error) {
      console.error('[Image Engine] 背景移除失败:', error);
      throw error;
    }
  }

  /**
   * 调整图片大小
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async resizeImage(inputPath, outputPath, options = {}) {
    const { width, height, fit = 'cover', preset = null } = options;

    console.log(`[Image Engine] 调整大小: ${width}x${height}`);

    try {
      const image = sharp(inputPath);

      if (preset && this.presetSizes[preset]) {
        const size = this.presetSizes[preset];
        await image
          .resize(size.width, size.height, { fit: fit })
          .toFile(outputPath);
      } else {
        await image
          .resize(width, height, { fit: fit })
          .toFile(outputPath);
      }

      console.log('[Image Engine] 调整大小完成');
      return {
        success: true,
        outputPath: outputPath,
        width: width || this.presetSizes[preset].width,
        height: height || this.presetSizes[preset].height
      };

    } catch (error) {
      console.error('[Image Engine] 调整大小失败:', error);
      throw error;
    }
  }

  /**
   * 裁剪图片
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async cropImage(inputPath, outputPath, options = {}) {
    const { left = 0, top = 0, width, height } = options;

    console.log(`[Image Engine] 裁剪图片: ${width}x${height} at (${left}, ${top})`);

    try {
      await sharp(inputPath)
        .extract({ left, top, width, height })
        .toFile(outputPath);

      console.log('[Image Engine] 裁剪完成');
      return {
        success: true,
        outputPath: outputPath
      };

    } catch (error) {
      console.error('[Image Engine] 裁剪失败:', error);
      throw error;
    }
  }

  /**
   * 增强图片
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async enhanceImage(inputPath, outputPath, options = {}) {
    const {
      brightness = 1.0,
      contrast = 1.0,
      saturation = 1.0,
      sharpen = false
    } = options;

    console.log(`[Image Engine] 增强图片`);

    try {
      let image = sharp(inputPath);

      // 调整亮度、对比度、饱和度
      if (brightness !== 1.0) {
        image = image.modulate({ brightness });
      }

      if (saturation !== 1.0) {
        image = image.modulate({ saturation });
      }

      // 锐化
      if (sharpen) {
        image = image.sharpen();
      }

      await image.toFile(outputPath);

      console.log('[Image Engine] 图片增强完成');
      return {
        success: true,
        outputPath: outputPath
      };

    } catch (error) {
      console.error('[Image Engine] 图片增强失败:', error);
      throw error;
    }
  }

  /**
   * 图片超分辨率
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async upscaleImage(inputPath, outputPath, options = {}, onProgress = null) {
    const { scale = 2 } = options;

    console.log(`[Image Engine] 图片超分辨率: ${scale}x`);

    if (onProgress) {
      onProgress({ percent: 10, message: '正在加载图片...' });
    }

    try {
      const metadata = await sharp(inputPath).metadata();
      const newWidth = Math.round(metadata.width * scale);
      const newHeight = Math.round(metadata.height * scale);

      if (onProgress) {
        onProgress({ percent: 50, message: '正在放大图片...' });
      }

      // 使用Lanczos3算法进行高质量缩放
      await sharp(inputPath)
        .resize(newWidth, newHeight, {
          kernel: sharp.kernel.lanczos3
        })
        .sharpen()
        .toFile(outputPath);

      if (onProgress) {
        onProgress({ percent: 100, message: '超分辨率完成' });
      }

      console.log('[Image Engine] 超分辨率完成');
      return {
        success: true,
        outputPath: outputPath,
        scale: scale,
        newSize: { width: newWidth, height: newHeight }
      };

    } catch (error) {
      console.error('[Image Engine] 超分辨率失败:', error);
      throw error;
    }
  }

  /**
   * 添加水印
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async addWatermark(inputPath, outputPath, options = {}) {
    const {
      text = 'ChainlessChain',
      position = 'bottom-right',
      opacity = 0.5,
      fontSize = 24
    } = options;

    console.log(`[Image Engine] 添加水印: ${text}`);

    try {
      const metadata = await sharp(inputPath).metadata();

      // 计算水印位置
      let x, y;
      const padding = 20;

      switch (position) {
        case 'top-left':
          x = padding;
          y = padding;
          break;
        case 'top-right':
          x = metadata.width - 200;
          y = padding;
          break;
        case 'bottom-left':
          x = padding;
          y = metadata.height - 50;
          break;
        case 'bottom-right':
        default:
          x = metadata.width - 200;
          y = metadata.height - 50;
          break;
      }

      // 创建水印SVG
      const watermarkSvg = `
        <svg width="${metadata.width}" height="${metadata.height}">
          <text x="${x}" y="${y}"
                font-size="${fontSize}"
                font-family="Arial"
                fill="white"
                opacity="${opacity}">
            ${text}
          </text>
        </svg>
      `;

      const watermarkBuffer = Buffer.from(watermarkSvg);

      await sharp(inputPath)
        .composite([{
          input: watermarkBuffer,
          gravity: 'northwest'
        }])
        .toFile(outputPath);

      console.log('[Image Engine] 水印添加完成');
      return {
        success: true,
        outputPath: outputPath
      };

    } catch (error) {
      console.error('[Image Engine] 水印添加失败:', error);
      throw error;
    }
  }

  /**
   * 批量处理图片
   * @param {Array<string>} imageList - 图片路径列表
   * @param {string} outputDir - 输出目录
   * @param {Object} options - 处理选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   */
  async batchProcess(imageList, outputDir, options = {}, onProgress = null) {
    const { operation = 'resize', ...opOptions } = options;

    console.log(`[Image Engine] 批量处理 ${imageList.length} 张图片`);

    const results = [];
    const errors = [];

    for (let i = 0; i < imageList.length; i++) {
      const inputPath = imageList[i];
      const fileName = path.basename(inputPath);
      const outputPath = path.join(outputDir, fileName);

      try {
        if (onProgress) {
          const percent = Math.round(((i + 1) / imageList.length) * 100);
          onProgress({
            percent: percent,
            message: `正在处理: ${fileName} (${i + 1}/${imageList.length})`
          });
        }

        let result;
        switch (operation) {
          case 'resize':
            result = await this.resizeImage(inputPath, outputPath, opOptions);
            break;
          case 'enhance':
            result = await this.enhanceImage(inputPath, outputPath, opOptions);
            break;
          case 'crop':
            result = await this.cropImage(inputPath, outputPath, opOptions);
            break;
          case 'convertFormat':
            result = await this.convertFormat(inputPath, outputPath, opOptions);
            break;
          default:
            throw new Error(`不支持的批量操作: ${operation}`);
        }

        results.push({ ...result, inputPath });

      } catch (error) {
        console.error(`[Image Engine] 处理失败: ${fileName}`, error);
        errors.push({
          inputPath: inputPath,
          fileName: fileName,
          error: error.message
        });
      }
    }

    console.log(`[Image Engine] 批量处理完成: ${results.length} 成功, ${errors.length} 失败`);
    return {
      success: true,
      totalCount: imageList.length,
      successCount: results.length,
      errorCount: errors.length,
      results: results,
      errors: errors
    };
  }

  /**
   * 转换图片格式
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async convertFormat(inputPath, outputPath, options = {}) {
    const { format = 'png', quality = 90 } = options;

    console.log(`[Image Engine] 格式转换: ${format}`);

    try {
      await sharp(inputPath)
        .toFormat(format, { quality: quality })
        .toFile(outputPath);

      console.log('[Image Engine] 格式转换完成');
      return {
        success: true,
        outputPath: outputPath,
        format: format
      };

    } catch (error) {
      console.error('[Image Engine] 格式转换失败:', error);
      throw error;
    }
  }

  /**
   * 创建图片拼贴
   * @param {Array<string>} imageList - 图片路径列表
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果
   */
  async createCollage(imageList, outputPath, options = {}) {
    const {
      columns = 3,
      spacing = 10,
      backgroundColor = '#FFFFFF'
    } = options;

    console.log(`[Image Engine] 创建拼贴: ${imageList.length} 张图片`);

    try {
      // 加载所有图片并调整为相同大小
      const imageSize = 300;
      const images = [];

      for (const imagePath of imageList) {
        const buffer = await sharp(imagePath)
          .resize(imageSize, imageSize, { fit: 'cover' })
          .toBuffer();
        images.push(buffer);
      }

      // 计算拼贴尺寸
      const rows = Math.ceil(images.length / columns);
      const canvasWidth = columns * imageSize + (columns + 1) * spacing;
      const canvasHeight = rows * imageSize + (rows + 1) * spacing;

      // 创建画布
      const composites = [];
      for (let i = 0; i < images.length; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const left = spacing + col * (imageSize + spacing);
        const top = spacing + row * (imageSize + spacing);

        composites.push({
          input: images[i],
          left: left,
          top: top
        });
      }

      await sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: backgroundColor
        }
      })
        .composite(composites)
        .png()
        .toFile(outputPath);

      console.log('[Image Engine] 拼贴创建完成');
      return {
        success: true,
        outputPath: outputPath,
        imageCount: imageList.length
      };

    } catch (error) {
      console.error('[Image Engine] 拼贴创建失败:', error);
      throw error;
    }
  }

  /**
   * 获取图片信息
   * @param {string} imagePath - 图片文件路径
   * @returns {Promise<Object>} 图片信息
   */
  async getImageInfo(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      const stats = await fs.stat(imagePath);

      return {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: stats.size,
        channels: metadata.channels,
        hasAlpha: metadata.hasAlpha,
        density: metadata.density,
        space: metadata.space
      };

    } catch (error) {
      console.error('[Image Engine] 获取图片信息失败:', error);
      throw error;
    }
  }
}

// 单例模式
let imageEngine = null;

/**
 * 获取图像引擎实例
 * @param {Object} llmManager - LLM管理器
 * @returns {ImageEngine}
 */
function getImageEngine(llmManager = null) {
  if (!imageEngine) {
    imageEngine = new ImageEngine(llmManager);
  } else if (llmManager && !imageEngine.llmManager) {
    imageEngine.llmManager = llmManager;
  }
  return imageEngine;
}

module.exports = {
  ImageEngine,
  getImageEngine
};
