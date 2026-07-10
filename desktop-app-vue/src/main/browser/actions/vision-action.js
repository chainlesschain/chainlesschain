/**
 * VisionAction - Vision AI 集成（类似 Claude Computer Use 的视觉能力）
 *
 * 支持：
 * - 截图 → Vision LLM 分析
 * - 视觉元素定位（"点击红色按钮"）
 * - 图像相似度匹配
 * - 视觉反馈循环
 *
 * @module browser/actions/vision-action
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");
const path = require("path");
const { looseParseJSON } = require("../../ai-engine/response-parser.js");
const { imageToViewport } = require("./coordinate-mapping.js");

/**
 * 支持的 Vision 模型
 */
const VisionModel = {
  CLAUDE_VISION: "claude-sonnet-4-6", // Claude Sonnet 4.6 (Vision)
  CLAUDE_OPUS: "claude-opus-4-8",
  GPT4_VISION: "gpt-4o", // gpt-4-vision-preview was retired; gpt-4o is multimodal
  GPT4O: "gpt-4o",
  LLAVA: "llava:13b", // 本地 Ollama
};

/**
 * 视觉任务类型
 */
const VisionTaskType = {
  ANALYZE: "analyze", // 分析页面内容
  LOCATE_ELEMENT: "locate", // 定位元素
  COMPARE: "compare", // 对比截图
  OCR: "ocr", // 文字识别
  DESCRIBE: "describe", // 描述页面
  FIND_CLICK_TARGET: "click", // 找到点击目标
};

class VisionAction extends EventEmitter {
  constructor(browserEngine, llmService = null) {
    super();
    this.engine = browserEngine;
    this.llmService = llmService;

    // Vision 配置
    this.config = {
      defaultModel: VisionModel.CLAUDE_VISION,
      maxTokens: 4096,
      temperature: 0.1,
      screenshotQuality: 80,
      maxImageSize: 1024 * 1024 * 4, // 4MB
    };

    // 缓存最近的分析结果
    this.analysisCache = new Map();
    this.cacheMaxAge = 30000; // 30秒
  }

  /**
   * 设置 LLM 服务
   * @param {Object} llmService - LLM 服务实例
   */
  setLLMService(llmService) {
    this.llmService = llmService;
  }

  /**
   * 获取页面对象
   * @private
   */
  _getPage(targetId) {
    return this.engine.getPage(targetId);
  }

