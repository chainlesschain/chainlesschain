/**
 * TemplateActions - 预定义操作模板
 *
 * 提供常用操作的模板，简化自动化脚本编写：
 * - 表单填写
 * - 登录流程
 * - 搜索操作
 * - 文件下载
 * - 页面截图
 *
 * @module browser/actions/template-actions
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 模板类别
 */
const TemplateCategory = {
  FORM: 'form',
  AUTH: 'auth',
  SEARCH: 'search',
  NAVIGATION: 'navigation',
  DATA: 'data',
  UTILITY: 'utility'
};

/**
 * 内置模板
 */
const BUILTIN_TEMPLATES = {
  // 表单填写
  'form:fill': {
    name: '表单填写',
    category: TemplateCategory.FORM,
    description: '自动填写表单字段',
    parameters: {
      fields: { type: 'array', required: true, description: '字段列表 [{ selector, value, type }]' },
      submit: { type: 'boolean', default: false, description: '是否提交表单' },
      submitSelector: { type: 'string', description: '提交按钮选择器' }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const results = [];

      for (const field of params.fields) {
        try {
          const page = browserEngine.getPage(targetId);

          if (field.type === 'select') {
            await page.selectOption(field.selector, field.value);
          } else if (field.type === 'checkbox') {
            if (field.value) {
              await page.check(field.selector);
            } else {
              await page.uncheck(field.selector);
            }
          } else if (field.type === 'file') {
            await page.setInputFiles(field.selector, field.value);
          } else {
            await page.fill(field.selector, field.value);
          }

          results.push({ selector: field.selector, success: true });
        } catch (error) {
          results.push({ selector: field.selector, success: false, error: error.message });
        }
      }

      if (params.submit && params.submitSelector) {
        await browserEngine.getPage(targetId).click(params.submitSelector);
      }

      return {
        success: results.every(r => r.success),
        fieldsProcessed: results.length,
        results
      };
    }
  },

  // 登录
  'auth:login': {
    name: '用户登录',
    category: TemplateCategory.AUTH,
    description: '执行标准登录流程',
    parameters: {
      url: { type: 'string', description: '登录页面 URL' },
      usernameSelector: { type: 'string', default: 'input[name="username"], input[type="email"], #username, #email' },
      passwordSelector: { type: 'string', default: 'input[name="password"], input[type="password"], #password' },
      submitSelector: { type: 'string', default: 'button[type="submit"], input[type="submit"], .login-button' },
      username: { type: 'string', required: true },
      password: { type: 'string', required: true },
      waitForNavigation: { type: 'boolean', default: true },
      successIndicator: { type: 'string', description: '登录成功后的元素选择器' }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      // 导航到登录页
      if (params.url) {
        await browserEngine.navigate(targetId, params.url);
      }

      // 填写用户名
      await page.fill(params.usernameSelector, params.username);

      // 填写密码
      await page.fill(params.passwordSelector, params.password);

      // 点击登录
      if (params.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
          page.click(params.submitSelector)
        ]);
      } else {
        await page.click(params.submitSelector);
      }

      // 检查登录是否成功
      let loginSuccess = true;
      if (params.successIndicator) {
        try {
          await page.waitForSelector(params.successIndicator, { timeout: 5000 });
        } catch (e) {
          loginSuccess = false;
        }
      }

      return {
        success: loginSuccess,
        url: page.url()
      };
    }
  },

  // 搜索
  'search:query': {
    name: '搜索查询',
    category: TemplateCategory.SEARCH,
    description: '在搜索框中输入并搜索',
    parameters: {
      searchSelector: { type: 'string', default: 'input[type="search"], input[name="q"], input[name="query"], .search-input' },
      query: { type: 'string', required: true },
      submitMethod: { type: 'string', default: 'enter', enum: ['enter', 'click', 'none'] },
      submitSelector: { type: 'string', description: '搜索按钮选择器' },
      waitForResults: { type: 'boolean', default: true },
      resultsSelector: { type: 'string', description: '搜索结果容器选择器' }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      // 清空并输入搜索内容
      await page.fill(params.searchSelector, '');
      await page.fill(params.searchSelector, params.query);

      // 提交搜索
      if (params.submitMethod === 'enter') {
        await page.press(params.searchSelector, 'Enter');
      } else if (params.submitMethod === 'click' && params.submitSelector) {
        await page.click(params.submitSelector);
      }

      // 等待搜索结果
      if (params.waitForResults && params.resultsSelector) {
        await page.waitForSelector(params.resultsSelector, { timeout: 10000 });
      }

      return {
        success: true,
        query: params.query
      };
    }
  },

  // 页面截图
  'utility:screenshot': {
    name: '页面截图',
    category: TemplateCategory.UTILITY,
    description: '截取页面截图',
    parameters: {
      fullPage: { type: 'boolean', default: false },
      selector: { type: 'string', description: '截取特定元素' },
      format: { type: 'string', default: 'png', enum: ['png', 'jpeg'] },
      quality: { type: 'number', default: 80, description: 'JPEG 质量' }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;

      const options = {
        type: params.format,
        fullPage: params.fullPage
      };

      if (params.format === 'jpeg') {
        options.quality = params.quality;
      }

      let buffer;
      if (params.selector) {
        const page = browserEngine.getPage(targetId);
        const element = await page.$(params.selector);
        if (element) {
          buffer = await element.screenshot(options);
        } else {
          throw new Error(`Element not found: ${params.selector}`);
        }
      } else {
        buffer = await browserEngine.screenshot(targetId, options);
      }

      return {
        success: true,
        screenshot: buffer.toString('base64'),
        type: params.format,
        size: buffer.length
      };
    }
  },

  // 等待元素
  'utility:waitFor': {
    name: '等待元素',
    category: TemplateCategory.UTILITY,
    description: '等待元素出现或消失',
    parameters: {
      selector: { type: 'string', required: true },
      state: { type: 'string', default: 'visible', enum: ['visible', 'hidden', 'attached', 'detached'] },
      timeout: { type: 'number', default: 30000 }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      await page.waitForSelector(params.selector, {
        state: params.state,
        timeout: params.timeout
      });

      return {
        success: true,
        selector: params.selector,
        state: params.state
      };
    }
  },

  // 提取数据
  'data:extract': {
    name: '提取数据',
    category: TemplateCategory.DATA,
    description: '从页面提取数据',
    parameters: {
      selectors: { type: 'object', required: true, description: '选择器映射 { fieldName: selector }' },
      multiple: { type: 'boolean', default: false },
      attribute: { type: 'string', description: '提取属性而非文本' }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      const data = {};

      for (const [field, selector] of Object.entries(params.selectors)) {
        try {
          if (params.multiple) {
            const elements = await page.$$(selector);
            data[field] = await Promise.all(elements.map(async el => {
              if (params.attribute) {
                return el.getAttribute(params.attribute);
              }
              return el.textContent();
            }));
          } else {
            const element = await page.$(selector);
            if (element) {
              if (params.attribute) {
                data[field] = await element.getAttribute(params.attribute);
              } else {
                data[field] = await element.textContent();
              }
            }
          }
        } catch (error) {
          data[field] = null;
        }
      }

      return {
        success: true,
        data
      };
    }
  },

  // 滚动到底部
  'navigation:scrollToBottom': {
    name: '滚动到底部',
    category: TemplateCategory.NAVIGATION,
    description: '平滑滚动到页面底部',
    parameters: {
      stepDelay: { type: 'number', default: 100 },
      stepDistance: { type: 'number', default: 300 }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      let previousHeight = 0;
      let scrollCount = 0;
      const maxScrolls = 100;

      while (scrollCount < maxScrolls) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
          break;
        }

        await page.evaluate((distance) => {
          window.scrollBy(0, distance);
        }, params.stepDistance);

        await new Promise(resolve => setTimeout(resolve, params.stepDelay));

        previousHeight = currentHeight;
        scrollCount++;
      }

      return {
        success: true,
        scrollCount
      };
    }
  },

  // 点击所有匹配元素
  'utility:clickAll': {
    name: '点击所有匹配',
    category: TemplateCategory.UTILITY,
    description: '点击所有匹配选择器的元素',
    parameters: {
      selector: { type: 'string', required: true },
      delay: { type: 'number', default: 500, description: '每次点击之间的延迟' },
      maxClicks: { type: 'number', default: 10 }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      const elements = await page.$$(params.selector);
      const clickCount = Math.min(elements.length, params.maxClicks);

      for (let i = 0; i < clickCount; i++) {
        await elements[i].click();
        if (params.delay > 0 && i < clickCount - 1) {
          await new Promise(resolve => setTimeout(resolve, params.delay));
        }
      }

      return {
        success: true,
        clicked: clickCount,
        found: elements.length
      };
    }
  },

  // 文件下载
  'data:download': {
    name: '文件下载',
    category: TemplateCategory.DATA,
    description: '点击下载链接并等待下载完成',
    parameters: {
      selector: { type: 'string', required: true },
      timeout: { type: 'number', default: 30000 }
    },
    execute: async (context, params) => {
      const { browserEngine, targetId } = context;
      const page = browserEngine.getPage(targetId);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: params.timeout }),
        page.click(params.selector)
      ]);

      const path = await download.path();
      const suggestedFilename = download.suggestedFilename();

      return {
        success: true,
        filename: suggestedFilename,
        path
      };
    }
  }
};

