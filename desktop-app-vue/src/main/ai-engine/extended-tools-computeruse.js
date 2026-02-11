/**
 * Computer Use 扩展工具
 * 让 AI 可以通过 Function Calling 调用电脑操作能力
 *
 * @module ai-engine/extended-tools-computeruse
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { logger } = require('../utils/logger');
const { ComputerUseToolExecutor } = require('./tools/computer-use-tools');

// 单例执行器
let toolExecutor = null;

/**
 * 获取工具执行器
 * @returns {ComputerUseToolExecutor}
 */
function getToolExecutor() {
  if (!toolExecutor) {
    toolExecutor = new ComputerUseToolExecutor();
  }
  return toolExecutor;
}

/**
 * 设置浏览器引擎
 * @param {Object} browserEngine
 */
function setBrowserEngine(browserEngine) {
  getToolExecutor().setBrowserEngine(browserEngine);
}

/**
 * 设置 LLM 服务
 * @param {Object} llmService
 */
function setLLMService(llmService) {
  getToolExecutor().setLLMService(llmService);
}

/**
 * 设置当前操作的标签页
 * @param {string} targetId
 */
function setCurrentTarget(targetId) {
  getToolExecutor().setCurrentTarget(targetId);
}

/**
 * Computer Use 工具定义
 */
const ComputerUseExtendedTools = {
  /**
   * 浏览器坐标点击
   */
  browser_click: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_click', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_click failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_click',
      description: '在浏览器页面的指定坐标位置点击。用于点击页面上的按钮、链接或其他元素。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X 坐标（像素）' },
          y: { type: 'number', description: 'Y 坐标（像素）' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按钮' },
          clickCount: { type: 'number', description: '点击次数' }
        },
        required: ['x', 'y']
      }
    }
  },

  /**
   * 视觉点击
   */
  visual_click: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        if (!executor.llmService) {
          return { success: false, error: 'LLM 服务未配置，无法使用视觉功能' };
        }
        return await executor.execute('visual_click', params);
      } catch (error) {
        logger.error('[ComputerUse] visual_click failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'visual_click',
      description: '根据元素的视觉描述找到并点击元素。使用 Vision AI 定位元素。例如"红色的登录按钮"、"搜索框"。',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '元素的视觉描述' }
        },
        required: ['description']
      }
    }
  },

  /**
   * 浏览器键盘输入
   */
  browser_type: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_type', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_type failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_type',
      description: '在当前聚焦的输入框中输入文本。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的文本内容' }
        },
        required: ['text']
      }
    }
  },

  /**
   * 浏览器按键
   */
  browser_key: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_key', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_key failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_key',
      description: '按下键盘按键或快捷键组合。例如 Enter, Tab, Escape, 或 Ctrl+C。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '按键名称' },
          modifiers: {
            type: 'array',
            items: { type: 'string' },
            description: '修饰键数组，如 ["control"], ["control", "shift"]'
          }
        },
        required: ['key']
      }
    }
  },

  /**
   * 浏览器滚动
   */
  browser_scroll: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_scroll', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_scroll failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_scroll',
      description: '在浏览器页面中滚动。',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向' },
          amount: { type: 'number', description: '滚动距离（像素）' }
        },
        required: ['direction']
      }
    }
  },

  /**
   * 浏览器截图
   */
  browser_screenshot: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        const result = await executor.execute('browser_screenshot', params);
        // 截图数据可能很大，只返回成功状态和大小
        if (result.success) {
          return {
            success: true,
            message: '截图成功',
            size: result.screenshot?.length || 0,
            type: result.type
          };
        }
        return result;
      } catch (error) {
        logger.error('[ComputerUse] browser_screenshot failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_screenshot',
      description: '截取当前浏览器页面的屏幕截图。',
      parameters: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: '是否截取整个页面' }
        }
      }
    }
  },

  /**
   * 页面分析
   */
  analyze_page: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        if (!executor.llmService) {
          return { success: false, error: 'LLM 服务未配置' };
        }
        return await executor.execute('analyze_page', params);
      } catch (error) {
        logger.error('[ComputerUse] analyze_page failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'analyze_page',
      description: '使用 Vision AI 分析当前页面内容，理解页面结构和可交互元素。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '分析提示' }
        }
      }
    }
  },

  /**
   * 浏览器导航
   */
  browser_navigate: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_navigate', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_navigate failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_navigate',
      description: '导航到指定 URL。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标 URL' }
        },
        required: ['url']
      }
    }
  },

  /**
   * 浏览器等待
   */
  browser_wait: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        if (!executor.browserEngine) {
          return { success: false, error: '浏览器引擎未初始化' };
        }
        return await executor.execute('browser_wait', params);
      } catch (error) {
        logger.error('[ComputerUse] browser_wait failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'browser_wait',
      description: '等待指定时间或等待元素出现。',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: '等待时间（毫秒）' },
          selector: { type: 'string', description: 'CSS 选择器' }
        }
      }
    }
  },

  /**
   * 桌面截图
   */
  desktop_screenshot: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        const result = await executor.execute('desktop_screenshot', params);
        if (result.success) {
          return {
            success: true,
            message: '桌面截图成功',
            size: result.base64?.length || 0
          };
        }
        return result;
      } catch (error) {
        logger.error('[ComputerUse] desktop_screenshot failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'desktop_screenshot',
      description: '截取整个桌面屏幕。',
      parameters: {
        type: 'object',
        properties: {
          displayId: { type: 'number', description: '显示器 ID' }
        }
      }
    }
  },

  /**
   * 桌面点击
   */
  desktop_click: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        return await executor.execute('desktop_click', params);
      } catch (error) {
        logger.error('[ComputerUse] desktop_click failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'desktop_click',
      description: '在桌面上的指定坐标点击（可以操作任何应用程序）。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X 坐标' },
          y: { type: 'number', description: 'Y 坐标' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按钮' },
          double: { type: 'boolean', description: '是否双击' }
        },
        required: ['x', 'y']
      }
    }
  },

  /**
   * 桌面输入
   */
  desktop_type: {
    handler: async (params, context) => {
      try {
        const executor = getToolExecutor();
        return await executor.execute('desktop_type', params);
      } catch (error) {
        logger.error('[ComputerUse] desktop_type failed:', error);
        return { success: false, error: error.message };
      }
    },
    schema: {
      name: 'desktop_type',
      description: '在桌面上输入文本（在当前聚焦的应用程序中）。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的文本' }
        },
        required: ['text']
      }
    }
  }
};

/**
 * 获取 Computer Use 工具列表
 * @returns {Object}
 */
function getComputerUseTools() {
  return ComputerUseExtendedTools;
}

/**
 * 注册 Computer Use 工具到 FunctionCaller
 * @param {FunctionCaller} functionCaller
 */
function registerComputerUseTools(functionCaller) {
  for (const [name, tool] of Object.entries(ComputerUseExtendedTools)) {
    functionCaller.registerTool(name, tool.handler, tool.schema);
    logger.debug(`[ComputerUse] 注册工具: ${name}`);
  }
  logger.info(`[ComputerUse] 已注册 ${Object.keys(ComputerUseExtendedTools).length} 个工具`);
}

module.exports = {
  getComputerUseTools,
  registerComputerUseTools,
  getToolExecutor,
  setBrowserEngine,
  setLLMService,
  setCurrentTarget
};
