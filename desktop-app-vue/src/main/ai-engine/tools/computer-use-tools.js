/**
 * Computer Use 工具定义
 * 让 AI 可以调用电脑操作能力
 *
 * @module ai-engine/tools/computer-use-tools
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { logger } = require('../../utils/logger');

/**
 * Computer Use 工具集
 * 符合 OpenAI Function Calling / Claude Tool Use 格式
 */
const ComputerUseTools = {
  /**
   * 浏览器坐标点击
   */
  browser_click: {
    name: 'browser_click',
    description: '在浏览器页面的指定坐标位置点击。用于点击页面上的按钮、链接或其他元素。',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X 坐标（像素）'
        },
        y: {
          type: 'number',
          description: 'Y 坐标（像素）'
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: '鼠标按钮，默认 left'
        },
        clickCount: {
          type: 'number',
          description: '点击次数，1=单击，2=双击'
        }
      },
      required: ['x', 'y']
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 视觉点击
   */
  visual_click: {
    name: 'visual_click',
    description: '根据元素的视觉描述找到并点击元素。例如"红色的登录按钮"、"搜索框"。使用 Vision AI 定位元素。',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: '元素的视觉描述，例如"蓝色的提交按钮"、"用户名输入框"'
        }
      },
      required: ['description']
    },
    category: 'computer_use',
    requiresTarget: true,
    requiresVision: true
  },

  /**
   * 键盘输入
   */
  browser_type: {
    name: 'browser_type',
    description: '在当前聚焦的输入框中输入文本。',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要输入的文本内容'
        }
      },
      required: ['text']
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 按键操作
   */
  browser_key: {
    name: 'browser_key',
    description: '按下键盘按键或快捷键组合。',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '按键名称，如 enter, tab, escape, backspace, 或字母/数字'
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: '修饰键数组，如 ["control"], ["control", "shift"]'
        }
      },
      required: ['key']
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 滚动操作
   */
  browser_scroll: {
    name: 'browser_scroll',
    description: '在浏览器页面中滚动。',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: '滚动方向'
        },
        amount: {
          type: 'number',
          description: '滚动距离（像素），默认 300'
        },
        x: {
          type: 'number',
          description: '滚动位置 X 坐标（可选）'
        },
        y: {
          type: 'number',
          description: '滚动位置 Y 坐标（可选）'
        }
      },
      required: ['direction']
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 截图
   */
  browser_screenshot: {
    name: 'browser_screenshot',
    description: '截取当前浏览器页面的屏幕截图。',
    parameters: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          description: '是否截取整个页面（包括滚动区域）'
        }
      }
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 页面分析
   */
  analyze_page: {
    name: 'analyze_page',
    description: '使用 Vision AI 分析当前页面内容，理解页面结构和可交互元素。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '分析提示，描述需要了解的内容'
        }
      }
    },
    category: 'computer_use',
    requiresTarget: true,
    requiresVision: true
  },

  /**
   * 导航
   */
  browser_navigate: {
    name: 'browser_navigate',
    description: '导航到指定 URL。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '目标 URL'
        }
      },
      required: ['url']
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 等待
   */
  browser_wait: {
    name: 'browser_wait',
    description: '等待指定时间或等待元素出现。',
    parameters: {
      type: 'object',
      properties: {
        duration: {
          type: 'number',
          description: '等待时间（毫秒）'
        },
        selector: {
          type: 'string',
          description: 'CSS 选择器，等待该元素出现'
        }
      }
    },
    category: 'computer_use',
    requiresTarget: true
  },

  /**
   * 桌面截图
   */
  desktop_screenshot: {
    name: 'desktop_screenshot',
    description: '截取整个桌面屏幕。',
    parameters: {
      type: 'object',
      properties: {
        displayId: {
          type: 'number',
          description: '显示器 ID（多显示器时使用）'
        }
      }
    },
    category: 'computer_use',
    requiresDesktop: true
  },

  /**
   * 桌面点击
   */
  desktop_click: {
    name: 'desktop_click',
    description: '在桌面上的指定坐标点击（可以操作任何应用程序）。',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X 坐标'
        },
        y: {
          type: 'number',
          description: 'Y 坐标'
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: '鼠标按钮'
        },
        double: {
          type: 'boolean',
          description: '是否双击'
        }
      },
      required: ['x', 'y']
    },
    category: 'computer_use',
    requiresDesktop: true
  },

  /**
   * 桌面输入
   */
  desktop_type: {
    name: 'desktop_type',
    description: '在桌面上输入文本（在当前聚焦的应用程序中）。',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要输入的文本'
        }
      },
      required: ['text']
    },
    category: 'computer_use',
    requiresDesktop: true
  }
};

/**
 * 工具执行器
 */
class ComputerUseToolExecutor {
  constructor(browserEngine = null, llmService = null) {
    this.browserEngine = browserEngine;
    this.llmService = llmService;
    this.currentTargetId = null;
  }

