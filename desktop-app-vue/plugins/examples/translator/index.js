/**
 * 多语言翻译插件
 * 提供文本翻译和语言检测功能
 */

// 语言映射表
const LANGUAGES = {
  'zh-CN': { name: '简体中文', pattern: /[\u4e00-\u9fa5]/ },
  'en': { name: 'English', pattern: /[a-zA-Z]/ },
  'ja': { name: '日本语', pattern: /[\u3040-\u309F\u30A0-\u30FF]/ },
  'ko': { name: '한국어', pattern: /[\uAC00-\uD7AF]/ },
  'es': { name: 'Español', pattern: /[a-záéíóúñ]/i },
  'fr': { name: 'Français', pattern: /[a-zàâæçéèêëïîôùûüÿœ]/i },
  'de': { name: 'Deutsch', pattern: /[a-zäöüß]/i },
  'ru': { name: 'Русский', pattern: /[а-яё]/i }
};

// 模拟翻译字典（实际应调用翻译API）
const TRANSLATION_DICT = {
  'Hello': { 'zh-CN': '你好', 'ja': 'こんにちは', 'ko': '안녕하세요', 'es': 'Hola' },
  'World': { 'zh-CN': '世界', 'ja': '世界', 'ko': '세계', 'es': 'Mundo' },
  'Thank you': { 'zh-CN': '谢谢', 'ja': 'ありがとう', 'ko': '감사합니다', 'es': 'Gracias' },
  'Good morning': { 'zh-CN': '早上好', 'ja': 'おはよう', 'ko': '좋은 아침', 'es': 'Buenos días' },
  '你好': { 'en': 'Hello', 'ja': 'こんにちは', 'ko': '안녕하세요', 'es': 'Hola' },
  '世界': { 'en': 'World', 'ja': '世界', 'ko': '세계', 'es': 'Mundo' },
  '谢谢': { 'en': 'Thank you', 'ja': 'ありがとう', 'ko': '감사합니다', 'es': 'Gracias' }
};

/**
 * 检测文本语言
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function languageDetect(params) {
  const { text } = params;

  console.log(`[TranslatorPlugin] 检测语言: ${text.substring(0, 50)}...`);

  try {
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: '文本不能为空'
      };
    }

    // 简单的语言检测逻辑（基于字符模式）
    let detectedLang = 'en';
    let maxMatches = 0;

    for (const [langCode, langInfo] of Object.entries(LANGUAGES)) {
      const matches = (text.match(langInfo.pattern) || []).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLang = langCode;
      }
    }

    const confidence = text.length > 0 ? Math.min(maxMatches / text.length, 1) : 0;

    return {
      success: true,
      language: detectedLang,
      languageName: LANGUAGES[detectedLang].name,
      confidence: parseFloat((confidence * 100).toFixed(2))
    };
  } catch (error) {
    console.error('[TranslatorPlugin] 语言检测失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 文本翻译
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function textTranslate(params) {
  const { text, from = 'auto', to = 'zh-CN' } = params;

  console.log(`[TranslatorPlugin] 翻译文本: ${from} -> ${to}`);

  try {
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: '文本不能为空'
      };
    }

    // 如果需要自动检测源语言
    let sourceLang = from;
    if (from === 'auto') {
      const detectResult = await languageDetect({ text });
      if (detectResult.success) {
        sourceLang = detectResult.language;
      } else {
        sourceLang = 'en';
      }
    }

    // 如果源语言和目标语言相同，直接返回
    if (sourceLang === to) {
      return {
        success: true,
        originalText: text,
        translatedText: text,
        sourceLang: sourceLang,
        targetLang: to,
        note: '源语言和目标语言相同，无需翻译'
      };
    }

    // 查找翻译（简化版本，实际应调用API）
    let translatedText = TRANSLATION_DICT[text.trim()]?.[to];

    // 如果没有找到精确翻译，进行简单的模拟处理
    if (!translatedText) {
      translatedText = `[${to}] ${text}`;
    }

    return {
      success: true,
      originalText: text,
      translatedText: translatedText,
      sourceLang: sourceLang,
      targetLang: to
    };
  } catch (error) {
    console.error('[TranslatorPlugin] 翻译失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 批量翻译
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function batchTranslate(params) {
  const { texts, from = 'auto', to = 'zh-CN' } = params;

  console.log(`[TranslatorPlugin] 批量翻译: ${texts.length} 条文本`);

  try {
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return {
        success: false,
        error: '文本数组不能为空'
      };
    }

    const results = [];

    for (const text of texts) {
      const result = await textTranslate({ text, from, to });

      if (result.success) {
        results.push({
          original: result.originalText,
          translated: result.translatedText,
          sourceLang: result.sourceLang
        });
      } else {
        results.push({
          original: text,
          translated: null,
          error: result.error
        });
      }
    }

    const successCount = results.filter(r => r.translated !== null).length;

    return {
      success: true,
      results: results,
      totalCount: texts.length,
      successCount: successCount,
      failureCount: texts.length - successCount
    };
  } catch (error) {
    console.error('[TranslatorPlugin] 批量翻译失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 插件激活钩子
 */
async function activate(context) {
  console.log('[TranslatorPlugin] 插件已激活');

  // 注册工具处理函数
  context.registerTool('text_translate', textTranslate);
  context.registerTool('language_detect', languageDetect);
  context.registerTool('batch_translate', batchTranslate);

  const config = context.getConfig();
  console.log('[TranslatorPlugin] 配置:', config);
}

/**
 * 插件停用钩子
 */
async function deactivate(context) {
  console.log('[TranslatorPlugin] 插件已停用');
}

module.exports = {
  activate,
  deactivate
};
