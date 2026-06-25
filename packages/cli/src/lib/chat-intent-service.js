/**
 * Chat Intent Service — ports the V5 desktop intent understanding and
 * follow-up intent classifier flows to the CLI/WS layer so the web-shell
 * can drive the same UX over WebSocket topics.
 *
 *   understandIntent({ userInput, contextMode, llmOptions })
 *     → { correctedInput, intent, keyPoints }
 *
 *   classifyFollowupIntent({ input, context, llmOptions })
 *     → { intent, confidence, reason, extractedInfo, method, latency }
 *
 * Intent categories match V5 (FollowupIntentClassifier):
 *   CONTINUE_EXECUTION | MODIFY_REQUIREMENT | CLARIFICATION | CANCEL_TASK
 *
 * The rule-based first-pass mirrors the V5 keyword + regex sets so behaviour
 * is identical when the LLM is offline. LLM fallback uses the same low-temp
 * JSON-output prompt as V5.
 */

import { chatWithStreaming, chatStream } from "./chat-core.js";
import { firstBalancedJson } from "./json-schema-output.js";

const DEFAULT_INTENT_TIMEOUT_MS = 15000;

/**
 * Build the V5 understandIntent system + user prompt pair.
 *
 * `history` is optional — when provided, the last few exchanges are
 * embedded into the user prompt so the model can resolve anaphora ("再来
 * 一次"、"和上次一样") instead of treating each input in isolation.
 */
function buildUnderstandPrompts(userInput, contextMode, history) {
  const systemPrompt = `你是一个智能的意图理解助手。你的任务是：

1. **纠错处理**：识别并纠正用户输入中的打字错误、拼写错误、语法错误等问题
2. **意图识别**：理解用户的真实意图和需求（如有对话历史，请结合上下文消解指代）
3. **要点提取**：提取用户需求的关键要点

请以JSON格式返回结果，格式如下：
\`\`\`json
{
  "correctedInput": "纠错后的输入（如果没有错误，则与原输入相同）",
  "intent": "用户的意图描述（简短的一句话）",
  "keyPoints": ["关键要点1", "关键要点2", "关键要点3"]
}
\`\`\`

**注意事项：**
- 如果输入没有错误，correctedInput应该与原输入完全相同
- intent应该简洁明了，不超过30个字
- keyPoints应该提取3-5个核心要点
- 必须返回有效的JSON格式`;

  const historyBlock =
    Array.isArray(history) && history.length > 0
      ? `\n\n对话历史（最近 ${history.length} 条）：\n${history
          .map((m) => `- ${m.role}: ${String(m.content || "").slice(0, 200)}`)
          .join("\n")}`
      : "";

  const userPrompt = `请理解以下用户输入：

用户输入：${userInput}

上下文模式：${contextMode || "global"}${historyBlock}`;

  return { systemPrompt, userPrompt };
}

/**
 * Extract the JSON body from an LLM response (handles ```json fences and
 * bare JSON braces). Returns null if no JSON found.
 */
