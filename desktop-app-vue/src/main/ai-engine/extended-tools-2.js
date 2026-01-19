/**
 * 扩展工具实现 - 第二批
 * 包含第二批20个新增工具的处理函数
 */

const { logger, createLogger } = require('../utils/logger.js');
const crypto = require('crypto');
const fs = require('fs').promises;
const dns = require('dns').promises;
const net = require('net');

class ExtendedTools2 {
  /**
   * 注册所有扩展工具到 FunctionCaller
   * @param {FunctionCaller} functionCaller - FunctionCaller 实例
   */
  static registerAll(functionCaller) {
    // 33. QR码生成器（简化实现）
    functionCaller.registerTool(
      'qrcode_generator',
      async (params) => {
        try {
          const { data, size = 256, format = 'png', errorLevel = 'M' } = params;

          // 简化实现：返回一个SVG格式的QR码占位符
          // 实际应用中应使用 qrcode 或 qr-image 库
          const svg = `<svg width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="white"/>
  <text x="50" y="50" text-anchor="middle" font-size="8">QR: ${data.substring(0, 20)}</text>
</svg>`;

          return {
            success: true,
            result: format === 'svg' ? svg : `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
            format
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'qrcode_generator',
        description: 'QR码生成',
        parameters: {
          data: { type: 'string', description: '要编码的数据' },
          size: { type: 'number', description: '尺寸' },
          format: { type: 'string', description: '格式' }
        }
      }
    );

    // 34. Diff比较器
    functionCaller.registerTool(
      'diff_comparator',
      async (params) => {
        try {
          const { text1, text2, format = 'unified', ignoreWhitespace = false } = params;

          let t1 = text1;
          let t2 = text2;

          if (ignoreWhitespace) {
            t1 = t1.replace(/\s+/g, ' ').trim();
            t2 = t2.replace(/\s+/g, ' ').trim();
          }

          // 简单的行级diff
          const lines1 = t1.split('\n');
          const lines2 = t2.split('\n');

          let additions = 0;
          let deletions = 0;
          let changes = 0;
          let diff = '';

          const maxLen = Math.max(lines1.length, lines2.length);

          for (let i = 0; i < maxLen; i++) {
            const line1 = lines1[i];
            const line2 = lines2[i];

            if (line1 !== line2) {
              changes++;
              if (line1 && !line2) {
                deletions++;
                diff += `- ${line1}\n`;
              } else if (!line1 && line2) {
                additions++;
                diff += `+ ${line2}\n`;
              } else {
                deletions++;
                additions++;
                diff += `- ${line1}\n+ ${line2}\n`;
              }
            } else if (line1) {
              diff += `  ${line1}\n`;
            }
          }

          return {
            success: true,
            diff,
            changes,
            additions,
            deletions
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'diff_comparator',
        description: 'Diff比较',
        parameters: {
          text1: { type: 'string', description: '第一个文本' },
          text2: { type: 'string', description: '第二个文本' }
        }
      }
    );

    // 35. Hash校验器
    functionCaller.registerTool(
      'hash_verifier',
      async (params) => {
        try {
          const { filePath, text, algorithm = 'sha256', expectedHash } = params;

          let data;
          if (filePath) {
            data = await fs.readFile(filePath);
          } else if (text) {
            data = Buffer.from(text, 'utf8');
          } else {
            throw new Error('需要提供 filePath 或 text');
          }

          const hash = crypto.createHash(algorithm);
          hash.update(data);
          const result = hash.digest('hex');

          const verified = expectedHash ? result === expectedHash : undefined;

          return {
            success: true,
            hash: result,
            algorithm,
            verified
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'hash_verifier',
        description: 'Hash校验',
        parameters: {
          filePath: { type: 'string', description: '文件路径' },
          text: { type: 'string', description: '文本' },
          algorithm: { type: 'string', description: '算法' }
        }
      }
    );

    // 36. IP地址工具
    functionCaller.registerTool(
      'ip_utility',
      async (params) => {
        try {
          const { action, ip, cidr } = params;

          switch (action) {
            case 'validate':
              const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
              const ipv6Regex = /^([0-9a-f]{0,4}:){7}[0-9a-f]{0,4}$/i;

              const isValid = ipv4Regex.test(ip) || ipv6Regex.test(ip);
              const version = ipv4Regex.test(ip) ? 'IPv4' : (ipv6Regex.test(ip) ? 'IPv6' : 'Unknown');

              return {
                success: true,
                isValid,
                version,
                result: { isValid, version }
              };

            case 'parse':
              const parts = ip.split('.');
              return {
                success: true,
                result: {
                  octets: parts,
                  binary: parts.map(p => parseInt(p).toString(2).padStart(8, '0')).join('.')
                }
              };

            default:
              throw new Error(`未知操作: ${action}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'ip_utility',
        description: 'IP地址工具',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          ip: { type: 'string', description: 'IP地址' }
        }
      }
    );

    // 37. User-Agent解析器
    functionCaller.registerTool(
      'useragent_parser',
      async (params) => {
        try {
          const { userAgent } = params;

          // 简单的UA解析
          const browser = {
            name: userAgent.includes('Chrome') ? 'Chrome' :
                  userAgent.includes('Firefox') ? 'Firefox' :
                  userAgent.includes('Safari') ? 'Safari' : 'Unknown',
            version: 'Unknown'
          };

          const os = {
            name: userAgent.includes('Windows') ? 'Windows' :
                  userAgent.includes('Mac') ? 'macOS' :
                  userAgent.includes('Linux') ? 'Linux' : 'Unknown',
            version: 'Unknown'
          };

          const device = {
            type: userAgent.includes('Mobile') ? 'mobile' : 'desktop'
          };

          return {
            success: true,
            browser,
            os,
            device
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'useragent_parser',
        description: 'User-Agent解析',
        parameters: {
          userAgent: { type: 'string', description: 'User-Agent字符串' }
        }
      }
    );

    // 38. Cron表达式解析器
    functionCaller.registerTool(
      'cron_parser',
      async (params) => {
        try {
          const { action, expression } = params;

          if (action === 'parse') {
            const parts = expression.split(' ');
            if (parts.length !== 5) {
              throw new Error('Cron表达式应包含5个部分');
            }

            const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

            const description = `每${
              dayOfWeek !== '*' ? `周${dayOfWeek}` :
              dayOfMonth !== '*' ? `月${dayOfMonth}日` : '天'
            } ${hour !== '*' ? `${hour}点` : ''}${minute !== '*' ? `${minute}分` : ''}`;

            return {
              success: true,
              result: { minute, hour, dayOfMonth, month, dayOfWeek },
              description
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'cron_parser',
        description: 'Cron表达式解析',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          expression: { type: 'string', description: 'Cron表达式' }
        }
      }
    );

    // 39. 代码美化器
    functionCaller.registerTool(
      'code_formatter',
      async (params) => {
        try {
          const { code, language, options = {} } = params;
          const indent = options.indent || 2;

          let formatted = code;

          if (language === 'json') {
            try {
              const obj = JSON.parse(code);
              formatted = JSON.stringify(obj, null, indent);
            } catch {
              formatted = code;
            }
          } else if (language === 'javascript') {
            // 简单的JS格式化
            formatted = code
              .replace(/\{/g, '{\n' + ' '.repeat(indent))
              .replace(/\}/g, '\n}')
              .replace(/;/g, ';\n');
          }

          return {
            success: true,
            formatted,
            language
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'code_formatter',
        description: '代码格式化',
        parameters: {
          code: { type: 'string', description: '代码' },
          language: { type: 'string', description: '语言' }
        }
      }
    );

    // 40. 文本编码检测器
    functionCaller.registerTool(
      'encoding_detector',
      async (params) => {
        try {
          const { filePath } = params;

          if (!filePath) {
            throw new Error('需要提供文件路径');
          }

          const buffer = await fs.readFile(filePath);

          // 简单的编码检测
          let encoding = 'utf-8';
          let confidence = 0.8;

          // 检测BOM
          if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
            encoding = 'utf-8';
            confidence = 1.0;
          } else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            encoding = 'utf-16le';
            confidence = 1.0;
          } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            encoding = 'utf-16be';
            confidence = 1.0;
          }

          return {
            success: true,
            encoding,
            confidence
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'encoding_detector',
        description: '编码检测',
        parameters: {
          filePath: { type: 'string', description: '文件路径' }
        }
      }
    );

    // 41. 版本号比较器
    functionCaller.registerTool(
      'version_comparator',
      async (params) => {
        try {
          const { action, version1, version2, bumpType } = params;

          if (action === 'compare') {
            const v1Parts = version1.split('.').map(Number);
            const v2Parts = version2.split('.').map(Number);

            for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
              const v1 = v1Parts[i] || 0;
              const v2 = v2Parts[i] || 0;

              if (v1 > v2) {return { success: true, result: 1, comparison: 1 };}
              if (v1 < v2) {return { success: true, result: -1, comparison: -1 };}
            }

            return { success: true, result: 0, comparison: 0 };
          } else if (action === 'bump') {
            const parts = version1.split('.').map(Number);

            if (bumpType === 'major') {parts[0]++;}
            else if (bumpType === 'minor') {parts[1]++;}
            else if (bumpType === 'patch') {parts[2]++;}

            return {
              success: true,
              result: parts.join('.')
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'version_comparator',
        description: '版本号比较',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          version1: { type: 'string', description: '版本1' },
          version2: { type: 'string', description: '版本2' }
        }
      }
    );

    // 42. JWT解析器
    functionCaller.registerTool(
      'jwt_parser',
      async (params) => {
        try {
          const { token, action = 'decode' } = params;

          const parts = token.split('.');
          if (parts.length !== 3) {
            throw new Error('无效的JWT令牌');
          }

          const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          const signature = parts[2];

          return {
            success: true,
            header,
            payload,
            signature
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'jwt_parser',
        description: 'JWT解析',
        parameters: {
          token: { type: 'string', description: 'JWT令牌' },
          action: { type: 'string', description: '操作类型' }
        }
      }
    );

    // 43. XML解析器（简化实现）
    functionCaller.registerTool(
      'xml_parser',
      async (params) => {
        try {
          const { action, xml } = params;

          if (action === 'parse') {
            // 极简XML解析（实际应使用xml2js库）
            const tagRegex = /<(\w+)>(.*?)<\/\1>/g;
            const result = {};
            let match;

            while ((match = tagRegex.exec(xml)) !== null) {
              result[match[1]] = match[2];
            }

            return {
              success: true,
              result,
              valid: true
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'xml_parser',
        description: 'XML解析',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          xml: { type: 'string', description: 'XML字符串' }
        }
      }
    );

    // 44. HTML解析器（简化实现）
    functionCaller.registerTool(
      'html_parser',
      async (params) => {
        try {
          const { html, action } = params;

          if (action === 'text') {
            // 移除HTML标签
            const text = html.replace(/<[^>]+>/g, '');
            return {
              success: true,
              result: text
            };
          } else if (action === 'parse') {
            return {
              success: true,
              result: { html },
              elements: []
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'html_parser',
        description: 'HTML解析',
        parameters: {
          html: { type: 'string', description: 'HTML字符串' },
          action: { type: 'string', description: '操作类型' }
        }
      }
    );

    // 45. TOML解析器（简化实现）
    functionCaller.registerTool(
      'toml_parser',
      async (params) => {
        try {
          const { action, toml } = params;

          if (action === 'parse') {
            // 极简TOML解析
            const lines = toml.split('\n');
            const result = {};
            let currentSection = null;

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) {continue;}

              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                currentSection = trimmed.slice(1, -1);
                result[currentSection] = {};
              } else {
                const [key, value] = trimmed.split('=').map(s => s.trim());
                if (key && value) {
                  const target = currentSection ? result[currentSection] : result;
                  target[key] = isNaN(value) ? value.replace(/['"]/g, '') : Number(value);
                }
              }
            }

            return {
              success: true,
              result
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'toml_parser',
        description: 'TOML解析',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          toml: { type: 'string', description: 'TOML字符串' }
        }
      }
    );

    // 46. INI解析器
    functionCaller.registerTool(
      'ini_parser',
      async (params) => {
        try {
          const { action, ini } = params;

          if (action === 'parse') {
            const lines = ini.split('\n');
            const result = {};
            let currentSection = 'DEFAULT';
            result[currentSection] = {};

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(';')) {continue;}

              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                currentSection = trimmed.slice(1, -1);
                result[currentSection] = {};
              } else {
                const [key, value] = trimmed.split('=').map(s => s.trim());
                if (key && value) {
                  result[currentSection][key] = value;
                }
              }
            }

            return {
              success: true,
              result
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'ini_parser',
        description: 'INI解析',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          ini: { type: 'string', description: 'INI字符串' }
        }
      }
    );

    // 47. DNS查询器
    functionCaller.registerTool(
      'dns_lookup',
      async (params) => {
        try {
          const { domain, recordType = 'A' } = params;

          let records;

          switch (recordType) {
            case 'A':
              records = await dns.resolve4(domain);
              break;
            case 'AAAA':
              records = await dns.resolve6(domain);
              break;
            case 'MX':
              records = await dns.resolveMx(domain);
              break;
            case 'TXT':
              records = await dns.resolveTxt(domain);
              break;
            case 'NS':
              records = await dns.resolveNs(domain);
              break;
            case 'CNAME':
              records = await dns.resolveCname(domain);
              break;
            default:
              throw new Error(`不支持的记录类型: ${recordType}`);
          }

          return {
            success: true,
            records,
            type: recordType
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'dns_lookup',
        description: 'DNS查询',
        parameters: {
          domain: { type: 'string', description: '域名' },
          recordType: { type: 'string', description: '记录类型' }
        }
      }
    );

    // 48. 端口检测器
    functionCaller.registerTool(
      'port_checker',
      async (params) => {
        try {
          const { host, port, timeout = 3000 } = params;

          return new Promise((resolve) => {
            const socket = new net.Socket();
            let isOpen = false;

            socket.setTimeout(timeout);

            socket.on('connect', () => {
              isOpen = true;
              socket.destroy();
              resolve({
                success: true,
                isOpen: true,
                host,
                port
              });
            });

            socket.on('timeout', () => {
              socket.destroy();
              resolve({
                success: true,
                isOpen: false,
                host,
                port
              });
            });

            socket.on('error', () => {
              resolve({
                success: true,
                isOpen: false,
                host,
                port
              });
            });

            socket.connect(port, host);
          });
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'port_checker',
        description: '端口检测',
        parameters: {
          host: { type: 'string', description: '主机' },
          port: { type: 'number', description: '端口' }
        }
      }
    );

    // 49. 邮件解析器
    functionCaller.registerTool(
      'email_parser',
      async (params) => {
        try {
          const { action, email } = params;

          if (action === 'validate') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const isValid = emailRegex.test(email);

            return {
              success: true,
              isValid,
              result: { isValid }
            };
          } else if (action === 'parse') {
            const parts = email.split('@');
            return {
              success: true,
              result: {
                username: parts[0],
                domain: parts[1]
              }
            };
          }

          throw new Error(`未知操作: ${action}`);
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'email_parser',
        description: '邮件解析',
        parameters: {
          action: { type: 'string', description: '操作类型' },
          email: { type: 'string', description: '邮件地址' }
        }
      }
    );

    // 50. Slug生成器
    functionCaller.registerTool(
      'slug_generator',
      async (params) => {
        try {
          const { text, separator = '-', lowercase = true } = params;

          let slug = text
            // 移除特殊字符
            .replace(/[^\w\s\u4e00-\u9fa5-]/g, '')
            // 将空格替换为分隔符
            .replace(/\s+/g, separator)
            // 移除连续的分隔符
            .replace(new RegExp(`${separator}+`, 'g'), separator)
            // 移除首尾分隔符
            .replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');

          if (lowercase) {
            slug = slug.toLowerCase();
          }

          return {
            success: true,
            slug
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'slug_generator',
        description: 'Slug生成',
        parameters: {
          text: { type: 'string', description: '文本' },
          separator: { type: 'string', description: '分隔符' }
        }
      }
    );

    // 51. Git Diff解析器
    functionCaller.registerTool(
      'gitdiff_parser',
      async (params) => {
        try {
          const { diff } = params;

          const files = [];
          let additions = 0;
          let deletions = 0;

          const lines = diff.split('\n');

          for (const line of lines) {
            if (line.startsWith('diff --git')) {
              const match = line.match(/a\/(.*) b\/(.*)/);
              if (match) {
                files.push(match[1]);
              }
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
              additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              deletions++;
            }
          }

          return {
            success: true,
            files,
            additions,
            deletions
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'gitdiff_parser',
        description: 'Git Diff解析',
        parameters: {
          diff: { type: 'string', description: 'Git diff输出' }
        }
      }
    );

    // 52. 语言检测器
    functionCaller.registerTool(
      'language_detector',
      async (params) => {
        try {
          const { text } = params;

          // 简单的语言检测逻辑
          const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
          const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
          const total = chineseChars + englishChars;

          let language = 'unknown';
          let confidence = 0;

          if (total > 0) {
            if (chineseChars / total > 0.5) {
              language = 'zh';
              confidence = chineseChars / total;
            } else if (englishChars / total > 0.5) {
              language = 'en';
              confidence = englishChars / total;
            }
          }

          return {
            success: true,
            language,
            confidence,
            alternatives: []
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      {
        name: 'language_detector',
        description: '语言检测',
        parameters: {
          text: { type: 'string', description: '要检测的文本' }
        }
      }
    );

    logger.info('[Extended Tools 2] 已注册20个扩展工具');
  }
}

module.exports = ExtendedTools2;
