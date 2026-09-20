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
/* global document, window */

const { EventEmitter } = require("events");
const { looseParseJSON } = require("../../ai-engine/response-parser.js");
const {
  captureDesktopGovernedVisionModelClient,
} = require("../../llm/llm-manager.js");
const {
  consumeDesktopBrowserVisionObservationGrant,
} = require("../../evolution/desktop-browser-vision-observation.js");
const {
  assertDesktopBrowserVisionActionGrant,
  consumeDesktopBrowserVisionActionGrant,
  recordDesktopBrowserVisionActionOutcome,
} = require("../../evolution/desktop-browser-vision-action.js");
const { imageToViewport } = require("./coordinate-mapping.js");

function assertGovernedMultimodalIngress(value) {
  try {
    return captureDesktopGovernedVisionModelClient(value);
  } catch (cause) {
    const error = new Error(
      "Browser screenshot analysis requires a governed multimodal ingress",
      { cause },
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

function assertGovernedVisualMutation() {
  const error = new Error(
    "Browser visual mutation requires a governed action authority",
  );
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}

function visionIngressError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  return error;
}

function assertBoundedVisionText(value, label, maxLength = 16 * 1024) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw visionIngressError(`${label} is empty or exceeds its text budget`);
  }
}

function decodeGovernedImageBase64(value, maxBytes, label) {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > Math.ceil((maxBytes * 4) / 3) + 2 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw visionIngressError(`${label} is not canonical bounded base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== value
  ) {
    throw visionIngressError(`${label} exceeds the governed image budget`);
  }
  return bytes;
}

function assertGovernedVisionOptions(options = {}) {
  if (options.model !== undefined) {
    throw visionIngressError(
      "Browser vision cannot override the governed provider model",
    );
  }
  if (
    options.temperature !== undefined &&
    (!Number.isFinite(options.temperature) ||
      options.temperature < 0 ||
      options.temperature > 1)
  ) {
    throw visionIngressError("Browser vision temperature is invalid");
  }
  if (
    options.detail !== undefined &&
    !["auto", "low", "high"].includes(options.detail)
  ) {
    throw visionIngressError("Browser vision image detail is invalid");
  }
  if (
    options.quality !== undefined &&
    (!Number.isSafeInteger(options.quality) ||
      options.quality < 1 ||
      options.quality > 100)
  ) {
    throw visionIngressError("Browser screenshot quality is invalid");
  }
  if (options.fullPage !== undefined && typeof options.fullPage !== "boolean") {
    throw visionIngressError("Browser screenshot scope is invalid");
  }
}

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
  FIND_TYPE_TARGET: "type",
};

class VisionAction extends EventEmitter {
  constructor(
    browserEngine,
    llmService = null,
    observationGrant = null,
    actionGrant = null,
  ) {
    super();
    this.engine = browserEngine;
    this.llmService = llmService;
    this.observationGrant = observationGrant;
    this.actionGrant = actionGrant;

    // Vision 配置
    this.config = {
      defaultModel: VisionModel.CLAUDE_VISION,
      maxTokens: 4096,
      temperature: 0.1,
      screenshotQuality: 80,
      // Agent v3 admits the complete JSON request at 1 MiB. Keeping aggregate
      // decoded image bytes below 700 KiB leaves room for base64 expansion,
      // prompts and provenance labels, including two-image comparisons.
      maxImageSize: 700 * 1024,
    };

    // 缓存最近的分析结果
    this.analysisCache = new Map();
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
  async _captureScreenshot(
    targetId,
    options = {},
    operation,
    observationOptions = options,
  ) {
    // The opaque client can only be minted from an initialized LLM manager
    // bound to a signed Desktop model ingress. Check it before page access.
    assertGovernedMultimodalIngress(this.llmService);
    assertGovernedVisionOptions(options);
    if (
      options.maxTokens !== undefined &&
      (!Number.isSafeInteger(options.maxTokens) ||
        options.maxTokens < 1 ||
        options.maxTokens > this.config.maxTokens)
    ) {
      const error = new Error("Browser vision token budget is invalid");
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }
    if (options.signal?.aborted) {
      const error = new Error("Browser screenshot analysis was cancelled");
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }
    consumeDesktopBrowserVisionObservationGrant(
      this.observationGrant,
      targetId,
      operation,
      observationOptions,
    );
    const page = this._getPage(targetId);

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: options.quality || this.config.screenshotQuality,
      fullPage: options.fullPage || false,
      clip: options.clip,
    });

    if (
      !Buffer.isBuffer(buffer) ||
      buffer.byteLength < 1 ||
      buffer.byteLength > this.config.maxImageSize
    ) {
      const error = new Error(
        "Browser screenshot exceeds the governed image budget",
      );
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }

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
    // Agent v3's provider-neutral transport contract is OpenAI-shaped. The
    // provider client converts authenticated readback at its wire boundary.
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

  /**
   * 调用 Vision LLM
   * @private
   */
  async _callVisionLLM(messages, options = {}) {
    const ingress = assertGovernedMultimodalIngress(this.llmService);
    assertGovernedVisionOptions(options);
    if (options.signal?.aborted) {
      const error = new Error("Browser vision request was cancelled");
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }

    const maxTokens = options.maxTokens ?? this.config.maxTokens;
    if (
      !Number.isSafeInteger(maxTokens) ||
      maxTokens < 1 ||
      maxTokens > this.config.maxTokens
    ) {
      const error = new Error("Browser vision token budget is invalid");
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }

    try {
      const response = await ingress.chat(messages, {
        max_tokens: maxTokens,
        temperature: options.temperature ?? this.config.temperature,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      return response.text || response.message?.content || "";
    } catch (error) {
      if (error?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
      throw new Error(`Vision LLM call failed: ${error.message}`, {
        cause: error,
      });
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
    return await this._analyze(
      targetId,
      prompt,
      options,
      VisionTaskType.ANALYZE,
      { ...options, prompt },
    );
  }

  async _analyze(targetId, prompt, options, operation, observationOptions) {
    // Cache entries cannot prove that they describe the current browser
    // pixels. Every governed analysis takes and admits a fresh screenshot.
    assertGovernedMultimodalIngress(this.llmService);
    assertBoundedVisionText(prompt, "Browser vision prompt");

    const imageBase64 = await this._captureScreenshot(
      targetId,
      options,
      operation,
      observationOptions,
    );
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
    assertGovernedMultimodalIngress(this.llmService);
    assertBoundedVisionText(description, "Browser element description", 4096);
    const observationOptions = { ...options, description };
    const imageBase64 = await this._captureScreenshot(
      targetId,
      options,
      VisionTaskType.LOCATE_ELEMENT,
      observationOptions,
    );
    const page = this._getPage(targetId);
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const fullPage = options.fullPage || false;
    const deviceScaleFactor = await this._getDeviceScaleFactor(page);

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
    const actionOptions = { ...options, description };
    // Preflight both opaque capabilities before taking a screenshot. The
    // action grant stays unconsumed until immediately before the mutation.
    assertDesktopBrowserVisionActionGrant(
      this.actionGrant,
      this.observationGrant,
      targetId,
      "visual-click",
      actionOptions,
    );
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

    const actionEvidence = consumeDesktopBrowserVisionActionGrant(
      this.actionGrant,
      this.observationGrant,
      targetId,
      "visual-click",
      actionOptions,
    );

    let mutationError = null;
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
    } catch (error) {
      mutationError = error;
    }

    const actionAudit = await recordDesktopBrowserVisionActionOutcome(
      this.actionGrant,
      {
        status: mutationError === null ? "succeeded" : "failed",
        clickedAt: { x: clickX, y: clickY },
        button: options.button || "left",
        clickCount: options.clickCount || 1,
        failureClass:
          mutationError === null ? null : "browser-click-or-wait-failed",
      },
    );

    if (mutationError !== null) {
      return {
        success: false,
        error: `Click failed: ${mutationError.message}`,
        location,
        authorizationReceiptDigest: actionEvidence.receiptDigest,
        auditEventDigest: actionAudit.auditEventDigest,
        durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      };
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
      authorizationReceiptDigest: actionEvidence.receiptDigest,
      auditEventDigest: actionAudit.auditEventDigest,
      durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
    };
  }

  /**
   * Locate a text input from a fresh governed screenshot, focus it and type
   * one bounded value under a one-shot interactive action grant.
   */
  async visualType(targetId, description, text, options = {}) {
    const actionOptions = { ...options, description, text };
    assertDesktopBrowserVisionActionGrant(
      this.actionGrant,
      this.observationGrant,
      targetId,
      "visual-type",
      actionOptions,
    );
    const location = await this.locateElement(targetId, description, options);
    if (!location.success || !location.element) {
      return {
        success: false,
        error: `Could not locate input: "${description}"`,
        location,
      };
    }

    const { x, y, width, height } = location.element;
    const imageCenterX = x + (width || 0) / 2;
    const imageCenterY = y + (height || 0) / 2;
    const page = this._getPage(targetId);
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

    const actionEvidence = consumeDesktopBrowserVisionActionGrant(
      this.actionGrant,
      this.observationGrant,
      targetId,
      "visual-type",
      actionOptions,
    );
    let mutationError = null;
    try {
      await page.mouse.click(clickX, clickY, {
        button: "left",
        clickCount: 1,
      });
      if (options.clearExisting === true) {
        await page.keyboard.press(
          process.platform === "darwin" ? "Meta+A" : "Control+A",
        );
      }
      await page.keyboard.type(text, { delay: options.delay || 0 });
    } catch (error) {
      mutationError = error;
    }

    const actionAudit = await recordDesktopBrowserVisionActionOutcome(
      this.actionGrant,
      {
        status: mutationError === null ? "succeeded" : "failed",
        text,
        failureClass:
          mutationError === null ? null : "browser-focus-or-type-failed",
      },
    );
    const result = {
      authorizationReceiptDigest: actionEvidence.receiptDigest,
      auditEventDigest: actionAudit.auditEventDigest,
      durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      requestedCharacterCount: [...text].length,
    };
    if (mutationError !== null) {
      return {
        success: false,
        error: `Type failed: ${mutationError.message}`,
        location,
        ...result,
      };
    }
    this.emit("visualTyped", {
      targetId,
      description,
      requestedCharacterCount: result.requestedCharacterCount,
    });
    return {
      success: true,
      action: "visualType",
      description,
      confidence: location.confidence,
      ...result,
    };
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

    return this._analyze(
      targetId,
      prompt,
      options,
      VisionTaskType.DESCRIBE,
      options,
    );
  }

  /**
   * Read visible text from a fresh governed screenshot.
   * @param {string} targetId - Tab ID
   * @param {Object} options - OCR options
   * @returns {Promise<Object>}
   */
  async ocr(targetId, options = {}) {
    const prompt =
      options.prompt ||
      "Extract all visible text from this webpage screenshot. Preserve reading order and line breaks. Return only the extracted text.";
    return this._analyze(
      targetId,
      prompt,
      options,
      VisionTaskType.OCR,
      options,
    );
  }

  /**
   * 比较两个截图
   * @param {string} targetId - 标签页 ID
   * @param {string} baselineBase64 - 基线截图 base64
   * @param {Object} options - 比较选项
   * @returns {Promise<Object>}
   */
  async compareWithBaseline(targetId, baselineBase64, options = {}) {
    assertGovernedMultimodalIngress(this.llmService);
    const baselineBytes = decodeGovernedImageBase64(
      baselineBase64,
      this.config.maxImageSize,
      "Browser vision baseline",
    );
    const currentBase64 = await this._captureScreenshot(
      targetId,
      options,
      VisionTaskType.COMPARE,
      { ...options, baseline: baselineBase64 },
    );
    const currentBytes = decodeGovernedImageBase64(
      currentBase64,
      this.config.maxImageSize,
      "Browser vision screenshot",
    );
    if (baselineBytes.length + currentBytes.length > this.config.maxImageSize) {
      throw visionIngressError(
        "Browser vision comparison exceeds the aggregate image budget",
      );
    }

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

    // Keep the authenticated internal representation provider-neutral. The
    // provider client owns conversion after Agent v3 restores the bytes.
    const messages = [
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
    assertGovernedVisualMutation();
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

      case VisionTaskType.FIND_TYPE_TARGET:
        return this.visualType(
          targetId,
          options.description,
          options.text,
          options,
        );

      case VisionTaskType.DESCRIBE:
        return this.describePage(targetId, options);

      case VisionTaskType.COMPARE:
        return this.compareWithBaseline(targetId, options.baseline, options);

      case VisionTaskType.OCR:
        return this.ocr(targetId, options);

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