class TemplateActions extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      ...config
    };

    // 模板库
    this.templates = new Map();

    // 加载内置模板
    this._loadBuiltinTemplates();
  }

  /**
   * 加载内置模板
   * @private
   */
  _loadBuiltinTemplates() {
    for (const [id, template] of Object.entries(BUILTIN_TEMPLATES)) {
      this.templates.set(id, {
        id,
        builtin: true,
        ...template
      });
    }
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 注册自定义模板
   * @param {string} id - 模板 ID
   * @param {Object} template - 模板定义
   */
  register(id, template) {
    if (this.templates.has(id) && this.templates.get(id).builtin) {
      throw new Error(`Cannot override builtin template: ${id}`);
    }

    this.templates.set(id, {
      id,
      builtin: false,
      ...template
    });

    this.emit('templateRegistered', { id });
  }

  /**
   * 注销模板
   * @param {string} id - 模板 ID
   */
  unregister(id) {
    const template = this.templates.get(id);

    if (!template) {
      return { success: false, error: 'Template not found' };
    }

    if (template.builtin) {
      throw new Error(`Cannot unregister builtin template: ${id}`);
    }

    this.templates.delete(id);

    this.emit('templateUnregistered', { id });

    return { success: true };
  }

  /**
   * 获取模板
   * @param {string} id - 模板 ID
   * @returns {Object}
   */
  get(id) {
    return this.templates.get(id);
  }

  /**
   * 列出模板
   * @param {string} category - 过滤类别
   * @returns {Array}
   */
  list(category = null) {
    const templates = Array.from(this.templates.values());

    if (category) {
      return templates.filter(t => t.category === category);
    }

    return templates.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      builtin: t.builtin
    }));
  }

  /**
   * 执行模板
   * @param {string} targetId - 标签页 ID
   * @param {string} templateId - 模板 ID
   * @param {Object} params - 参数
   * @returns {Promise<Object>}
   */
  async execute(targetId, templateId, params = {}) {
    const template = this.templates.get(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    if (!this.browserEngine) {
      throw new Error('Browser engine not set');
    }

    // 验证参数
    this._validateParams(template, params);

    // 合并默认值
    const mergedParams = this._mergeDefaults(template, params);

    // 执行上下文
    const context = {
      browserEngine: this.browserEngine,
      targetId,
      templateId
    };

    this.emit('executing', {
      templateId,
      targetId,
      params: mergedParams
    });

    try {
      const startTime = Date.now();
      const result = await template.execute(context, mergedParams);
      const duration = Date.now() - startTime;

      this.emit('executed', {
        templateId,
        targetId,
        success: true,
        duration,
        result
      });

      return {
        ...result,
        templateId,
        duration
      };

    } catch (error) {
      this.emit('executed', {
        templateId,
        targetId,
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 验证参数
   * @private
   */
  _validateParams(template, params) {
    if (!template.parameters) return;

    for (const [name, spec] of Object.entries(template.parameters)) {
      if (spec.required && params[name] === undefined) {
        throw new Error(`Missing required parameter: ${name}`);
      }

      if (params[name] !== undefined && spec.enum) {
        if (!spec.enum.includes(params[name])) {
          throw new Error(`Invalid value for ${name}: ${params[name]}. Must be one of: ${spec.enum.join(', ')}`);
        }
      }
    }
  }

  /**
   * 合并默认值
   * @private
   */
  _mergeDefaults(template, params) {
    const merged = { ...params };

    if (template.parameters) {
      for (const [name, spec] of Object.entries(template.parameters)) {
        if (merged[name] === undefined && spec.default !== undefined) {
          merged[name] = spec.default;
        }
      }
    }

    return merged;
  }

  /**
   * 创建模板实例
   * @param {string} templateId - 模板 ID
   * @param {Object} defaultParams - 默认参数
   * @returns {Function}
   */
  createInstance(templateId, defaultParams = {}) {
    const self = this;

    return async function(targetId, params = {}) {
      return self.execute(targetId, templateId, {
        ...defaultParams,
        ...params
      });
    };
  }

  /**
   * 批量执行模板
   * @param {string} targetId - 标签页 ID
   * @param {Array} steps - 步骤列表 [{ templateId, params }]
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async executeBatch(targetId, steps, options = {}) {
    const results = [];
    const stopOnError = options.stopOnError !== false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        const result = await this.execute(targetId, step.templateId, step.params);
        results.push({
          index: i,
          templateId: step.templateId,
          success: true,
          result
        });

        // 步骤间延迟
        if (options.delay && i < steps.length - 1) {
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }

      } catch (error) {
        results.push({
          index: i,
          templateId: step.templateId,
          success: false,
          error: error.message
        });

        if (stopOnError) {
          break;
        }
      }
    }

    return {
      success: results.every(r => r.success),
      stepsExecuted: results.length,
      stepsFailed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * 获取模板参数规范
   * @param {string} templateId - 模板 ID
   * @returns {Object}
   */
  getParameterSpec(templateId) {
    const template = this.templates.get(templateId);

    if (!template) {
      return null;
    }

    return template.parameters || {};
  }
}

// 单例
let templateActionsInstance = null;

function getTemplateActions(browserEngine, config) {
  if (!templateActionsInstance) {
    templateActionsInstance = new TemplateActions(browserEngine, config);
  } else if (browserEngine) {
    templateActionsInstance.setBrowserEngine(browserEngine);
  }
  return templateActionsInstance;
}

module.exports = {
  TemplateActions,
  TemplateCategory,
  getTemplateActions
};