function extractJson(content) {
  if (!content || typeof content !== "string") return null;
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const generic = content.match(/```\s*([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  // Balanced extraction stops at the first complete object instead of the old
  // greedy /\{[\s\S]*\}/, which over-captured trailing prose with a stray }.
  return firstBalancedJson(content, "{");
}

/**
 * Understand a user input — runs the V5 prompt through the active LLM and
 * parses the response. Returns a normalised understanding object plus a
 * `success` flag; on parse / LLM failure, falls back to passing the input
 * through verbatim with `intent='general'` so the caller never crashes.
 *
 * @param {object} args
 * @param {string} args.userInput
 * @param {string} [args.contextMode='global']
 * @param {object} args.llmOptions  - { provider, model, baseUrl, apiKey }
 * @returns {Promise<{success: boolean, correctedInput: string, intent: string,
 *                    keyPoints: string[], error?: string}>}
 */
export async function understandIntent({
  userInput,
  contextMode = "global",
  history,
  llmOptions,
}) {
  if (!userInput || !userInput.trim()) {
    throw new Error("userInput required");
  }
  if (!llmOptions || !llmOptions.provider) {
    // Caller chose not to provide LLM creds — degrade gracefully so the UI
    // can still show the confirmation card.
    return {
      success: false,
      correctedInput: userInput,
      intent: "general",
      keyPoints: [],
      error: "LLM not configured",
    };
  }

  const { systemPrompt, userPrompt } = buildUnderstandPrompts(
    userInput,
    contextMode,
    history,
  );

  try {
    const fullContent = await chatWithStreaming(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        ...llmOptions,
        // Lower temperature → more deterministic JSON output.
        temperature: 0.3,
        maxTokens: 500,
      },
    );

    const jsonText = extractJson(fullContent);
    if (!jsonText) {
      throw new Error("LLM response did not contain JSON");
    }
    const parsed = JSON.parse(jsonText);
    return {
      success: true,
      correctedInput: parsed.correctedInput || userInput,
      intent: parsed.intent || "general",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    return {
      success: false,
      correctedInput: userInput,
      intent: "general",
      keyPoints: [],
      error: err?.message || String(err),
    };
  }
}

/**
 * Streaming variant of {@link understandIntent}.
 *
 * Yields:
 *   { type: 'token', token }     — every LLM delta token (raw, may be partial JSON)
 *   { type: 'final', success, correctedInput, intent, keyPoints, error? }
 *
 * The UI uses tokens as a "thinking…" indicator and only renders the
 * confirmation card on the `final` payload. Yielding raw tokens (rather
 * than incrementally parsed JSON) keeps this layer simple — partial JSON
 * isn't reliably parseable mid-stream and would just produce noise.
 *
 * @param {object} args
 * @param {string} args.userInput
 * @param {string} [args.contextMode='global']
 * @param {Array<{role:string,content:string}>} [args.history]
 * @param {object} [args.llmOptions]
 */
export async function* understandIntentStream({
  userInput,
  contextMode = "global",
  history,
  llmOptions,
}) {
  if (!userInput || !userInput.trim()) {
    throw new Error("userInput required");
  }
  if (!llmOptions || !llmOptions.provider) {
    yield {
      type: "final",
      success: false,
      correctedInput: userInput,
      intent: "general",
      keyPoints: [],
      error: "LLM not configured",
    };
    return;
  }

  const { systemPrompt, userPrompt } = buildUnderstandPrompts(
    userInput,
    contextMode,
    history,
  );
  let buffer = "";
  try {
    for await (const event of chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { ...llmOptions, temperature: 0.3, maxTokens: 500 },
    )) {
      if (event.type === "response-token") {
        buffer += event.token;
        yield { type: "token", token: event.token };
      } else if (event.type === "response-complete") {
        // chatStream's terminal event carries the full collected text;
        // prefer it over the accumulated buffer in case provider semantics
        // differ.
        buffer = event.content || buffer;
      }
    }
    const jsonText = extractJson(buffer);
    if (!jsonText) {
      yield {
        type: "final",
        success: false,
        correctedInput: userInput,
        intent: "general",
        keyPoints: [],
        error: "LLM response did not contain JSON",
      };
      return;
    }
    const parsed = JSON.parse(jsonText);
    yield {
      type: "final",
      success: true,
      correctedInput: parsed.correctedInput || userInput,
      intent: parsed.intent || "general",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    yield {
      type: "final",
      success: false,
      correctedInput: userInput,
      intent: "general",
      keyPoints: [],
      error: err?.message || String(err),
    };
  }
}

// =====================================================================
// Follow-up intent classifier — rule-first, LLM-fallback
// =====================================================================

const FOLLOWUP_RULES = {
  CONTINUE_EXECUTION: {
    keywords: [
      "继续",
      "开始",
      "好的",
      "好",
      "嗯",
      "行",
      "ok",
      "OK",
      "快点",
      "去吧",
      "执行",
    ],
    patterns: [
      /^(继续|好的?|嗯|行|OK|ok)$/i,
      /^快点|赶紧|马上/,
      /^开始(吧|执行)/,
    ],
  },
  MODIFY_REQUIREMENT: {
    keywords: [
      "改",
      "修改",
      "换成",
      "换",
      "换个",
      "不要",
      "去掉",
      "删除",
      "加上",
      "增加",
      "还要",
      "另外",
    ],
    patterns: [
      /(改|换)(成|个)/,
      /(加|增加|还要|另外).+(功能|页面|按钮|模块)/,
      /不要|去掉|删除/,
      /等等|等一下|先别/,
      /还要.*(修改|改)/,
    ],
  },
  CLARIFICATION: {
    keywords: [
      "用",
      "采用",
      "使用",
      "应该是",
      "具体是",
      "颜色",
      "字体",
      "大小",
      "位置",
      "标题",
    ],
    patterns: [
      /^(用|采用|使用)/,
      /(颜色|字体|大小|位置|标题).*(是|用|为)/,
      /^.{1,20}(应该|具体)(是|为)/,
      /^数据(来源|是)/,
      /.*(用|采用).*(字体|颜色|大小)/,
    ],
  },
  CANCEL_TASK: {
    keywords: ["算了", "不用", "停止", "取消", "暂停", "先不"],
    patterns: [
      /^(算了|不用|停止|取消|暂停)/,
      /(算了|不用了|停止|取消|暂停)/,
      /^先不.*(了|吧)/,
      /不做了|别做了/,
      /先不做/,
    ],
  },
};

function ruleBasedClassify(userInput) {
  const input = (userInput || "").trim();

  if (input.length === 0) {
    return {
      intent: "CONTINUE_EXECUTION",
      confidence: 0.9,
      reason: "Empty input → continue",
    };
  }

  const scores = {
    CONTINUE_EXECUTION: 0,
    MODIFY_REQUIREMENT: 0,
    CLARIFICATION: 0,
    CANCEL_TASK: 0,
  };

  for (const [intent, config] of Object.entries(FOLLOWUP_RULES)) {
    const weightMultiplier = intent === "CANCEL_TASK" ? 1.5 : 1.0;
    for (const keyword of config.keywords) {
      if (input.includes(keyword)) scores[intent] += 0.3 * weightMultiplier;
    }
    for (const pattern of config.patterns) {
      if (pattern.test(input)) scores[intent] += 0.5 * weightMultiplier;
    }
  }

  if (/(算了|不用了?|停止|取消|暂停|先不做)/.test(input)) {
    scores.CANCEL_TASK = Math.max(scores.CANCEL_TASK, 1.0);
  }
  if (/^(好的?|嗯|行|OK|ok|继续)$/i.test(input)) {
    scores.CONTINUE_EXECUTION = 1.0;
  }

  const maxIntent = Object.keys(scores).reduce((a, b) =>
    scores[a] > scores[b] ? a : b,
  );
  const maxScore = scores[maxIntent];

  return {
    intent: maxIntent,
    confidence: Math.min(maxScore, 1.0),
    reason: `rule-based scores: ${JSON.stringify(scores)}`,
    scores,
  };
}

function buildFollowupPrompts(userInput, context = {}) {
  const { currentTask, conversationHistory, taskPlan } = context;

  const systemPrompt = `你是一个专业的意图分类器，负责分析用户在任务执行过程中的后续输入意图。

# 你的任务
判断用户输入属于以下哪一种意图类型：

1. **CONTINUE_EXECUTION (继续执行)**
   - 用户在催促、确认、同意继续当前任务
   - 示例: "继续"、"好的"、"快点"、"开始吧"、"行"

2. **MODIFY_REQUIREMENT (修改需求)**
   - 用户想要修改、追加、删除需求
   - 示例: "改成红色"、"还要加一个登录页"、"去掉导航栏"、"换个字体"

3. **CLARIFICATION (补充说明)**
   - 用户提供额外的细节信息或参数
   - 示例: "标题用宋体"、"数据来源是 users.csv"、"颜色用 #FF5733"

4. **CANCEL_TASK (取消任务)**
   - 用户想要停止、取消当前任务
   - 示例: "算了"、"不用了"、"停止"、"先不做了"

# 输出格式
严格返回 JSON 格式：
{
  "intent": "CONTINUE_EXECUTION | MODIFY_REQUIREMENT | CLARIFICATION | CANCEL_TASK",
  "confidence": 0.0-1.0,
  "reason": "判断理由（1-2句话）",
  "extractedInfo": "如果是 MODIFY_REQUIREMENT 或 CLARIFICATION，提取关键信息"
}`;

  const userPrompt = `
# 上下文信息
${currentTask ? `**当前任务**: ${JSON.stringify(currentTask, null, 2)}` : ""}

${taskPlan ? `**任务计划**: ${JSON.stringify(taskPlan, null, 2)}` : ""}

${
  Array.isArray(conversationHistory) && conversationHistory.length > 0
    ? `**对话历史**:\n${conversationHistory
        .slice(-5)
        .map((m) => `- ${m.role}: ${m.content}`)
        .join("\n")}`
    : ""
}

# 用户输入
"${userInput}"

# 请分析并返回 JSON 结果`;

  return { systemPrompt, userPrompt };
}

async function llmBasedClassify(userInput, context, llmOptions) {
  const { systemPrompt, userPrompt } = buildFollowupPrompts(userInput, context);
  const fullContent = await chatWithStreaming(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    {
      ...llmOptions,
      temperature: 0.1,
      maxTokens: 300,
    },
  );
  const jsonText = extractJson(fullContent);
  if (!jsonText) throw new Error("LLM response missing JSON");
  const parsed = JSON.parse(jsonText);
  return {
    intent: parsed.intent || "CLARIFICATION",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    reason: parsed.reason || "",
    extractedInfo: parsed.extractedInfo || null,
  };
}

/**
 * Classify a follow-up user input — rule-first (covers ~80% of cases),
 * falls back to LLM for ambiguous inputs. On LLM error, returns the rule
 * result if it had any signal, otherwise CLARIFICATION default.
 *
 * @param {object} args
 * @param {string} args.input
 * @param {object} [args.context] - { currentTask, conversationHistory, taskPlan }
 * @param {object} [args.llmOptions] - LLM credentials; if omitted, rule-only
 * @returns {Promise<{intent: string, confidence: number, reason: string,
 *                    extractedInfo?: any, method: string, latency: number}>}
 */
export async function classifyFollowupIntent({
  input,
  context = {},
  llmOptions,
}) {
  const startTime = Date.now();
  const ruleResult = ruleBasedClassify(input);

  if (ruleResult.confidence > 0.8) {
    return {
      ...ruleResult,
      method: "rule",
      latency: Date.now() - startTime,
    };
  }

  if (!llmOptions || !llmOptions.provider) {
    return {
      ...ruleResult,
      method: "rule_no_llm",
      latency: Date.now() - startTime,
    };
  }

  try {
    const llmResult = await llmBasedClassify(input, context, llmOptions);
    return {
      ...llmResult,
      method: "llm",
      latency: Date.now() - startTime,
    };
  } catch (_err) {
    return ruleResult.confidence > 0
      ? {
          ...ruleResult,
          method: "rule_fallback",
          latency: Date.now() - startTime,
        }
      : {
          intent: "CLARIFICATION",
          confidence: 0.5,
          reason: "Unable to classify, defaulting to CLARIFICATION",
          method: "default",
          latency: Date.now() - startTime,
        };
  }
}

// Exposed for test suites — internal helpers.
export const _internal = {
  buildUnderstandPrompts,
  buildFollowupPrompts,
  extractJson,
  ruleBasedClassify,
  DEFAULT_INTENT_TIMEOUT_MS,
};
