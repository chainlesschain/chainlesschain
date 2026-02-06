/**
 * XSS Sanitizer
 *
 * XSS防护工具 - 主进程端
 * - HTML内容清理
 * - Markdown内容清理
 * - URL验证
 * - 脚本注入检测
 */

/**
 * 危险的HTML标签
 */
const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'link',
  'style',
  'meta',
  'base',
  'form',
];

/**
 * 危险的HTML属性
 */
const DANGEROUS_ATTRS = [
  'onload',
  'onerror',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onkeydown',
  'onkeyup',
  'onfocus',
  'onblur',
  'onchange',
  'onsubmit',
];

/**
 * 允许的URL协议
 */
const ALLOWED_PROTOCOLS = [
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'data:image/',  // 只允许图片的data URI
];

class XSSSanitizer {
  /**
   * 清理HTML内容
   * @param {string} html - HTML内容
   * @param {Object} options - 选项
   * @returns {string} 清理后的HTML
   */
  static sanitizeHTML(html, options = {}) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    let cleaned = html;

    // 1. 移除危险标签
    if (!options.allowDangerousTags) {
      DANGEROUS_TAGS.forEach(tag => {
        const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
        cleaned = cleaned.replace(regex, '');

        // 移除自闭合标签
        const selfClosingRegex = new RegExp(`<${tag}[^>]*/>`, 'gi');
        cleaned = cleaned.replace(selfClosingRegex, '');
      });
    }

    // 2. 移除危险属性
    DANGEROUS_ATTRS.forEach(attr => {
      const regex = new RegExp(`\\s${attr}\\s*=\\s*["'][^"']*["']`, 'gi');
      cleaned = cleaned.replace(regex, '');
    });

