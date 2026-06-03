/**
 * @module llm/llm-state-bus
 *
 * 统一的 LLM 状态广播总线 (优化计划 L1)
 *
 * 背景:
 *   llm-manager / session-manager / multi-agent / tool-system 各自有 LLM
 *   或 LLM 派生缓存,但缺少统一的失效广播路径。当用户切换 provider /
 *   model / 服务被预算暂停时,旧的会话缓存、token 计数、agent 上下文不会
 *   自动失效,导致状态错位。
 *
 * 设计:
 *   - 单例 EventEmitter,作为单一事实来源
 *   - 事件名称使用 "{domain}:{action}" 命名,便于按域过滤
 *   - llm-manager 通过 forwardFrom() 把现有 emit 镜像到总线
 *   - 订阅方 (session-manager / agent-orchestrator / tool-cache) 直接 on()
 *
 * 不做的事:
 *   - 不取代 llm-manager 自身的 EventEmitter (避免破坏既有监听)
 *   - 不做事件持久化 (走 logger 即可)
 *   - 不做请求/响应 (单向广播)
 */

"use strict";

const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

/**
 * 标准事件名称。订阅方应使用这些常量而非裸字符串,便于重构。
 */
const Events = Object.freeze({
  // Provider/model 切换 — 订阅方通常需要丢弃 provider 绑定的缓存
  PROVIDER_CHANGED: "llm:provider-changed",
  MODEL_SWITCHED: "llm:model-switched",

  // 服务可用性 — 订阅方应暂停发起新调用,但不应清空已有上下文
  SERVICE_PAUSED: "llm:service-paused",
  SERVICE_RESUMED: "llm:service-resumed",

  // 预算告警 — 订阅方可决定降级或排队
  BUDGET_ALERT: "llm:budget-alert",

  // 会话失效 — 订阅方需要从持久层重新加载会话
  SESSION_INVALIDATED: "session:invalidated",

  // 全局失效 — 用于 logout/wipe,所有订阅方应清空内存缓存
  ALL_INVALIDATED: "all:invalidated",
});

/**
 * 从 llm-manager 转发到总线的事件映射 (源事件名 → 总线事件名)
 */
const FORWARD_MAP = Object.freeze({
  "provider-changed": Events.PROVIDER_CHANGED,
  "model-switched": Events.MODEL_SWITCHED,
  "service-paused": Events.SERVICE_PAUSED,
  "service-resumed": Events.SERVICE_RESUMED,
  "budget-alert": Events.BUDGET_ALERT,
});

class LLMStateBus extends EventEmitter {
  constructor() {
    super();
    // 提高默认监听器上限 — session-manager / agent-orchestrator / tool-cache
    // 等多个订阅方都会注册
    this.setMaxListeners(50);

    // 跟踪已绑定的源,避免重复 forwardFrom 导致事件被广播多次
    this._forwardedSources = new WeakSet();
    // 统计每个事件的派发次数 (调试 + 监控)
    this._dispatchCounts = new Map();
  }

  /**
   * 桥接一个 EventEmitter 源 (通常是 llm-manager 实例) 到总线。
   * 同一个源对象多次调用是幂等的。
   *
   * @param {EventEmitter} source
   * @param {Object} [options]
   * @param {Object<string,string>} [options.map] 自定义事件映射,默认 FORWARD_MAP
   * @returns {Function} 解绑函数
   */
  forwardFrom(source, options = {}) {
    if (!source || typeof source.on !== "function") {
      throw new TypeError("forwardFrom requires an EventEmitter source");
    }
    if (this._forwardedSources.has(source)) {
      logger.debug("[LLMStateBus] Source already forwarded, skipping");
      return () => {};
    }

    const map = options.map || FORWARD_MAP;
    const handlers = [];
    for (const [srcEvent, busEvent] of Object.entries(map)) {
      const handler = (payload) => this.dispatch(busEvent, payload);
      source.on(srcEvent, handler);
      handlers.push([srcEvent, handler]);
    }
    this._forwardedSources.add(source);

    return () => {
      for (const [srcEvent, handler] of handlers) {
        source.off(srcEvent, handler);
      }
    };
  }

  /**
   * 派发一个总线事件 (带统计 + 错误隔离)。
   * 内部使用 — 外部代码也可直接 emit(),但 dispatch() 会做统计。
   */
  dispatch(eventName, payload) {
    this._dispatchCounts.set(
      eventName,
      (this._dispatchCounts.get(eventName) || 0) + 1,
    );
    try {
      this.emit(eventName, payload);
    } catch (err) {
      // 单个监听器抛错不应阻塞其他监听器或源
      logger.error(
        `[LLMStateBus] Listener for ${eventName} threw:`,
        err.message,
      );
    }
  }

  /**
   * 触发全局失效。订阅方收到 ALL_INVALIDATED 后应清空所有 LLM 相关缓存。
   * 不会自动触发 SESSION_INVALIDATED — 订阅方按需自己 chain。
   */
  invalidateAll(reason = "manual") {
    this.dispatch(Events.ALL_INVALIDATED, { reason, ts: Date.now() });
  }

  /**
   * 触发单会话失效。
   */
  invalidateSession(sessionId, reason = "manual") {
    this.dispatch(Events.SESSION_INVALIDATED, {
      sessionId,
      reason,
      ts: Date.now(),
    });
  }

  /**
   * 调试用 — 当前各事件派发统计
   */
  getStats() {
    return {
      events: Object.fromEntries(this._dispatchCounts),
      listenerCount: this.eventNames().reduce(
        (sum, name) => sum + this.listenerCount(name),
        0,
      ),
    };
  }

  /**
   * 测试用 — 重置内部状态
   */
  reset() {
    this.removeAllListeners();
    this._dispatchCounts.clear();
    this._forwardedSources = new WeakSet();
  }
}

let instance = null;

/**
 * 获取单例总线
 */
function getLLMStateBus() {
  if (!instance) {
    instance = new LLMStateBus();
  }
  return instance;
}

module.exports = {
  LLMStateBus,
  Events,
  FORWARD_MAP,
  getLLMStateBus,
};