  /**
   * 设置浏览器引擎
   */
  setBrowserEngine(engine) {
    this.browserEngine = engine;
  }

  /**
   * 设置 LLM 服务
   */
  setLLMService(service) {
    this.llmService = service;
  }

  /**
   * 设置当前操作的标签页
   */
  setCurrentTarget(targetId) {
    this.currentTargetId = targetId;
  }

  /**
   * 执行工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @returns {Promise<Object>}
   */
  async execute(toolName, params = {}) {
    const tool = ComputerUseTools[toolName];
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    logger.info(`[ComputerUseTools] Executing ${toolName}`, params);

    try {
      switch (toolName) {
        case 'browser_click':
          return this._browserClick(params);

        case 'visual_click':
          return this._visualClick(params);

        case 'browser_type':
          return this._browserType(params);

        case 'browser_key':
          return this._browserKey(params);

        case 'browser_scroll':
          return this._browserScroll(params);

        case 'browser_screenshot':
          return this._browserScreenshot(params);

        case 'analyze_page':
          return this._analyzePage(params);

        case 'browser_navigate':
          return this._browserNavigate(params);

        case 'browser_wait':
          return this._browserWait(params);

        case 'desktop_screenshot':
          return this._desktopScreenshot(params);

        case 'desktop_click':
          return this._desktopClick(params);

        case 'desktop_type':
          return this._desktopType(params);

        default:
          throw new Error(`Tool ${toolName} not implemented`);
      }
    } catch (error) {
      logger.error(`[ComputerUseTools] ${toolName} failed:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async _browserClick(params) {
    const { CoordinateAction } = require('../../browser/actions');
    const action = new CoordinateAction(this.browserEngine);
    return action.clickAt(this.currentTargetId, params.x, params.y, {
      button: params.button || 'left',
      clickCount: params.clickCount || 1
    });
  }

  async _visualClick(params) {
    const { VisionAction } = require('../../browser/actions');
    const action = new VisionAction(this.browserEngine, this.llmService);
    return action.visualClick(this.currentTargetId, params.description);
  }

  async _browserType(params) {
    const page = this.browserEngine.getPage(this.currentTargetId);
    await page.keyboard.type(params.text);
    return { success: true, typed: params.text };
  }

  async _browserKey(params) {
    const { KeyboardAction } = require('../../browser/actions');
    const action = new KeyboardAction(this.browserEngine);
    return action.execute(this.currentTargetId, {
      type: 'key',
      key: params.key,
      modifiers: params.modifiers || []
    });
  }

  async _browserScroll(params) {
    const { ScrollAction } = require('../../browser/actions');
    const action = new ScrollAction(this.browserEngine);
    return action.execute(this.currentTargetId, {
      direction: params.direction,
      amount: params.amount || 300
    });
  }

  async _browserScreenshot(params) {
    const buffer = await this.browserEngine.screenshot(this.currentTargetId, {
      fullPage: params.fullPage || false
    });
    return {
      success: true,
      screenshot: buffer.toString('base64'),
      type: 'png'
    };
  }

  async _analyzePage(params) {
    const { VisionAction } = require('../../browser/actions');
    const action = new VisionAction(this.browserEngine, this.llmService);
    return action.analyze(this.currentTargetId, params.prompt || 'Describe this page');
  }

  async _browserNavigate(params) {
    return this.browserEngine.navigate(this.currentTargetId, params.url);
  }

  async _browserWait(params) {
    if (params.selector) {
      const page = this.browserEngine.getPage(this.currentTargetId);
      await page.waitForSelector(params.selector, { timeout: 30000 });
    } else {
      await new Promise(resolve => setTimeout(resolve, params.duration || 1000));
    }
    return { success: true };
  }

  async _desktopScreenshot(params) {
    const { DesktopAction } = require('../../browser/actions');
    const action = new DesktopAction();
    return action.captureScreen(params);
  }

  async _desktopClick(params) {
    const { DesktopAction } = require('../../browser/actions');
    const action = new DesktopAction();
    return action.click(params.x, params.y, {
      button: params.button || 'left',
      double: params.double || false
    });
  }

  async _desktopType(params) {
    const { DesktopAction } = require('../../browser/actions');
    const action = new DesktopAction();
    return action.typeText(params.text);
  }

  /**
   * 获取所有工具定义
   * @returns {Array}
   */
  static getToolDefinitions() {
    return Object.values(ComputerUseTools);
  }

  /**
   * 获取工具定义（OpenAI 格式）
   * @returns {Array}
   */
  static getOpenAITools() {
    return Object.values(ComputerUseTools).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * 获取工具定义（Claude 格式）
   * @returns {Array}
   */
  static getClaudeTools() {
    return Object.values(ComputerUseTools).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }
}

module.exports = {
  ComputerUseTools,
  ComputerUseToolExecutor
};
