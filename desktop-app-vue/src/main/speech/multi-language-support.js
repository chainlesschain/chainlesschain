/**
 * 多语言语音识别支持
 *
 * 支持多种语言的语音识别和自动语言检测
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");

/**
 * 支持的语言配置
 */
const SUPPORTED_LANGUAGES = {
  // 中文
  "zh-CN": {
    name: "简体中文",
    nativeName: "简体中文",
    whisperCode: "zh",
    webSpeechCode: "zh-CN",
    commonPhrases: ["你好", "谢谢", "再见", "请问", "什么"],
    confidence: 0.85,
  },
  "zh-TW": {
    name: "繁体中文",
    nativeName: "繁體中文",
    whisperCode: "zh",
    webSpeechCode: "zh-TW",
    commonPhrases: ["你好", "謝謝", "再見", "請問", "什麼"],
    confidence: 0.85,
  },

  // 英语
  "en-US": {
    name: "English (US)",
    nativeName: "English (US)",
    whisperCode: "en",
    webSpeechCode: "en-US",
    commonPhrases: ["hello", "thank", "please", "what", "how"],
    confidence: 0.9,
  },
  "en-GB": {
    name: "English (UK)",
    nativeName: "English (UK)",
    whisperCode: "en",
    webSpeechCode: "en-GB",
    commonPhrases: ["hello", "thank", "please", "what", "how"],
    confidence: 0.9,
  },

  // 日语
  "ja-JP": {
    name: "Japanese",
    nativeName: "日本語",
    whisperCode: "ja",
    webSpeechCode: "ja-JP",
    commonPhrases: ["こんにちは", "ありがとう", "さようなら", "何", "どう"],
    confidence: 0.85,
  },

  // 韩语
  "ko-KR": {
    name: "Korean",
    nativeName: "한국어",
    whisperCode: "ko",
    webSpeechCode: "ko-KR",
    commonPhrases: ["안녕하세요", "감사합니다", "안녕히", "무엇", "어떻게"],
    confidence: 0.85,
  },

  // 法语
  "fr-FR": {
    name: "French",
    nativeName: "Français",
    whisperCode: "fr",
    webSpeechCode: "fr-FR",
    commonPhrases: ["bonjour", "merci", "au revoir", "quoi", "comment"],
    confidence: 0.85,
  },

  // 德语
  "de-DE": {
    name: "German",
    nativeName: "Deutsch",
    whisperCode: "de",
    webSpeechCode: "de-DE",
    commonPhrases: ["hallo", "danke", "auf wiedersehen", "was", "wie"],
    confidence: 0.85,
  },

  // 西班牙语
  "es-ES": {
    name: "Spanish",
    nativeName: "Español",
    whisperCode: "es",
    webSpeechCode: "es-ES",
    commonPhrases: ["hola", "gracias", "adiós", "qué", "cómo"],
    confidence: 0.85,
  },

  // 俄语
  "ru-RU": {
    name: "Russian",
    nativeName: "Русский",
    whisperCode: "ru",
    webSpeechCode: "ru-RU",
    commonPhrases: ["привет", "спасибо", "до свидания", "что", "как"],
    confidence: 0.85,
  },

  // 阿拉伯语
  "ar-SA": {
    name: "Arabic",
    nativeName: "العربية",
    whisperCode: "ar",
    webSpeechCode: "ar-SA",
    commonPhrases: ["مرحبا", "شكرا", "وداعا", "ماذا", "كيف"],
    confidence: 0.8,
    rtl: true, // 从右到左书写
  },

  // 葡萄牙语
  "pt-BR": {
    name: "Portuguese (Brazil)",
    nativeName: "Português (Brasil)",
    whisperCode: "pt",
    webSpeechCode: "pt-BR",
    commonPhrases: ["olá", "obrigado", "tchau", "o que", "como"],
    confidence: 0.85,
  },

  // 意大利语
  "it-IT": {
    name: "Italian",
    nativeName: "Italiano",
    whisperCode: "it",
    webSpeechCode: "it-IT",
    commonPhrases: ["ciao", "grazie", "arrivederci", "cosa", "come"],
    confidence: 0.85,
  },

  // 印地语
  "hi-IN": {
    name: "Hindi",
    nativeName: "हिन्दी",
    whisperCode: "hi",
    webSpeechCode: "hi-IN",
    commonPhrases: ["नमस्ते", "धन्यवाद", "अलविदा", "क्या", "कैसे"],
    confidence: 0.8,
  },

  // 泰语
  "th-TH": {
    name: "Thai",
    nativeName: "ไทย",
    whisperCode: "th",
    webSpeechCode: "th-TH",
    commonPhrases: ["สวัสดี", "ขอบคุณ", "ลาก่อน", "อะไร", "อย่างไร"],
    confidence: 0.8,
  },

  // 越南语
  "vi-VN": {
    name: "Vietnamese",
    nativeName: "Tiếng Việt",
    whisperCode: "vi",
    webSpeechCode: "vi-VN",
    commonPhrases: ["xin chào", "cảm ơn", "tạm biệt", "gì", "như thế nào"],
    confidence: 0.8,
  },

  // 印尼语
  "id-ID": {
    name: "Indonesian",
    nativeName: "Bahasa Indonesia",
    whisperCode: "id",
    webSpeechCode: "id-ID",
    commonPhrases: [
      "halo",
      "terima kasih",
      "selamat tinggal",
      "apa",
      "bagaimana",
    ],
    confidence: 0.85,
  },

  // 马来语
  "ms-MY": {
    name: "Malay",
    nativeName: "Bahasa Melayu",
    whisperCode: "ms",
    webSpeechCode: "ms-MY",
    commonPhrases: [
      "hello",
      "terima kasih",
      "selamat tinggal",
      "apa",
      "bagaimana",
    ],
    confidence: 0.85,
  },

  // 土耳其语
  "tr-TR": {
    name: "Turkish",
    nativeName: "Türkçe",
    whisperCode: "tr",
    webSpeechCode: "tr-TR",
    commonPhrases: ["merhaba", "teşekkür ederim", "güle güle", "ne", "nasıl"],
    confidence: 0.85,
  },

  // 波兰语
  "pl-PL": {
    name: "Polish",
    nativeName: "Polski",
    whisperCode: "pl",
    webSpeechCode: "pl-PL",
    commonPhrases: ["cześć", "dziękuję", "do widzenia", "co", "jak"],
    confidence: 0.85,
  },

  // 荷兰语
  "nl-NL": {
    name: "Dutch",
    nativeName: "Nederlands",
    whisperCode: "nl",
    webSpeechCode: "nl-NL",
    commonPhrases: ["hallo", "dank je", "tot ziens", "wat", "hoe"],
    confidence: 0.85,
  },

  // 瑞典语
  "sv-SE": {
    name: "Swedish",
    nativeName: "Svenska",
    whisperCode: "sv",
    webSpeechCode: "sv-SE",
    commonPhrases: ["hej", "tack", "hej då", "vad", "hur"],
    confidence: 0.85,
  },

  // 挪威语
  "no-NO": {
    name: "Norwegian",
    nativeName: "Norsk",
    whisperCode: "no",
    webSpeechCode: "no-NO",
    commonPhrases: ["hei", "takk", "ha det", "hva", "hvordan"],
    confidence: 0.85,
  },

  // 丹麦语
  "da-DK": {
    name: "Danish",
    nativeName: "Dansk",
    whisperCode: "da",
    webSpeechCode: "da-DK",
    commonPhrases: ["hej", "tak", "farvel", "hvad", "hvordan"],
    confidence: 0.85,
  },

  // 芬兰语
  "fi-FI": {
    name: "Finnish",
    nativeName: "Suomi",
    whisperCode: "fi",
    webSpeechCode: "fi-FI",
    commonPhrases: ["hei", "kiitos", "näkemiin", "mitä", "miten"],
    confidence: 0.85,
  },

  // 希腊语
  "el-GR": {
    name: "Greek",
    nativeName: "Ελληνικά",
    whisperCode: "el",
    webSpeechCode: "el-GR",
    commonPhrases: ["γεια", "ευχαριστώ", "αντίο", "τι", "πώς"],
    confidence: 0.85,
  },

  // 捷克语
  "cs-CZ": {
    name: "Czech",
    nativeName: "Čeština",
    whisperCode: "cs",
    webSpeechCode: "cs-CZ",
    commonPhrases: ["ahoj", "děkuji", "sbohem", "co", "jak"],
    confidence: 0.85,
  },

  // 匈牙利语
  "hu-HU": {
    name: "Hungarian",
    nativeName: "Magyar",
    whisperCode: "hu",
    webSpeechCode: "hu-HU",
    commonPhrases: ["szia", "köszönöm", "viszlát", "mi", "hogyan"],
    confidence: 0.85,
  },

  // 罗马尼亚语
  "ro-RO": {
    name: "Romanian",
    nativeName: "Română",
    whisperCode: "ro",
    webSpeechCode: "ro-RO",
    commonPhrases: ["salut", "mulțumesc", "la revedere", "ce", "cum"],
    confidence: 0.85,
  },

  // 乌克兰语
  "uk-UA": {
    name: "Ukrainian",
    nativeName: "Українська",
    whisperCode: "uk",
    webSpeechCode: "uk-UA",
    commonPhrases: ["привіт", "дякую", "до побачення", "що", "як"],
    confidence: 0.85,
  },

  // 希伯来语
  "he-IL": {
    name: "Hebrew",
    nativeName: "עברית",
    whisperCode: "he",
    webSpeechCode: "he-IL",
    commonPhrases: ["שלום", "תודה", "להתראות", "מה", "איך"],
    confidence: 0.8,
    rtl: true, // 从右到左书写
  },

  // 波斯语
  "fa-IR": {
    name: "Persian",
    nativeName: "فارسی",
    whisperCode: "fa",
    webSpeechCode: "fa-IR",
    commonPhrases: ["سلام", "متشکرم", "خداحافظ", "چه", "چگونه"],
    confidence: 0.8,
    rtl: true, // 从右到左书写
  },

  // 孟加拉语
  "bn-BD": {
    name: "Bengali",
    nativeName: "বাংলা",
    whisperCode: "bn",
    webSpeechCode: "bn-BD",
    commonPhrases: ["হ্যালো", "ধন্যবাদ", "বিদায়", "কি", "কিভাবে"],
    confidence: 0.8,
  },

  // 泰米尔语
  "ta-IN": {
    name: "Tamil",
    nativeName: "தமிழ்",
    whisperCode: "ta",
    webSpeechCode: "ta-IN",
    commonPhrases: ["வணக்கம்", "நன்றி", "பிரியாவிடை", "என்ன", "எப்படி"],
    confidence: 0.8,
  },

  // 泰卢固语
  "te-IN": {
    name: "Telugu",
    nativeName: "తెలుగు",
    whisperCode: "te",
    webSpeechCode: "te-IN",
    commonPhrases: ["హలో", "ధన్యవాదాలు", "వీడ్కోలు", "ఏమిటి", "ఎలా"],
    confidence: 0.8,
  },

  // 乌尔都语
  "ur-PK": {
    name: "Urdu",
    nativeName: "اردو",
    whisperCode: "ur",
    webSpeechCode: "ur-PK",
    commonPhrases: ["ہیلو", "شکریہ", "الوداع", "کیا", "کیسے"],
    confidence: 0.8,
    rtl: true, // 从右到左书写
  },
};