    // 3. 清理javascript:协议的链接
    cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
    cleaned = cleaned.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, '');

    // 4. 清理data URI (除了图片)
    cleaned = cleaned.replace(/src\s*=\s*["']data:(?!image\/)[^"']*["']/gi, '');

    // 5. 移除HTML注释中的脚本
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, (match) => {
      if (/<script/i.test(match)) {
        return '';
      }
      return match;
    });

    // 6. 编码特殊字符
    if (options.encodeSpecialChars) {
      cleaned = this.encodeHTMLEntities(cleaned);
    }

    return cleaned;
  }

  /**
   * 清理Markdown内容
   * @param {string} markdown - Markdown内容
   * @returns {string} 清理后的Markdown
   */
  static sanitizeMarkdown(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return '';
    }

    let cleaned = markdown;

    // 1. 移除内联HTML脚本
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

    // 2. 清理危险的HTML标签
    DANGEROUS_TAGS.forEach(tag => {
      const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
      cleaned = cleaned.replace(regex, '');
    });

    // 3. 清理图片链接中的javascript:协议
    cleaned = cleaned.replace(/!\[([^\]]*)\]\(javascript:[^)]*\)/g, '![$1](#)');

    // 4. 清理普通链接中的javascript:协议
    cleaned = cleaned.replace(/\[([^\]]*)\]\(javascript:[^)]*\)/g, '[$1](#)');

    // 5. 移除危险的data URI
    cleaned = cleaned.replace(/!\[([^\]]*)\]\(data:(?!image\/)[^)]*\)/g, '![$1](#)');

    return cleaned;
  }

  /**
   * 验证URL安全性
   * @param {string} url - URL地址
   * @returns {Object} 验证结果
   */
  static validateURL(url) {
    const result = {
      valid: false,
      url: url,
      protocol: null,
      errors: [],
    };

    if (!url || typeof url !== 'string') {
      result.errors.push('Invalid URL');
      return result;
    }

    try {
      // 检查是否是相对URL
      if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
        result.valid = true;
        result.protocol = 'relative';
        return result;
      }

      // 检查是否包含危险协议
      if (url.toLowerCase().startsWith('javascript:')) {
        result.errors.push('javascript: protocol not allowed');
        return result;
      }

      if (url.toLowerCase().startsWith('data:')) {
        // 只允许图片的data URI
        if (!url.toLowerCase().startsWith('data:image/')) {
          result.errors.push('data: protocol only allowed for images');
          return result;
        }
        result.valid = true;
        result.protocol = 'data';
        return result;
      }

      // 解析URL
      const urlObj = new URL(url);
      result.protocol = urlObj.protocol;

      // 检查协议是否在白名单中
      const isAllowed = ALLOWED_PROTOCOLS.some(proto => {
        if (proto.endsWith('/')) {
          return urlObj.protocol.startsWith(proto.slice(0, -1));
        }
        return urlObj.protocol === proto;
      });

      if (!isAllowed) {
        result.errors.push(`Protocol ${urlObj.protocol} not allowed`);
        return result;
      }

      result.valid = true;
      return result;

    } catch (error) {
      result.errors.push(`URL parsing error: ${error.message}`);
      return result;
    }
  }

  /**
   * 检测XSS攻击模式
   * @param {string} content - 内容
   * @returns {Array} 检测到的威胁
   */
  static detectXSS(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const threats = [];

    // XSS检测模式
    const patterns = [
      {
        name: 'Script Tag',
        regex: /<script[\s\S]*?<\/script>/gi,
        severity: 'high',
      },
      {
        name: 'Inline JavaScript',
        regex: /on\w+\s*=\s*["'][^"']*["']/gi,
        severity: 'high',
      },
      {
        name: 'JavaScript Protocol',
        regex: /javascript:/gi,
        severity: 'high',
      },
      {
        name: 'Data URI Script',
        regex: /data:text\/html/gi,
        severity: 'medium',
      },
      {
        name: 'Iframe Injection',
        regex: /<iframe[\s\S]*?>/gi,
        severity: 'medium',
      },
      {
        name: 'Object/Embed Tag',
        regex: /<(object|embed)[\s\S]*?>/gi,
        severity: 'medium',
      },
      {
        name: 'Style with Expression',
        regex: /style\s*=\s*["'][^"']*expression\s*\(/gi,
        severity: 'high',
      },
      {
        name: 'Import Statement',
        regex: /@import/gi,
        severity: 'low',
      },
    ];

    patterns.forEach(pattern => {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        threats.push({
          name: pattern.name,
          severity: pattern.severity,
          count: matches.length,
          samples: matches.slice(0, 3), // 只返回前3个示例
        });
      }
    });

    return threats;
  }

  /**
   * 编码HTML实体
   * @param {string} str - 字符串
   * @returns {string} 编码后的字符串
   */
  static encodeHTMLEntities(str) {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
    };

    return String(str).replace(/[&<>"'/]/g, (char) => entityMap[char]);
  }

  /**
   * 解码HTML实体
   * @param {string} str - 字符串
   * @returns {string} 解码后的字符串
   */
  static decodeHTMLEntities(str) {
    const entityMap = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&#x2F;': '/',
    };

    return String(str).replace(/&(?:amp|lt|gt|quot|#39|#x2F);/g, (entity) => entityMap[entity] || entity);
  }

  /**
   * 清理JSON内容中的XSS
   * @param {Object} obj - JSON对象
   * @returns {Object} 清理后的对象
   */
  static sanitizeJSON(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeJSON(item));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // 检查字符串是否包含HTML内容
        if (/<[^>]+>/.test(value)) {
          cleaned[key] = this.sanitizeHTML(value);
        } else {
          cleaned[key] = value;
        }
      } else if (typeof value === 'object') {
        cleaned[key] = this.sanitizeJSON(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  /**
   * 清理用户输入
   * @param {string} input - 用户输入
   * @param {Object} options - 选项
   * @returns {string} 清理后的输入
   */
  static sanitizeUserInput(input, options = {}) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    let cleaned = input;

    // 1. 移除前后空白
    cleaned = cleaned.trim();

    // 2. 限制长度
    if (options.maxLength) {
      cleaned = cleaned.slice(0, options.maxLength);
    }

    // 3. 移除控制字符
    cleaned = [...cleaned]
      .filter((char) => {
        const code = char.charCodeAt(0);
        return !(code <= 31 || code === 127);
      })
      .join('');

    // 4. 编码HTML实体
    if (options.encodeHTML) {
      cleaned = this.encodeHTMLEntities(cleaned);
    }

    // 5. 移除SQL注入模式
    if (options.preventSQLInjection) {
      cleaned = cleaned.replace(/['";]/g, '');
    }

    // 6. 移除路径遍历
    if (options.preventPathTraversal) {
      cleaned = cleaned.replace(/\.\./g, '');
    }

    return cleaned;
  }

  /**
   * 生成内容安全策略 (CSP) 头
   * @returns {string} CSP字符串
   */
  static generateCSP() {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*",
      "media-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }
}

module.exports = XSSSanitizer;
