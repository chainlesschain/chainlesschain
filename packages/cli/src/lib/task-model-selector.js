/**
 * Task-based intelligent model selector for CLI
 *
 * Detects task type from user messages and recommends the best model
 * for each LLM provider. Enables automatic model switching based on
 * what the user is trying to accomplish.
 */

/**
 * Task types supported by the selector
 */
export const TaskType = {
  CHAT: "chat",
  CODE: "code",
  REASONING: "reasoning",
  FAST: "fast",
  TRANSLATE: "translate",
  CREATIVE: "creative",
};

/**
 * Task type → recommended model per provider
 * Each provider maps to the best model for that task type.
 */
const TASK_MODEL_MAP = {
  [TaskType.CHAT]: {
    volcengine: "doubao-seed-1-6-flash-250828",
    openai: "gpt-4o-mini",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-plus",
    gemini: "gemini-2.0-flash",
    mistral: "mistral-medium-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.CODE]: {
    volcengine: "doubao-seed-code",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-coder",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    mistral: "mistral-large-latest",
    ollama: "codellama:7b",
  },
  [TaskType.REASONING]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "o1",
    anthropic: "claude-opus-4-6",
    deepseek: "deepseek-reasoner",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    mistral: "mistral-large-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.FAST]: {
    volcengine: "doubao-seed-1-6-lite-251015",
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-4-5-20251001",
    deepseek: "deepseek-chat",
    dashscope: "qwen-turbo",
    gemini: "gemini-2.0-flash",
    mistral: "mistral-small-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.TRANSLATE]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-plus",
    gemini: "gemini-2.0-flash",
    mistral: "mistral-large-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.CREATIVE]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o",
    anthropic: "claude-opus-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    mistral: "mistral-large-latest",
    ollama: "qwen2:7b",
  },
};

/**
 * Task type display names (Chinese + English)
 */
const TASK_NAMES = {
  [TaskType.CHAT]: "日常对话",
  [TaskType.CODE]: "代码任务",
  [TaskType.REASONING]: "复杂推理",
  [TaskType.FAST]: "快速响应",
  [TaskType.TRANSLATE]: "翻译任务",
  [TaskType.CREATIVE]: "创意写作",
};

/**
 * Keyword patterns for detecting task type from user message.
 * Each pattern is [regex, taskType, priority].
 * Higher priority wins when multiple patterns match.
 */
const TASK_PATTERNS = [
  // Code patterns (priority 10) — English with word boundaries
  [
    /\b(code|coding|program|function|class|bug|debug|refactor|implement)\b/i,
    TaskType.CODE,
    10,
  ],
  [
    /\b(javascript|typescript|python|java|rust|go|c\+\+|sql|html|css|react|vue|node|npm|git|api|endpoint|database)\b/i,
    TaskType.CODE,
    10,
  ],
  [/```[\s\S]*```/, TaskType.CODE, 10],
  // Code patterns — Chinese (no \b, Chinese chars are not word-boundary compatible)
  [
    /(代码|编程|函数|调试|重构|实现|写[一个]*[代码函数方法])/,
    TaskType.CODE,
    10,
  ],

  // Reasoning patterns (priority 8)
  [
    /\b(analyze|reason|explain why|prove|compare|evaluate)\b/i,
    TaskType.REASONING,
    8,
  ],
  [/\b(step.by.step|think.*through)\b/i, TaskType.REASONING, 8],
  [
    /(分析|推理|解释为什么|证明|比较|评估|深度思考|逻辑|逐步|一步一步)/,
    TaskType.REASONING,
    8,
  ],

  // Translation patterns (priority 9)
  [/\b(translate|translation|translate.*to)\b/i, TaskType.TRANSLATE, 9],
  [/(翻译|转换.*语言|英译中|中译英)/, TaskType.TRANSLATE, 9],

  // Creative patterns (priority 7)
  [
    /\b(write|create|compose|story|poem|essay|blog|article)\b/i,
    TaskType.CREATIVE,
    7,
  ],
  [/(写[一篇]*.*[故事诗歌文章博客]|创作|小说|剧本)/, TaskType.CREATIVE, 7],

  // Fast patterns (priority 5)
  [/\b(quick|brief|short)\b/i, TaskType.FAST, 5],
  [/(简短|快速|简单回答|一句话)/, TaskType.FAST, 5],
];

/**
 * Detect the task type from a user message using keyword matching.
 *
 * @param {string} message - User's input message
 * @returns {{ taskType: string, confidence: number, name: string }}
 */
export function detectTaskType(message) {
  if (!message || typeof message !== "string") {
    return {
      taskType: TaskType.CHAT,
      confidence: 0,
      name: TASK_NAMES[TaskType.CHAT],
    };
  }

  let bestMatch = null;
  let bestPriority = -1;
  let matchCount = 0;

  for (const [pattern, taskType, priority] of TASK_PATTERNS) {
    if (pattern.test(message)) {
      matchCount++;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestMatch = taskType;
      }
    }
  }

  if (!bestMatch) {
    return {
      taskType: TaskType.CHAT,
      confidence: 0,
      name: TASK_NAMES[TaskType.CHAT],
    };
  }

  // Confidence based on match count and priority
  const confidence = Math.min(1, matchCount * 0.3 + bestPriority * 0.07);

  return {
    taskType: bestMatch,
    confidence,
    name: TASK_NAMES[bestMatch],
  };
}

/**
 * Select the best model for a given provider and task type.
 *
 * @param {string} provider - LLM provider name
 * @param {string} taskType - Task type from TaskType enum
 * @returns {string|null} Model ID, or null if no recommendation
 */
export function selectModelForTask(provider, taskType) {
  const taskMap = TASK_MODEL_MAP[taskType];
  if (!taskMap) return null;
  return taskMap[provider] || null;
}

/**
 * Get a human-readable task name.
 *
 * @param {string} taskType - Task type
 * @returns {string}
 */
export function getTaskName(taskType) {
  return TASK_NAMES[taskType] || taskType;
}

/**
 * Get all supported task types.
 *
 * @returns {Object} TaskType enum
 */
export function getTaskTypes() {
  return { ...TaskType };
}