  /**
   * 截取页面截图并转为 base64
   * @private
   */
  async _captureScreenshot(targetId, options = {}) {
    const page = this._getPage(targetId);

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: options.quality || this.config.screenshotQuality,
      fullPage: options.fullPage || false,
      clip: options.clip,
    });

    return buffer.toString("base64");
  }

  /**
   * The page's devicePixelRatio — the screenshot is captured at this scale, so
   * screenshot pixel dims = CSS dims × dsf. Defaults to 1 when the page can't
   * be queried (keeps the dsf=1 common case identical).
   * @private
   */
  async _getDeviceScaleFactor(page) {
    try {
      if (typeof page.evaluate !== "function") {
        return 1;
      }
      const dsf = await page.evaluate(() => window.devicePixelRatio);
      return Number.isFinite(dsf) && dsf > 0 ? dsf : 1;
    } catch {
      return 1;
    }
  }

  /**
   * 构建 Vision API 消息
   * @private
   */
  _buildVisionMessage(prompt, imageBase64, options = {}) {
    const model = options.model || this.config.defaultModel;

    // Claude 格式
    if (model.startsWith("claude")) {
      return {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      };
    }

    // OpenAI 格式
    if (model.startsWith("gpt")) {
      return {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: options.detail || "high",
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      };
    }

    // 默认格式（Ollama/LLaVA）
    return {
      role: "user",
      content: prompt,
      images: [imageBase64],
    };
  }

  /**
   * 调用 Vision LLM
   * @private
   */
  async _callVisionLLM(messages, options = {}) {
    if (!this.llmService) {
      throw new Error(
        "LLM Service not configured. Please set LLM service first.",
      );
    }

    const model = options.model || this.config.defaultModel;

    try {
      const response = await this.llmService.chat(messages, {
        model,
        max_tokens: options.maxTokens || this.config.maxTokens,
        temperature: options.temperature ?? this.config.temperature,
      });

      return response.text || response.message?.content || "";
    } catch (error) {
      throw new Error(`Vision LLM call failed: ${error.message}`);
    }
  }

  /**
   * 分析页面截图
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 分析提示
   * @param {Object} options - 分析选项
   * @returns {Promise<Object>}
   */
  async analyze(targetId, prompt, options = {}) {
    // 检查缓存
    const cacheKey = `${targetId}:${prompt}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.result;
    }

    const imageBase64 = await this._captureScreenshot(targetId, options);
    const message = this._buildVisionMessage(prompt, imageBase64, options);

    const systemPrompt = `You are a visual analysis assistant. Analyze the webpage screenshot and respond to the user's query.
Be precise and concise. If asked about element locations, describe them relative to the viewport.
For UI elements, describe their visual appearance, position, and any text they contain.`;

    const response = await this._callVisionLLM(
      [{ role: "system", content: systemPrompt }, message],
      options,
    );

    const result = {
      success: true,
      analysis: response,
      timestamp: Date.now(),
    };

    // 缓存结果
    this.analysisCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });

    this.emit("analyzed", { targetId, prompt, analysis: response });

    return result;
  }

  /**
   * 定位页面元素（视觉定位）
   * @param {string} targetId - 标签页 ID
   * @param {string} description - 元素描述（如"红色的登录按钮"）
   * @param {Object} options - 定位选项
   * @returns {Promise<Object>}
   */
  async locateElement(targetId, description, options = {}) {
    const page = this._getPage(targetId);
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const fullPage = options.fullPage || false;
    const deviceScaleFactor = await this._getDeviceScaleFactor(page);
    const imageBase64 = await this._captureScreenshot(targetId, options);

    // Tell the model the ACTUAL pixel dimensions of the image it is looking at,
    // not the CSS viewport size. The screenshot is captured at devicePixelRatio
    // (and, for fullPage, spans the whole scroll height), so those spaces
    // differ whenever dsf ≠ 1 or fullPage is set — the exact cases where the
    // old "coordinates relative to the viewport" prompt made the model return
    // numbers that visualClick then misapplied. At dsf=1, non-fullPage the
    // numbers are identical to the viewport, so the common case is unchanged.
    const imageDims = await this._imageDimensions(page, {
      viewport,
      deviceScaleFactor,
      fullPage,
    });

    const prompt = `I need to locate an element on this webpage screenshot.
Element description: "${description}"

Please analyze the screenshot and provide the element's position.
Respond in JSON format:
{
  "found": true/false,
  "confidence": 0.0-1.0,
  "element": {
    "x": pixel_x_coordinate,
    "y": pixel_y_coordinate,
    "width": estimated_width,
    "height": estimated_height,
    "description": "brief description of the element"
  },
  "alternatives": [] // other possible matches if confidence < 0.8
}

The screenshot image is ${imageDims.width}x${imageDims.height} pixels.
Provide coordinates in image pixels relative to its top-left corner.`;

    const message = this._buildVisionMessage(prompt, imageBase64, options);

    const response = await this._callVisionLLM(
      [
        {
          role: "system",
          content:
            "You are a precise UI element locator. Always respond with valid JSON only.",
        },
        message,
      ],
      options,
    );

    // 解析 JSON 响应
    let result;
    try {
      // 提取 JSON
      result = looseParseJSON(response);
    } catch (e) {
      result = {
        found: false,
        confidence: 0,
        error: "Failed to parse element location",
        rawResponse: response,
      };
    }

    this.emit("elementLocated", { targetId, description, result });

    return {
      success: result.found,
      ...result,
      // The coordinate space the returned x/y live in — visualClick uses this
      // to map image pixels → viewport CSS pixels before clicking.
      coordinateSpace: {
        image: imageDims,
        viewport,
        deviceScaleFactor,
        fullPage,
      },
    };
  }

  /**
   * Pixel dimensions of the screenshot the model will see.
   * @private
   */
  async _imageDimensions(page, { viewport, deviceScaleFactor, fullPage }) {
    if (!fullPage) {
      return {
        width: Math.round(viewport.width * deviceScaleFactor),
        height: Math.round(viewport.height * deviceScaleFactor),
      };
    }
    // fullPage spans the whole scroll size × dsf.
    let scroll = { width: viewport.width, height: viewport.height };
    try {
      if (typeof page.evaluate === "function") {
        scroll = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }));
      }
    } catch {
      /* fall back to viewport */
    }
    return {
      width: Math.round(scroll.width * deviceScaleFactor),
      height: Math.round(scroll.height * deviceScaleFactor),
    };
  }

  /**
   * 视觉引导点击（找到元素并点击）
   * @param {string} targetId - 标签页 ID
   * @param {string} description - 元素描述
   * @param {Object} options - 点击选项
   * @returns {Promise<Object>}
   */
  async visualClick(targetId, description, options = {}) {
    // 首先定位元素
    const location = await this.locateElement(targetId, description, options);

    if (!location.success || !location.element) {
      return {
        success: false,
        error: `Could not locate element: "${description}"`,
        location,
      };
    }

    const { x, y, width, height } = location.element;

    // Element centre, still in IMAGE pixel space (what the model returned).
    const imageCenterX = x + (width || 0) / 2;
    const imageCenterY = y + (height || 0) / 2;

    const page = this._getPage(targetId);

    // Map image pixels → viewport CSS pixels. At dsf=1, non-fullPage this is
    // the identity, so the historical behavior is preserved; at dsf≠1 it
    // divides out the devicePixelRatio, and for a fullPage shot it yields a
    // PAGE coordinate that we must scroll into view before clicking (mouse is
    // viewport-relative — the old code clicked the raw page-y and missed
    // everything below the fold).
    const space = location.coordinateSpace || {};
    const mapped = imageToViewport({
      imageX: imageCenterX,
      imageY: imageCenterY,
      deviceScaleFactor: space.deviceScaleFactor || 1,
      fullPage: space.fullPage || false,
    });

    let clickX;
    let clickY;
    if (mapped.needsScroll) {
      const scrolled = await this._scrollPagePointIntoView(
        page,
        mapped.pageX,
        mapped.pageY,
        space.viewport || page.viewportSize() || { width: 1280, height: 720 },
      );
      clickX = scrolled.viewportX;
      clickY = scrolled.viewportY;
    } else {
      clickX = mapped.x;
      clickY = mapped.y;
    }

    try {
      await page.mouse.click(clickX, clickY, {
        button: options.button || "left",
        clickCount: options.clickCount || 1,
        delay: options.delay || 0,
      });

      // 等待页面响应
      if (options.waitAfterClick) {
        await page.waitForLoadState("networkidle", {
          timeout: options.waitAfterClick,
        });
      }

      this.emit("visualClicked", {
        targetId,
        description,
        x: clickX,
        y: clickY,
      });

      return {
        success: true,
        action: "visualClick",
        description,
        clickedAt: { x: clickX, y: clickY },
        confidence: location.confidence,
      };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error.message}`,
        location,
      };
    }
  }

  /**
   * Scroll a PAGE point (fullPage screenshot space) so it lands inside the
   * viewport, and return the resulting viewport-relative coordinate for
   * page.mouse.click. Falls back to the raw page point if the page can't be
   * scripted (best-effort, same as before but no longer silently off-screen).
   * @private
   */
  async _scrollPagePointIntoView(page, pageX, pageY, viewport) {
    if (typeof page.evaluate !== "function") {
      return { viewportX: pageX, viewportY: pageY };
    }
    try {
      const scroll = await page.evaluate(
        ({ px, py, vw, vh }) => {
          const targetLeft = Math.max(0, px - vw / 2);
          const targetTop = Math.max(0, py - vh / 2);
          window.scrollTo(targetLeft, targetTop);
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        },
        { px: pageX, py: pageY, vw: viewport.width, vh: viewport.height },
      );
      return {
        viewportX: pageX - scroll.scrollX,
        viewportY: pageY - scroll.scrollY,
      };
    } catch {
      return { viewportX: pageX, viewportY: pageY };
    }
  }

  /**
   * 描述页面内容
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 描述选项
   * @returns {Promise<Object>}
   */
  async describePage(targetId, options = {}) {
    const prompt =
      options.prompt ||
      `Describe this webpage in detail:
1. What is the main purpose of this page?
2. What are the key UI elements visible?
3. What actions can a user take on this page?
4. Are there any forms, buttons, or interactive elements?
5. What is the current state of the page (loading, error, success, etc.)?

Be thorough but concise.`;

    return this.analyze(targetId, prompt, options);
  }

  /**
   * 比较两个截图
   * @param {string} targetId - 标签页 ID
   * @param {string} baselineBase64 - 基线截图 base64
   * @param {Object} options - 比较选项
   * @returns {Promise<Object>}
   */
  async compareWithBaseline(targetId, baselineBase64, options = {}) {
    const currentBase64 = await this._captureScreenshot(targetId, options);

    const prompt = `Compare these two webpage screenshots.
The first image is the baseline (expected state).
The second image is the current state.

Analyze the differences:
1. Are there any visible UI changes?
2. Are there any content differences (text, images)?
3. Are there any layout changes?
4. Rate the overall similarity (0-100%)

Respond in JSON format:
{
  "similarity": 0-100,
  "hasChanges": true/false,
  "changes": [
    { "type": "ui|content|layout", "description": "...", "severity": "minor|major|critical" }
  ],
  "summary": "brief summary of differences"
}`;

    // 构建多图消息
    const model = options.model || this.config.defaultModel;
    let messages;

    if (model.startsWith("claude")) {
      messages = [
        {
          role: "system",
          content:
            "You are a visual regression testing assistant. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: baselineBase64,
              },
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: currentBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ];
    } else {
      messages = [
        {
          role: "system",
          content:
            "You are a visual regression testing assistant. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${baselineBase64}` },
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${currentBase64}` },
            },
            { type: "text", text: prompt },
          ],
        },
      ];
    }

    const response = await this._callVisionLLM(messages, options);

    let result;
    try {
      result = looseParseJSON(response);
    } catch (e) {
      result = {
        similarity: 0,
        hasChanges: true,
        error: "Failed to parse comparison result",
        rawResponse: response,
      };
    }

    this.emit("compared", { targetId, result });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * 执行多步视觉任务
   * @param {string} targetId - 标签页 ID
   * @param {string} task - 任务描述
   * @param {Object} options - 任务选项
   * @returns {Promise<Object>}
   */
  async executeVisualTask(targetId, task, options = {}) {
    const maxSteps = options.maxSteps || 10;
    const steps = [];
    let completed = false;

    for (let i = 0; i < maxSteps && !completed; i++) {
      const imageBase64 = await this._captureScreenshot(targetId, options);

      const previousSteps = steps
        .map((s, idx) => `Step ${idx + 1}: ${s.action} - ${s.result}`)
        .join("\n");

      const prompt = `You are an AI assistant helping to complete a task on this webpage.

Task: "${task}"

${previousSteps ? `Previous steps:\n${previousSteps}\n` : ""}

Analyze the current screenshot and determine the next action.
Respond in JSON format:
{
  "completed": true/false,
  "action": "click|type|scroll|wait|done",
  "target": "description of the element to interact with",
  "value": "text to type (if action is type)",
  "coordinates": { "x": number, "y": number } (if known),
  "reasoning": "why this action"
}`;

      const message = this._buildVisionMessage(prompt, imageBase64, options);
      const response = await this._callVisionLLM(
        [
          {
            role: "system",
            content:
              "You are a visual task automation assistant. Always respond with valid JSON only.",
          },
          message,
        ],
        options,
      );

      let stepResult;
      try {
        stepResult = looseParseJSON(response);
      } catch (e) {
        stepResult = {
          completed: false,
          action: "error",
          reasoning: "Failed to parse step",
          error: response,
        };
      }

      steps.push(stepResult);

      if (stepResult.completed || stepResult.action === "done") {
        completed = true;
        break;
      }

      // 执行动作
      if (stepResult.action === "click" && stepResult.target) {
        await this.visualClick(targetId, stepResult.target, options);
        stepResult.result = "Clicked";
      } else if (stepResult.action === "type" && stepResult.value) {
        const page = this._getPage(targetId);
        await page.keyboard.type(stepResult.value);
        stepResult.result = "Typed";
      } else if (stepResult.action === "scroll") {
        const page = this._getPage(targetId);
        await page.mouse.wheel(0, 300);
        stepResult.result = "Scrolled";
      } else if (stepResult.action === "wait") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        stepResult.result = "Waited";
      }

      // 短暂等待页面响应
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.emit("taskCompleted", { targetId, task, steps, completed });

    return {
      success: completed,
      task,
      steps,
      totalSteps: steps.length,
    };
  }

  /**
   * 清除分析缓存
   */
  clearCache() {
    this.analysisCache.clear();
  }

  /**
   * 统一执行入口
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>}
   */
  async execute(targetId, options = {}) {
    const { task } = options;

    switch (task) {
      case VisionTaskType.ANALYZE:
        return this.analyze(targetId, options.prompt, options);

      case VisionTaskType.LOCATE_ELEMENT:
        return this.locateElement(targetId, options.description, options);

      case VisionTaskType.FIND_CLICK_TARGET:
        return this.visualClick(targetId, options.description, options);

      case VisionTaskType.DESCRIBE:
        return this.describePage(targetId, options);

      case VisionTaskType.COMPARE:
        return this.compareWithBaseline(targetId, options.baseline, options);

      default:
        if (options.task && typeof options.task === "string") {
          return this.executeVisualTask(targetId, options.task, options);
        }
        throw new Error(`Unknown vision task: ${task}`);
    }
  }
}

module.exports = {
  VisionAction,
  VisionModel,
  VisionTaskType,
};
