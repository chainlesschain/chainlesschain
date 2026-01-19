/**
 * 扩展工具实现
 * 包含所有新增工具的处理函数
 *
 * 这些工具需要在 FunctionCaller 中注册才能使用
 */

const { logger, createLogger } = require('../utils/logger.js');
const crypto = require('crypto');
const { URL } = require('url');

class ExtendedTools {
  /**
   * 注册所有扩展工具到 FunctionCaller
   * @param {FunctionCaller} functionCaller - FunctionCaller 实例
   */
  static registerAll(functionCaller) {
    // 1. JSON解析器
    functionCaller.registerTool(
      'json_parser',
      async (params) => {
        try {
          const { json, action, indent = 2 } = params;

          switch (action) {
            case 'parse':
              const parsed = JSON.parse(json);
              return { success: true, result: parsed };

            case 'validate':
              try {
                JSON.parse(json);
                return { success: true, result: true, error: null };
              } catch (e) {
                return { success: false, result: false, error: e.message };
              }

            case 'format':
              const obj = JSON.parse(json);
              const formatted = JSON.stringify(obj, null, indent);
              return { success: true, result: formatted };

            case 'minify':
              const minObj = JSON.parse(json);
              const minified = JSON.stringify(minObj);
              return { success: true, result: minified };

            default:
              throw new Error(`未知的操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'json_parser',
        description: 'JSON解析和格式化',
        parameters: {
          json: { type: 'string', description: 'JSON字符串' },
          action: { type: 'string', description: '操作类型' },
          indent: { type: 'number', description: '缩进空格数' }
        }
      }
    );

    // 2. YAML解析器（简化实现，实际需要yaml库）
    functionCaller.registerTool(
      'yaml_parser',
      async (params) => {
        try {
          const { content, action } = params;

          // 注意: 这是简化实现，生产环境应使用 js-yaml 库
          if (action === 'parse') {
            // 简单的YAML到JSON转换（仅支持基础格式）
            const lines = content.split('\n');
            const result = {};

            for (const line of lines) {
              if (line.trim() && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length > 0) {
                  const value = valueParts.join(':').trim();
                  result[key.trim()] = isNaN(value) ? value : Number(value);
                }
              }
            }

            return { success: true, result };
          } else if (action === 'stringify') {
            const obj = JSON.parse(content);
            const yaml = Object.entries(obj)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n');
            return { success: true, result: yaml };
          }

          throw new Error(`未知的操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'yaml_parser',
        description: 'YAML解析和生成',
        parameters: {
          content: { type: 'string', description: 'YAML或JSON内容' },
          action: { type: 'string', description: '操作类型' }
        }
      }
    );

    // 3. 文本分析器
    functionCaller.registerTool(
      'text_analyzer',
      async (params) => {
        try {
          const { text, options = {} } = params;

          // 统计基本信息
          const charCount = text.length;
          const lineCount = text.split('\n').length;

          // 中英文分词
          const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
          const englishWords = text.match(/[a-zA-Z]+/g) || [];
          const wordCount = chineseChars.length + englishWords.length;

          // 句子数（简单统计）
          const sentenceCount = (text.match(/[。！？.!?]/g) || []).length;

          const stats = {
            charCount,
            wordCount,
            sentenceCount,
            lineCount
          };

          const result = { success: true, stats };

          // 词频统计
          if (options.wordFrequency) {
            const allWords = [...chineseChars, ...englishWords];
            const frequency = {};
            allWords.forEach(word => {
              frequency[word] = (frequency[word] || 0) + 1;
            });
            result.wordFrequency = frequency;
          }

          // 提取关键词（简单实现：取高频词）
          if (options.keywords && result.wordFrequency) {
            const sorted = Object.entries(result.wordFrequency)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([word]) => word);
            result.keywords = sorted;
          }

          return result;
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'text_analyzer',
        description: '文本统计和分析',
        parameters: {
          text: { type: 'string', description: '要分析的文本' },
          options: { type: 'object', description: '分析选项' }
        }
      }
    );

    // 4. 日期时间处理器
    functionCaller.registerTool(
      'datetime_handler',
      async (params) => {
        try {
          const { action, date, format, amount, unit } = params;
          const now = date ? new Date(date) : new Date();

          switch (action) {
            case 'format':
              const formatted = this._formatDate(now, format);
              return {
                success: true,
                result: formatted,
                timestamp: now.getTime()
              };

            case 'parse':
              const parsed = new Date(date);
              return {
                success: true,
                result: parsed.toISOString(),
                timestamp: parsed.getTime()
              };

            case 'add':
              const added = this._addTime(now, amount, unit);
              return {
                success: true,
                result: added.toISOString(),
                timestamp: added.getTime()
              };

            case 'subtract':
              const subtracted = this._addTime(now, -amount, unit);
              return {
                success: true,
                result: subtracted.toISOString(),
                timestamp: subtracted.getTime()
              };

            case 'diff':
              const target = new Date(date);
              const diff = target.getTime() - now.getTime();
              return {
                success: true,
                result: Math.floor(diff / 1000 / 60 / 60 / 24) + ' 天',
                timestamp: diff
              };

            default:
              throw new Error(`未知的操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'datetime_handler',
        description: '日期时间处理',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          date: { type: 'string', description: '日期' },
          format: { type: 'string', description: '格式' },
          amount: { type: 'number', description: '数量' },
          unit: { type: 'string', description: '单位' }
        }
      }
    );

    // 5. URL处理器
    functionCaller.registerTool(
      'url_parser',
      async (params) => {
        try {
          const { url, action, params: queryParams } = params;

          switch (action) {
            case 'parse':
              const parsed = new URL(url);
              return {
                success: true,
                result: {
                  protocol: parsed.protocol,
                  hostname: parsed.hostname,
                  port: parsed.port,
                  pathname: parsed.pathname,
                  search: parsed.search,
                  hash: parsed.hash,
                  params: Object.fromEntries(parsed.searchParams)
                }
              };

            case 'build':
              const base = url || 'https://example.com';
              const newUrl = new URL(base);
              if (queryParams) {
                Object.entries(queryParams).forEach(([key, value]) => {
                  newUrl.searchParams.set(key, value);
                });
              }
              return { success: true, result: newUrl.toString() };

            case 'validate':
              try {
                new URL(url);
                return { success: true, valid: true };
              } catch {
                return { success: true, valid: false };
              }

            case 'encode':
              return {
                success: true,
                result: encodeURIComponent(url)
              };

            case 'decode':
              return {
                success: true,
                result: decodeURIComponent(url)
              };

            default:
              throw new Error(`未知的操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'url_parser',
        description: 'URL解析和处理',
        parameters: {
          url: { type: 'string', description: 'URL字符串' },
          action: { type: 'string', description: '操作类型' },
          params: { type: 'object', description: '查询参数' }
        }
      }
    );

    // 6. 加密解密工具
    functionCaller.registerTool(
      'crypto_handler',
      async (params) => {
        try {
          const { action, algorithm, data, key, iv } = params;

          switch (action) {
            case 'hash':
              const hash = crypto.createHash(algorithm);
              hash.update(data);
              return {
                success: true,
                result: hash.digest('hex'),
                algorithm
              };

            case 'encrypt':
              if (algorithm.startsWith('aes')) {
                const cipher = crypto.createCipheriv(
                  algorithm,
                  Buffer.from(key, 'hex'),
                  iv ? Buffer.from(iv, 'hex') : null
                );
                let encrypted = cipher.update(data, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                return { success: true, result: encrypted, algorithm };
              }
              throw new Error('仅支持AES加密算法');

            case 'decrypt':
              if (algorithm.startsWith('aes')) {
                const decipher = crypto.createDecipheriv(
                  algorithm,
                  Buffer.from(key, 'hex'),
                  iv ? Buffer.from(iv, 'hex') : null
                );
                let decrypted = decipher.update(data, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return { success: true, result: decrypted, algorithm };
              }
              throw new Error('仅支持AES解密算法');

            default:
              throw new Error(`未知的操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'crypto_handler',
        description: '加密解密和哈希',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          algorithm: { type: 'string', description: '算法' },
          data: { type: 'string', description: '数据' },
          key: { type: 'string', description: '密钥' },
          iv: { type: 'string', description: '初始化向量' }
        }
      }
    );

    // 7. Base64编解码
    functionCaller.registerTool(
      'base64_handler',
      async (params) => {
        try {
          const { action, data, encoding = 'utf8' } = params;

          if (action === 'encode') {
            const buffer = Buffer.from(data, encoding);
            return {
              success: true,
              result: buffer.toString('base64')
            };
          } else if (action === 'decode') {
            const buffer = Buffer.from(data, 'base64');
            return {
              success: true,
              result: buffer.toString(encoding)
            };
          }

          throw new Error(`未知的操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'base64_handler',
        description: 'Base64编解码',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          data: { type: 'string', description: '数据' },
          encoding: { type: 'string', description: '字符编码' }
        }
      }
    );

    // 8. HTTP客户端（简化实现，实际应使用axios等库）
    functionCaller.registerTool(
      'http_client',
      async (params) => {
        try {
          const { url, method = 'GET', headers = {}, body, timeout = 10000 } = params;

          // 注意: 这是简化实现，生产环境应使用 axios 或 node-fetch
          const http = url.startsWith('https') ? require('https') : require('http');
          const urlObj = new URL(url);

          return new Promise((resolve, reject) => {
            const options = {
              hostname: urlObj.hostname,
              port: urlObj.port,
              path: urlObj.pathname + urlObj.search,
              method,
              headers,
              timeout
            };

            const req = http.request(options, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  const parsed = JSON.parse(data);
                  resolve({
                    success: true,
                    status: res.statusCode,
                    headers: res.headers,
                    data: parsed
                  });
                } catch {
                  resolve({
                    success: true,
                    status: res.statusCode,
                    headers: res.headers,
                    data: data
                  });
                }
              });
            });

            req.on('error', (error) => {
              resolve({ success: false, error: error.message });
            });

            req.on('timeout', () => {
              req.destroy();
              resolve({ success: false, error: '请求超时' });
            });

            if (body) {
              req.write(typeof body === 'string' ? body : JSON.stringify(body));
            }

            req.end();
          });
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'http_client',
        description: 'HTTP请求客户端',
        parameters: {
          url: { type: 'string', description: 'URL' },
          method: { type: 'string', description: 'HTTP方法' },
          headers: { type: 'object', description: '请求头' },
          body: { type: 'any', description: '请求体' },
          timeout: { type: 'number', description: '超时时间' }
        }
      }
    );

    // 9. 正则表达式测试器
    functionCaller.registerTool(
      'regex_tester',
      async (params) => {
        try {
          const { pattern, text, action, replacement, flags = 'g' } = params;
          const regex = new RegExp(pattern, flags);

          switch (action) {
            case 'test':
              return {
                success: true,
                result: regex.test(text)
              };

            case 'match':
              const matches = text.match(regex);
              return {
                success: true,
                result: matches ? matches[0] : null,
                matches: matches || []
              };

            case 'replace':
              return {
                success: true,
                result: text.replace(regex, replacement)
              };

            case 'split':
              return {
                success: true,
                result: text.split(regex)
              };

            default:
              throw new Error(`未知的操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'regex_tester',
        description: '正则表达式测试',
        parameters: {
          pattern: { type: 'string', description: '正则模式' },
          text: { type: 'string', description: '测试文本' },
          action: { type: 'string', description: '操作类型' },
          replacement: { type: 'string', description: '替换文本' },
          flags: { type: 'string', description: '正则标志' }
        }
      }
    );

    // 10. Markdown转换器（简化实现）
    functionCaller.registerTool(
      'markdown_converter',
      async (params) => {
        try {
          const { markdown, targetFormat = 'html', options = {} } = params;

          if (targetFormat === 'html') {
            // 简单的Markdown到HTML转换
            const html = markdown
              .replace(/^### (.*$)/gim, '<h3>$1</h3>')
              .replace(/^## (.*$)/gim, '<h2>$1</h2>')
              .replace(/^# (.*$)/gim, '<h1>$1</h1>')
              .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
              .replace(/\*(.*)\*/gim, '<em>$1</em>')
              .replace(/\n/gim, '<br>');

            return {
              success: true,
              result: html,
              format: 'html'
            };
          } else if (targetFormat === 'plain') {
            const plain = markdown
              .replace(/[#*_~`]/g, '')
              .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

            return {
              success: true,
              result: plain,
              format: 'plain'
            };
          }

          throw new Error(`不支持的目标格式: ${targetFormat}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'markdown_converter',
        description: 'Markdown格式转换',
        parameters: {
          markdown: { type: 'string', description: 'Markdown内容' },
          targetFormat: { type: 'string', description: '目标格式' },
          options: { type: 'object', description: '转换选项' }
        }
      }
    );

    // 11. CSV处理器
    functionCaller.registerTool(
      'csv_handler',
      async (params) => {
        try {
          const { action, data, options = {} } = params;
          const delimiter = options.delimiter || ',';
          const hasHeader = options.header !== false;

          if (action === 'parse') {
            const lines = data.trim().split('\n');
            const headers = hasHeader ? lines[0].split(delimiter) : null;
            const dataLines = hasHeader ? lines.slice(1) : lines;

            const result = dataLines.map(line => {
              const values = line.split(delimiter);
              if (headers) {
                const obj = {};
                headers.forEach((header, i) => {
                  obj[header.trim()] = values[i]?.trim();
                });
                return obj;
              }
              return values.map(v => v.trim());
            });

            return {
              success: true,
              result,
              rowCount: result.length
            };
          } else if (action === 'stringify') {
            const arr = JSON.parse(data);
            if (arr.length === 0) {
              return { success: true, result: '', rowCount: 0 };
            }

            const keys = Object.keys(arr[0]);
            const header = keys.join(delimiter);
            const rows = arr.map(obj =>
              keys.map(key => obj[key]).join(delimiter)
            );

            return {
              success: true,
              result: [header, ...rows].join('\n'),
              rowCount: arr.length
            };
          }

          throw new Error(`未知的操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'csv_handler',
        description: 'CSV数据处理',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          data: { type: 'string', description: 'CSV数据' },
          options: { type: 'object', description: 'CSV选项' }
        }
      }
    );

    // 12. 随机数据生成器
    functionCaller.registerTool(
      'random_generator',
      async (params) => {
        try {
          const { type, count = 1, options = {} } = params;
          const results = [];

          for (let i = 0; i < count; i++) {
            switch (type) {
              case 'number':
                const min = options.min || 0;
                const max = options.max || 100;
                results.push(Math.floor(Math.random() * (max - min + 1)) + min);
                break;

              case 'string':
                const length = options.length || 10;
                const charset = options.charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let str = '';
                for (let j = 0; j < length; j++) {
                  str += charset.charAt(Math.floor(Math.random() * charset.length));
                }
                results.push(str);
                break;

              case 'uuid':
                results.push(crypto.randomUUID());
                break;

              case 'boolean':
                results.push(Math.random() < 0.5);
                break;

              case 'date':
                const start = new Date(2020, 0, 1);
                const end = new Date();
                const randomDate = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
                results.push(randomDate.toISOString());
                break;

              case 'color':
                const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
                results.push(color);
                break;

              default:
                throw new Error(`未知的类型: ${type}`);
            }
          }

          return {
            success: true,
            result: count === 1 ? results[0] : results,
            count: results.length
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'random_generator',
        description: '随机数据生成',
        parameters: {
          type: { type: 'string', description: '数据类型' },
          count: { type: 'number', description: '生成数量' },
          options: { type: 'object', description: '生成选项' }
        }
      }
    );

    // 13. 颜色转换器
    functionCaller.registerTool(
      'color_converter',
      async (params) => {
        try {
          const { color, from, to } = params;

          // 辅助函数：HEX转RGB
          const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16)
            } : null;
          };

          // 辅助函数：RGB转HEX
          const rgbToHex = (r, g, b) => {
            return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
          };

          const result = {};

          if (from === 'hex') {
            const rgb = hexToRgb(color);
            if (to === 'rgb' || to === 'all') {
              result.rgb = rgb;
            }
            if (to === 'hex' || to === 'all') {
              result.hex = color;
            }
          } else if (from === 'rgb') {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
              const r = parseInt(match[1]);
              const g = parseInt(match[2]);
              const b = parseInt(match[3]);

              if (to === 'hex' || to === 'all') {
                result.hex = rgbToHex(r, g, b);
              }
              if (to === 'rgb' || to === 'all') {
                result.rgb = { r, g, b };
              }
            }
          }

          return {
            success: true,
            result: to === 'all' ? result : result[to]
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'color_converter',
        description: '颜色格式转换',
        parameters: {
          color: { type: 'string', description: '颜色值' },
          from: { type: 'string', description: '源格式' },
          to: { type: 'string', description: '目标格式' }
        }
      }
    );

    // 注意: template_renderer 已移至 ExtendedTools3，避免重复注册

    logger.info('[Extended Tools] 已注册所有扩展工具');
  }

  // === 辅助方法 ===

  /**
   * 格式化日期
   * @private
   */
  static _formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    const map = {
      'YYYY': date.getFullYear(),
      'MM': String(date.getMonth() + 1).padStart(2, '0'),
      'DD': String(date.getDate()).padStart(2, '0'),
      'HH': String(date.getHours()).padStart(2, '0'),
      'mm': String(date.getMinutes()).padStart(2, '0'),
      'ss': String(date.getSeconds()).padStart(2, '0')
    };

    let result = format;
    Object.entries(map).forEach(([key, value]) => {
      result = result.replace(key, value);
    });

    return result;
  }

  /**
   * 添加时间
   * @private
   */
  static _addTime(date, amount, unit) {
    const result = new Date(date);

    switch (unit) {
      case 'year':
        result.setFullYear(result.getFullYear() + amount);
        break;
      case 'month':
        result.setMonth(result.getMonth() + amount);
        break;
      case 'day':
        result.setDate(result.getDate() + amount);
        break;
      case 'hour':
        result.setHours(result.getHours() + amount);
        break;
      case 'minute':
        result.setMinutes(result.getMinutes() + amount);
        break;
      case 'second':
        result.setSeconds(result.getSeconds() + amount);
        break;
      default:
        throw new Error(`未知的时间单位: ${unit}`);
    }

    return result;
  }
}

module.exports = ExtendedTools;