/**
 * 多语言支持类
 */
class MultiLanguageSupport extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      autoDetect: config.autoDetect !== false,
      defaultLanguage: config.defaultLanguage || "zh-CN",
      fallbackLanguage: config.fallbackLanguage || "en-US",
      detectionConfidence: config.detectionConfidence || 0.7,
      ...config,
    };

    // 当前语言
    this.currentLanguage = this.config.defaultLanguage;

    // 语言检测历史
    this.detectionHistory = [];
    this.maxHistorySize = 10;
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages() {
    return Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => ({
      code,
      ...info,
    }));
  }

  /**
   * 获取语言信息
   */
  getLanguageInfo(languageCode) {
    return SUPPORTED_LANGUAGES[languageCode] || null;
  }

  /**
   * 检查语言是否支持
   */
  isLanguageSupported(languageCode) {
    return languageCode in SUPPORTED_LANGUAGES;
  }

  /**
   * 设置当前语言
   */
  setCurrentLanguage(languageCode) {
    if (!this.isLanguageSupported(languageCode)) {
      logger.warn(`[MultiLanguage] 不支持的语言: ${languageCode}`);
      return false;
    }

    this.currentLanguage = languageCode;
    this.emit("languageChanged", languageCode);
    logger.info(`[MultiLanguage] 切换语言: ${languageCode}`);
    return true;
  }

  /**
   * 获取当前语言
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * 获取当前语言的 Whisper 代码
   */
  getWhisperLanguageCode(languageCode = null) {
    const lang = languageCode || this.currentLanguage;
    const info = SUPPORTED_LANGUAGES[lang];
    return info ? info.whisperCode : "en";
  }

  /**
   * 获取当前语言的 Web Speech API 代码
   */
  getWebSpeechLanguageCode(languageCode = null) {
    const lang = languageCode || this.currentLanguage;
    const info = SUPPORTED_LANGUAGES[lang];
    return info ? info.webSpeechCode : "en-US";
  }

  /**
   * 自动检测语言
   * @param {string} text - 要检测的文本
   * @returns {Object} 检测结果 { language, confidence, alternatives }
   */
  detectLanguage(text) {
    if (!text || typeof text !== "string") {
      return {
        language: this.config.defaultLanguage,
        confidence: 0,
        alternatives: [],
      };
    }

    const scores = [];

    // 对每种语言计算匹配分数
    for (const [code, info] of Object.entries(SUPPORTED_LANGUAGES)) {
      const score = this.calculateLanguageScore(text, info);
      scores.push({
        language: code,
        confidence: score,
        info: info,
      });
    }

    // 按置信度排序
    scores.sort((a, b) => b.confidence - a.confidence);

    const result = {
      language: scores[0].language,
      confidence: scores[0].confidence,
      alternatives: scores.slice(1, 4).map((s) => ({
        language: s.language,
        confidence: s.confidence,
      })),
    };

    // 记录检测历史
    this.addToHistory(result);

    // 如果置信度足够高，自动切换语言
    if (
      this.config.autoDetect &&
      result.confidence >= this.config.detectionConfidence
    ) {
      if (result.language !== this.currentLanguage) {
        logger.info(
          `[MultiLanguage] 自动检测到语言: ${result.language} (置信度: ${result.confidence.toFixed(2)})`,
        );
        this.setCurrentLanguage(result.language);
      }
    }

    return result;
  }

  /**
   * 计算文本与语言的匹配分数
   */
  calculateLanguageScore(text, languageInfo) {
    let score = 0;
    const normalizedText = text.toLowerCase();

    // 1. 检查常用短语匹配
    let phraseMatches = 0;
    for (const phrase of languageInfo.commonPhrases) {
      if (normalizedText.includes(phrase.toLowerCase())) {
        phraseMatches++;
      }
    }
    score += (phraseMatches / languageInfo.commonPhrases.length) * 0.4;

    // 2. 检查字符集特征
    const charsetScore = this.detectCharset(text, languageInfo);
    score += charsetScore * 0.4;

    // 3. 使用历史检测结果
    const historyScore = this.getHistoryScore(languageInfo);
    score += historyScore * 0.2;

    // 应用语言基础置信度
    score *= languageInfo.confidence;

    return Math.min(score, 1.0);
  }

  /**
   * 检测字符集特征
   */
  detectCharset(text, languageInfo) {
    const code = Object.keys(SUPPORTED_LANGUAGES).find(
      (key) => SUPPORTED_LANGUAGES[key] === languageInfo,
    );

    // 中文字符检测
    if (code.startsWith("zh")) {
      const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
      return chineseChars
        ? Math.min(chineseChars.length / text.length, 1.0)
        : 0;
    }

    // 日文字符检测（平假名、片假名、汉字）
    if (code === "ja-JP") {
      const japaneseChars = text.match(
        /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5]/g,
      );
      return japaneseChars
        ? Math.min(japaneseChars.length / text.length, 1.0)
        : 0;
    }

    // 韩文字符检测
    if (code === "ko-KR") {
      const koreanChars = text.match(/[\uac00-\ud7af]/g);
      return koreanChars ? Math.min(koreanChars.length / text.length, 1.0) : 0;
    }

    // 阿拉伯字符检测
    if (code === "ar-SA") {
      const arabicChars = text.match(/[\u0600-\u06ff]/g);
      return arabicChars ? Math.min(arabicChars.length / text.length, 1.0) : 0;
    }

    // 泰文字符检测
    if (code === "th-TH") {
      const thaiChars = text.match(/[\u0e00-\u0e7f]/g);
      return thaiChars ? Math.min(thaiChars.length / text.length, 1.0) : 0;
    }

    // 西里尔字符检测（俄语、乌克兰语）
    if (code === "ru-RU" || code === "uk-UA") {
      const cyrillicChars = text.match(/[\u0400-\u04ff]/g);
      return cyrillicChars
        ? Math.min(cyrillicChars.length / text.length, 1.0)
        : 0;
    }

    // 希伯来字符检测
    if (code === "he-IL") {
      const hebrewChars = text.match(/[\u0590-\u05ff]/g);
      return hebrewChars ? Math.min(hebrewChars.length / text.length, 1.0) : 0;
    }

    // 波斯/乌尔都字符检测
    if (code === "fa-IR" || code === "ur-PK") {
      const persianChars = text.match(/[\u0600-\u06ff\u0750-\u077f]/g);
      return persianChars
        ? Math.min(persianChars.length / text.length, 1.0)
        : 0;
    }

    // 孟加拉字符检测
    if (code === "bn-BD") {
      const bengaliChars = text.match(/[\u0980-\u09ff]/g);
      return bengaliChars
        ? Math.min(bengaliChars.length / text.length, 1.0)
        : 0;
    }

    // 泰米尔字符检测
    if (code === "ta-IN") {
      const tamilChars = text.match(/[\u0b80-\u0bff]/g);
      return tamilChars ? Math.min(tamilChars.length / text.length, 1.0) : 0;
    }

    // 泰卢固字符检测
    if (code === "te-IN") {
      const teluguChars = text.match(/[\u0c00-\u0c7f]/g);
      return teluguChars ? Math.min(teluguChars.length / text.length, 1.0) : 0;
    }

    // 希腊字符检测
    if (code === "el-GR") {
      const greekChars = text.match(/[\u0370-\u03ff]/g);
      return greekChars ? Math.min(greekChars.length / text.length, 1.0) : 0;
    }

    // 拉丁字符检测（英语、法语、德语等）
    const latinChars = text.match(/[a-zA-Z]/g);
    return latinChars ? Math.min(latinChars.length / text.length, 1.0) : 0;
  }

  /**
   * 从历史记录获取分数
   */
  getHistoryScore(languageInfo) {
    if (this.detectionHistory.length === 0) {
      return 0;
    }

    const code = Object.keys(SUPPORTED_LANGUAGES).find(
      (key) => SUPPORTED_LANGUAGES[key] === languageInfo,
    );

    // 计算该语言在历史中的出现频率
    const occurrences = this.detectionHistory.filter(
      (h) => h.language === code,
    ).length;
    return occurrences / this.detectionHistory.length;
  }

  /**
   * 添加到检测历史
   */
  addToHistory(result) {
    this.detectionHistory.push(result);

    // 限制历史大小
    if (this.detectionHistory.length > this.maxHistorySize) {
      this.detectionHistory.shift();
    }
  }

  /**
   * 清除检测历史
   */
  clearHistory() {
    this.detectionHistory = [];
  }

  /**
   * 获取语言统计
   */
  getLanguageStats() {
    const stats = {};

    for (const code of Object.keys(SUPPORTED_LANGUAGES)) {
      stats[code] = 0;
    }

    for (const record of this.detectionHistory) {
      if (record.language in stats) {
        stats[record.language]++;
      }
    }

    return stats;
  }

  /**
   * 获取推荐语言
   * 基于历史使用情况
   */
  getRecommendedLanguages(limit = 3) {
    const stats = this.getLanguageStats();

    return Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([code, count]) => ({
        code,
        count,
        info: SUPPORTED_LANGUAGES[code],
      }));
  }

  /**
   * 翻译系统消息
   * @param {string} key - 消息键
   * @param {string} languageCode - 目标语言
   */
  translateSystemMessage(key, languageCode = null) {
    const lang = languageCode || this.currentLanguage;

    const messages = {
      recording: {
        "zh-CN": "正在录音...",
        "en-US": "Recording...",
        "ja-JP": "録音中...",
        "ko-KR": "녹음 중...",
        "fr-FR": "Enregistrement...",
        "de-DE": "Aufnahme...",
        "es-ES": "Grabando...",
        "ru-RU": "Запись...",
        "ar-SA": "تسجيل...",
        "pt-BR": "Gravando...",
        "it-IT": "Registrazione...",
        "hi-IN": "रिकॉर्डिंग...",
        "th-TH": "กำลังบันทึก...",
        "vi-VN": "Đang ghi âm...",
        "id-ID": "Merekam...",
        "ms-MY": "Merakam...",
        "tr-TR": "Kaydediliyor...",
        "pl-PL": "Nagrywanie...",
        "nl-NL": "Opnemen...",
        "sv-SE": "Spelar in...",
        "no-NO": "Tar opp...",
        "da-DK": "Optager...",
        "fi-FI": "Nauhoitetaan...",
        "el-GR": "Εγγραφή...",
        "cs-CZ": "Nahrávání...",
        "hu-HU": "Felvétel...",
        "ro-RO": "Înregistrare...",
        "uk-UA": "Запис...",
        "he-IL": "מקליט...",
        "fa-IR": "ضبط...",
        "bn-BD": "রেকর্ডিং...",
        "ta-IN": "பதிவு செய்கிறது...",
        "te-IN": "రికార్డింగ్...",
        "ur-PK": "ریکارڈنگ...",
      },
      processing: {
        "zh-CN": "正在处理...",
        "en-US": "Processing...",
        "ja-JP": "処理中...",
        "ko-KR": "처리 중...",
        "fr-FR": "Traitement...",
        "de-DE": "Verarbeitung...",
        "es-ES": "Procesando...",
        "ru-RU": "Обработка...",
        "ar-SA": "معالجة...",
        "pt-BR": "Processando...",
        "it-IT": "Elaborazione...",
        "hi-IN": "प्रसंस्करण...",
        "th-TH": "กำลังประมวลผล...",
        "vi-VN": "Đang xử lý...",
        "id-ID": "Memproses...",
        "ms-MY": "Memproses...",
        "tr-TR": "İşleniyor...",
        "pl-PL": "Przetwarzanie...",
        "nl-NL": "Verwerken...",
        "sv-SE": "Bearbetar...",
        "no-NO": "Behandler...",
        "da-DK": "Behandler...",
        "fi-FI": "Käsitellään...",
        "el-GR": "Επεξεργασία...",
        "cs-CZ": "Zpracování...",
        "hu-HU": "Feldolgozás...",
        "ro-RO": "Procesare...",
        "uk-UA": "Обробка...",
        "he-IL": "מעבד...",
        "fa-IR": "پردازش...",
        "bn-BD": "প্রক্রিয়াকরণ...",
        "ta-IN": "செயலாக்கம்...",
        "te-IN": "ప్రాసెసింగ్...",
        "ur-PK": "پروسیسنگ...",
      },
      completed: {
        "zh-CN": "完成",
        "en-US": "Completed",
        "ja-JP": "完了",
        "ko-KR": "완료",
        "fr-FR": "Terminé",
        "de-DE": "Abgeschlossen",
        "es-ES": "Completado",
        "ru-RU": "Завершено",
        "ar-SA": "مكتمل",
        "pt-BR": "Concluído",
        "it-IT": "Completato",
        "hi-IN": "पूर्ण",
        "th-TH": "เสร็จสิ้น",
        "vi-VN": "Hoàn thành",
        "id-ID": "Selesai",
        "ms-MY": "Selesai",
        "tr-TR": "Tamamlandı",
        "pl-PL": "Ukończono",
        "nl-NL": "Voltooid",
        "sv-SE": "Slutförd",
        "no-NO": "Fullført",
        "da-DK": "Fuldført",
        "fi-FI": "Valmis",
        "el-GR": "Ολοκληρώθηκε",
        "cs-CZ": "Dokončeno",
        "hu-HU": "Befejezve",
        "ro-RO": "Finalizat",
        "uk-UA": "Завершено",
        "he-IL": "הושלם",
        "fa-IR": "تکمیل شد",
        "bn-BD": "সম্পন্ন",
        "ta-IN": "முடிந்தது",
        "te-IN": "పూర్తయింది",
        "ur-PK": "مکمل",
      },
    };

    return messages[key]?.[lang] || messages[key]?.["en-US"] || key;
  }
}

module.exports = MultiLanguageSupport;
