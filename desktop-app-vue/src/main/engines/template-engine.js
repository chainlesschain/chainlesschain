/**
 * 模板变量替换引擎
 * 使用Handlebars模板引擎，支持变量定义、验证和文件批量生成
 */
const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

class TemplateEngine {
  constructor() {
    this.handlebars = Handlebars;
    this.registerHelpers();
  }

  /**
   * 注册自定义Handlebars helpers
   */
  registerHelpers() {
    // 日期格式化
    this.handlebars.registerHelper('formatDate', (date, format) => {
      if (!date) {return '';}
      const d = new Date(date);
      if (format === 'yyyy-MM-dd') {
        return d.toISOString().split('T')[0];
      } else if (format === 'yyyy年MM月dd日') {
        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
      }
      return d.toLocaleDateString('zh-CN');
    });

    // 大写转换
    this.handlebars.registerHelper('uppercase', (str) => {
      return str ? str.toUpperCase() : '';
    });

    // 小写转换
    this.handlebars.registerHelper('lowercase', (str) => {
      return str ? str.toLowerCase() : '';
    });

    // 首字母大写
    this.handlebars.registerHelper('capitalize', (str) => {
      if (!str) {return '';}
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // 条件判断 - 支持块级和内联使用
    this.handlebars.registerHelper('eq', function(a, b, options) {
      // 块级helper使用（{{#eq a b}}...{{/eq}}）
      if (options && options.fn) {
        return a === b ? options.fn(this) : options.inverse(this);
      }
      // 内联helper使用（{{eq a b}}）
      return a === b;
    });

    // 小于或等于 - 支持块级和内联使用
    this.handlebars.registerHelper('lte', function(a, b, options) {
      if (options && options.fn) {
        return a <= b ? options.fn(this) : options.inverse(this);
      }
      return a <= b;
    });

    // 大于或等于 - 支持块级和内联使用
    this.handlebars.registerHelper('gte', function(a, b, options) {
      if (options && options.fn) {
        return a >= b ? options.fn(this) : options.inverse(this);
      }
      return a >= b;
    });

    // 小于 - 支持块级和内联使用
    this.handlebars.registerHelper('lt', function(a, b, options) {
      if (options && options.fn) {
        return a < b ? options.fn(this) : options.inverse(this);
      }
      return a < b;
    });

    // 大于 - 支持块级和内联使用
    this.handlebars.registerHelper('gt', function(a, b, options) {
      if (options && options.fn) {
        return a > b ? options.fn(this) : options.inverse(this);
      }
      return a > b;
    });

    // 默认值
    this.handlebars.registerHelper('default', (value, defaultValue) => {
      return value || defaultValue;
    });

    // 数组/对象查找 - 支持 lookup 语法访问数组元素
    this.handlebars.registerHelper('lookup', (obj, key) => {
      if (!obj) {return undefined;}
      return obj[key];
    });

    // 生成数字范围数组
    this.handlebars.registerHelper('range', (start, end) => {
      const result = [];
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
      return result;
    });

    // 加法
    this.handlebars.registerHelper('add', (a, b) => {
      return Number(a) + Number(b);
    });

    // 减法
    this.handlebars.registerHelper('subtract', (a, b) => {
      return Number(a) - Number(b);
    });
  }

  /**
   * 渲染模板字符串
   * @param {string} templateString - Handlebars模板字符串
   * @param {Object} variables - 变量对象
   * @returns {string} 渲染后的字符串
   */
  render(templateString, variables) {
    try {
      // 添加常用的内置变量
      const context = {
        ...variables,
        // 星期名称数组（中文）
        dayNames: ['一', '二', '三', '四', '五', '六', '日'],
        // 星期名称数组（英文）
        dayNamesEn: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        // 月份名称（中文）
        monthNames: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
      };

      const compiledTemplate = this.handlebars.compile(templateString);
      return compiledTemplate(context);
    } catch (error) {
      console.error('[TemplateEngine] 渲染失败:', error);
      throw new Error(`模板渲染失败: ${error.message}`);
    }
  }

  /**
   * 验证变量
   * @param {Array} variableDefinitions - 变量定义数组
   * @param {Object} userVariables - 用户提供的变量
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validateVariables(variableDefinitions, userVariables) {
    const errors = [];

    if (!Array.isArray(variableDefinitions)) {
      return { valid: true, errors: [] };
    }

    for (const varDef of variableDefinitions) {
      const { name, label, type, required, pattern, min, max } = varDef;
      const value = userVariables[name];

      // 检查必填项
      if (required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: name,
          message: `${label || name} 为必填项`
        });
        continue;
      }

      // 如果值为空且非必填，跳过其他验证
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // 类型验证
      switch (type) {
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            errors.push({
              field: name,
              message: `${label || name} 必须是数字`
            });
          } else {
            const numValue = Number(value);
            if (min !== undefined && numValue < min) {
              errors.push({
                field: name,
                message: `${label || name} 不能小于 ${min}`
              });
            }
            if (max !== undefined && numValue > max) {
              errors.push({
                field: name,
                message: `${label || name} 不能大于 ${max}`
              });
            }
          }
          break;

        case 'text':
        case 'textarea':
          if (typeof value !== 'string') {
            errors.push({
              field: name,
              message: `${label || name} 必须是字符串`
            });
          } else {
            if (min !== undefined && value.length < min) {
              errors.push({
                field: name,
                message: `${label || name} 长度不能少于 ${min} 个字符`
              });
            }
            if (max !== undefined && value.length > max) {
              errors.push({
                field: name,
                message: `${label || name} 长度不能超过 ${max} 个字符`
              });
            }
            if (pattern) {
              const regex = new RegExp(pattern);
              if (!regex.test(value)) {
                errors.push({
                  field: name,
                  message: `${label || name} 格式不正确`
                });
              }
            }
          }
          break;

        case 'email':
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push({
              field: name,
              message: `${label || name} 邮箱格式不正确`
            });
          }
          break;

        case 'url':
          try {
            new URL(value);
          } catch {
            errors.push({
              field: name,
              message: `${label || name} URL格式不正确`
            });
          }
          break;

        case 'date':
          if (isNaN(Date.parse(value))) {
            errors.push({
              field: name,
              message: `${label || name} 日期格式不正确`
            });
          }
          break;

        case 'select':
        case 'radio':
          if (varDef.options && !varDef.options.some(opt => opt.value === value)) {
            errors.push({
              field: name,
              message: `${label || name} 值不在可选范围内`
            });
          }
          break;

        case 'checkbox':
          if (!Array.isArray(value)) {
            errors.push({
              field: name,
              message: `${label || name} 必须是数组`
            });
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 从模板创建项目
   * @param {Object} template - 模板对象
   * @param {Object} variables - 用户变量
   * @param {string} targetPath - 目标路径
   * @returns {Promise<Object>} { success: boolean, filesCreated: number, errors: Array }
   */
  async createProjectFromTemplate(template, variables, targetPath) {
    try {
      console.log('[TemplateEngine] 开始从模板创建项目:', template.name);

      // 1. 验证变量
      if (template.variables) {
        const validation = this.validateVariables(template.variables, variables);
        if (!validation.valid) {
          return {
            success: false,
            filesCreated: 0,
            errors: validation.errors
          };
        }
      }

      // 2. 准备变量上下文（添加系统变量）
      const context = {
        ...variables,
        _system: {
          date: new Date().toISOString().split('T')[0],
          datetime: new Date().toISOString(),
          year: new Date().getFullYear(),
          timestamp: Date.now()
        }
      };

      // 3. 确保目标路径存在
      await fs.mkdir(targetPath, { recursive: true });

      // 4. 渲染并创建文件
      const filesCreated = [];
      const errors = [];

      if (template.files && Array.isArray(template.files)) {
        for (const fileTemplate of template.files) {
          try {
            const { path: filePath, template: fileContent, type } = fileTemplate;

            // 渲染文件路径（支持路径中的变量）
            const renderedPath = this.render(filePath, context);
            const fullPath = path.join(targetPath, renderedPath);

            // 确保文件目录存在
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            // 渲染文件内容
            let renderedContent;
            if (type === 'binary' || type === 'image') {
              // 二进制文件不渲染，直接复制
              renderedContent = fileContent;
            } else {
              renderedContent = this.render(fileContent, context);
            }

            // 写入文件
            await fs.writeFile(fullPath, renderedContent, 'utf-8');
            filesCreated.push(fullPath);

            console.log('[TemplateEngine] 文件已创建:', renderedPath);
          } catch (error) {
            console.error('[TemplateEngine] 文件创建失败:', error);
            errors.push({
              file: fileTemplate.path,
              message: error.message
            });
          }
        }
      }

      return {
        success: errors.length === 0,
        filesCreated: filesCreated.length,
        files: filesCreated,
        errors
      };
    } catch (error) {
      console.error('[TemplateEngine] 创建项目失败:', error);
      return {
        success: false,
        filesCreated: 0,
        errors: [{ message: error.message }]
      };
    }
  }

  /**
   * 预览模板渲染结果
   * @param {string} templateString - 模板字符串
   * @param {Object} variables - 变量
   * @returns {Object} { success: boolean, preview: string, error: string }
   */
  preview(templateString, variables) {
    try {
      const renderedContent = this.render(templateString, variables);
      return {
        success: true,
        preview: renderedContent
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 从文件加载模板
   * @param {string} templatePath - 模板文件路径
   * @returns {Promise<Object>} 模板对象
   */
  async loadTemplateFromFile(templatePath) {
    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[TemplateEngine] 加载模板失败:', error);
      throw new Error(`加载模板失败: ${error.message}`);
    }
  }

  /**
   * 保存模板到文件
   * @param {Object} template - 模板对象
   * @param {string} outputPath - 输出路径
   * @returns {Promise<void>}
   */
  async saveTemplateToFile(template, outputPath) {
    try {
      const content = JSON.stringify(template, null, 2);
      await fs.writeFile(outputPath, content, 'utf-8');
      console.log('[TemplateEngine] 模板已保存:', outputPath);
    } catch (error) {
      console.error('[TemplateEngine] 保存模板失败:', error);
      throw new Error(`保存模板失败: ${error.message}`);
    }
  }

  /**
   * 提取模板中的变量
   * @param {string} templateString - 模板字符串
   * @returns {Array<string>} 变量名数组
   */
  extractVariables(templateString) {
    const regex = /\{\{([^}]+)\}\}/g;
    const variables = new Set();
    let match;

    while ((match = regex.exec(templateString)) !== null) {
      const varName = match[1].trim();
      // 移除helpers和系统变量
      if (!varName.startsWith('_system') && !varName.includes(' ')) {
        variables.add(varName);
      }
    }

    return Array.from(variables);
  }

  /**
   * 获取变量的默认值
   * @param {Array} variableDefinitions - 变量定义数组
   * @returns {Object} 默认值对象
   */
  getDefaultVariables(variableDefinitions) {
    const defaults = {};

    if (!Array.isArray(variableDefinitions)) {
      return defaults;
    }

    for (const varDef of variableDefinitions) {
      if (varDef.default !== undefined) {
        // 如果default是字符串且包含{{}}，尝试渲染
        if (typeof varDef.default === 'string' && varDef.default.includes('{{')) {
          try {
            defaults[varDef.name] = this.render(varDef.default, {
              user: {
                name: process.env.USERNAME || process.env.USER || '用户'
              }
            });
          } catch {
            defaults[varDef.name] = varDef.default;
          }
        } else {
          defaults[varDef.name] = varDef.default;
        }
      } else {
        // 根据类型设置默认值
        switch (varDef.type) {
          case 'number':
            defaults[varDef.name] = 0;
            break;
          case 'checkbox':
            defaults[varDef.name] = [];
            break;
          case 'switch':
            defaults[varDef.name] = false;
            break;
          default:
            defaults[varDef.name] = '';
        }
      }
    }

    return defaults;
  }
}

// 单例模式
let templateEngineInstance = null;

/**
 * 获取模板引擎实例
 * @returns {TemplateEngine}
 */
function getTemplateEngine() {
  if (!templateEngineInstance) {
    templateEngineInstance = new TemplateEngine();
  }
  return templateEngineInstance;
}

module.exports = {
  TemplateEngine,
  getTemplateEngine
};
