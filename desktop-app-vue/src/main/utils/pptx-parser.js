/**
 * 自定义 PPTX 解析器
 * 使用 JSZip 和 xml2js 直接解析 PPTX 文件
 */

const { logger, createLogger } = require('./logger.js');
const fs = require('fs').promises;
const JSZip = require('jszip');
const xml2js = require('xml2js');

/**
 * 解析 PPTX 文件
 * @param {string} filePath - PPTX 文件路径
 * @returns {Promise<Array>} 幻灯片数组
 */
async function parsePPTX(filePath) {
  try {
    logger.info('[PPTX Parser] 开始解析:', filePath);

    // 读取文件
    const data = await fs.readFile(filePath);

    // 解压 ZIP
    const zip = await JSZip.loadAsync(data);

    // 获取所有幻灯片文件
    const slideFiles = [];
    zip.folder('ppt/slides').forEach((relativePath, file) => {
      if (relativePath.match(/slide\d+\.xml$/)) {
        slideFiles.push({
          path: relativePath,
          file: file
        });
      }
    });

    // 按幻灯片编号排序
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.path.match(/slide(\d+)\.xml$/)[1]);
      const numB = parseInt(b.path.match(/slide(\d+)\.xml$/)[1]);
      return numA - numB;
    });

    logger.info(`[PPTX Parser] 找到 ${slideFiles.length} 张幻灯片`);

    // 解析每张幻灯片
    const slides = [];
    const parser = new xml2js.Parser();

    for (const { path, file } of slideFiles) {
      try {
        const xmlContent = await file.async('text');
        const result = await parser.parseStringPromise(xmlContent);

        // 提取文本内容
        const texts = extractTexts(result);

        slides.push({
          title: texts[0] || '',
          content: texts.slice(1),
          allTexts: texts
        });
      } catch (err) {
        logger.error(`[PPTX Parser] 解析幻灯片 ${path} 失败:`, err);
        slides.push({
          title: '',
          content: [],
          allTexts: [],
          error: err.message
        });
      }
    }

    logger.info('[PPTX Parser] 解析完成');
    return slides;

  } catch (error) {
    logger.error('[PPTX Parser] 解析失败:', error);
    throw error;
  }
}

/**
 * 从 XML 对象中递归提取所有文本
 * @param {Object} obj - XML 解析后的对象
 * @param {Array} texts - 文本数组（用于递归）
 * @returns {Array} 文本数组
 */
function extractTexts(obj, texts = []) {
  if (!obj) {return texts;}

  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (trimmed) {
      texts.push(trimmed);
    }
    return texts;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => extractTexts(item, texts));
    return texts;
  }

  if (typeof obj === 'object') {
    // 特别处理文本节点 'a:t'
    if (obj['a:t']) {
      const text = Array.isArray(obj['a:t']) ? obj['a:t'].join('') : obj['a:t'];
      const trimmed = String(text).trim();
      if (trimmed) {
        texts.push(trimmed);
      }
    }

    // 递归处理所有属性
    Object.values(obj).forEach(value => {
      if (value && typeof value === 'object') {
        extractTexts(value, texts);
      }
    });
  }

  return texts;
}

module.exports = {
  parsePPTX
};
