/**
 * IPC Attach Protocol — stdio 双向消息协议
 *
 * 用于 `cc cowork background attach <id>` 与 Background Agent Worker 子进程之间
 * 传递结构化消息（提问/回答/取消/恢复），与普通 stdout/stderr 输出互不干扰。
 *
 * 协议格式：每一行以 `__IPC__:` 开头，后接 JSON 编码的消息体
 * 换行安全：JSON 内的换行符被转义为 \x1f，回车符被转义为 \x1e
 */

const IPC_PREFIX = "__IPC__:";
const NL = "\n";
const CR = "\r";
const NL_SUBST = "\x1f";
const CR_SUBST = "\x1e";

/**
 * 编码一条 IPC 消息
 * @param {string} type - 消息类型 (HELLO/QUESTION/ANSWER/RESUME/CANCEL/...)
 * @param {object} [payload={}] - 消息负载
 * @returns {string} 可直接写入 stdin/stdout 的带前缀字符串（含末尾换行）
 */
function encodeIpcMessage(type, payload = {}) {
  const json = JSON.stringify({ type, ...payload });
  const safe = json.split(CR).join(CR_SUBST).split(NL).join(NL_SUBST);
  return IPC_PREFIX + safe + NL;
}

/**
 * 尝试从一行文本解析 IPC 消息
 * @param {string} line - 单行文本（不含末尾换行）
 * @returns {object|null} 解析出的消息对象，非 IPC 消息返回 null
 */
function decodeIpcLine(line) {
  if (!line || !line.startsWith(IPC_PREFIX)) return null;
  const raw = line
    .slice(IPC_PREFIX.length)
    .split(CR_SUBST)
    .join(CR)
    .split(NL_SUBST)
    .join(NL);
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return { type: "PARSE_ERROR", raw };
  }
}

/**
 * 从文本流中提取所有完整 IPC 消息，并返回剩余的未完成片段
 * @param {string} buffer - 累积的文本缓冲区
 * @returns {{ messages: Array<object>, rest: string }}
 */
function parseIpcBuffer(buffer) {
  const messages = [];
  const lines = buffer.split(NL);
  const rest = lines.pop() || "";
  for (const line of lines) {
    const msg = decodeIpcLine(line);
    if (msg) messages.push(msg);
  }
  return { messages, rest };
}

/**
 * 将答案值标准化为字符串（兼容文本/对象/选项序号）
 * @param {*} value - 用户输入的原始答案
 * @param {object} [question] - 原问题对象（用于解析选项序号）
 * @returns {string}
 */
function normalizeAnswer(value, question = null) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (
      question &&
      Array.isArray(question.options) &&
      question.options.length > 0
    ) {
      const num = Number(s);
      if (Number.isInteger(num) && num >= 1 && num <= question.options.length) {
        return String(
          question.options[num - 1].value ?? question.options[num - 1],
        );
      }
    }
    return s;
  }
  return JSON.stringify(value);
}

module.exports = {
  IPC_PREFIX,
  encodeIpcMessage,
  decodeIpcLine,
  parseIpcBuffer,
  normalizeAnswer,
};
