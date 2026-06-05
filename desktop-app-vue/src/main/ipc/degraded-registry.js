/**
 * degraded-registry — 集中记录"以降级模式注册"的 IPC 子系统，让降级状态可见。
 *
 * 背景：多个 IPC phase 在依赖未就绪（DB / LLM / U-Key / sync 等管理器为 null）时，
 * 仍会注册"降级 handler"并只打一行 `logger.warn(...)`。这行 warn 埋在启动日志里，
 * 渲染层与用户完全看不到——系统看起来正常，实则某些能力不可用（silent degrade）。
 *
 * 本模块提供一个进程内单例登记表：每个降级点调用 `note(subsystem, reason)` 静默记录
 * （不重复打日志，保留各 phase 原有 warn 不变），编排层在注册完成后统一：
 *   1. 打一条**汇总** WARN（一眼可见有哪些子系统降级）；
 *   2. 通过 `system:degraded-subsystems` 事件广播给渲染层（UI 可弹横幅/通知）；
 *   3. 暴露 `system:get-degraded-subsystems` 查询通道，渲染层随时可拉取。
 *
 * @module ipc/degraded-registry
 */

const { EventEmitter } = require("events");

/** @type {Map<string, {subsystem:string, reason:string, detail:object, firstAt:number, lastAt:number, count:number}>} */
const _entries = new Map();
const _emitter = new EventEmitter();

/**
 * 记录一个子系统以降级模式注册。同名子系统重复记录会累加 count、更新 lastAt/reason。
 * 静默记录（不打日志）——保留调用处原有的 logger.warn 不变，避免改变既有日志输出。
 *
 * @param {string} subsystem - 稳定的子系统标识（如 "ai-llm" / "database-core" / "sync"）
 * @param {string} reason - 人类可读的降级原因
 * @param {object} [detail] - 附加结构化信息（缺失的依赖名等）
 * @returns {object} 该子系统的登记条目
 */
function note(subsystem, reason, detail = {}) {
  const now = Date.now();
  const prev = _entries.get(subsystem);
  const entry = {
    subsystem,
    reason: reason || (prev && prev.reason) || "degraded",
    detail: { ...(prev && prev.detail), ...detail },
    firstAt: prev ? prev.firstAt : now,
    lastAt: now,
    count: prev ? prev.count + 1 : 1,
  };
  _entries.set(subsystem, entry);
  _emitter.emit("change", list());
  return entry;
}

/** @returns {Array<object>} 所有降级子系统条目（拷贝）。 */
function list() {
  return Array.from(_entries.values()).map((e) => ({ ...e }));
}

/** @returns {number} 当前降级子系统数量。 */
function count() {
  return _entries.size;
}

/**
 * @param {string} subsystem
 * @returns {boolean} 指定子系统是否处于降级状态。
 */
function isDegraded(subsystem) {
  return _entries.has(subsystem);
}

/** 清空登记表（测试 / 热重载用）。 */
function clear() {
  _entries.clear();
  _emitter.emit("change", []);
}

/**
 * 订阅降级状态变化。
 * @param {(entries:Array<object>) => void} fn
 * @returns {() => void} 取消订阅
 */
function onChange(fn) {
  _emitter.on("change", fn);
  return () => _emitter.off("change", fn);
}

module.exports = {
  note,
  list,
  count,
  isDegraded,
  clear,
  onChange,
  _emitter,
};
