/**
 * background-interaction-resolver — 监听 agent 子进程发来的交互请求，
 * 转发给后台会话 transport 并通过 pendingInteractions 追踪回复。
 *
 * 当 agent 调用 onPrompt/onApprove 等需要用户交互的方法时，子进程通过 IPC
 * 发送 { type: "interaction-request", intId, requestType, prompt, options } 消息。
 * 本模块监听这些消息，加入本地 pending map，并广播给所有 attach 客户端。
 */

const INTERACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时

/**
 * 挂载交互请求监听到 agent 子进程。
 *
 * @param {import('node:child_process').ChildProcess} child - agent 子进程实例
 * @param {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} pendingInteractions - 待处理交互映射
 * @param {Function} broadcast - 广播消息给所有 attach 客户端的函数
 * @returns {Function} 卸载函数，调用后停止监听
 */
export function attachInteractionRequestHandler(
  child,
  pendingInteractions,
  broadcast,
) {
  if (!child) {
    return () => {};
  }

  const handler = (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type !== "interaction-request") return;

    const { intId, requestType, prompt, options = {} } = message;
    if (!intId) return;

    // 加入 pending 映射，设置超时
    const timer = setTimeout(() => {
      const entry = pendingInteractions.get(intId);
      if (!entry) return;
      pendingInteractions.delete(intId);
      // 超时返回默认值：confirm 返回 false，其他返回 null
      const defaultAnswer = requestType === "confirm" ? false : null;
      entry.resolve(defaultAnswer);
      broadcast?.({
        type: "interaction-timeout",
        intId,
      });
    }, INTERACTION_TIMEOUT_MS);
    // 不保持事件循环存活
    timer.unref?.();

    // 这里不存 resolve/reject — 调用方 (worker) 已经在 agentAskUser 中存了
    // 我们只负责广播给 attach 客户端
    // 但为了超时能触发 worker 的 resolve，需要把 entry 透传？不，worker 自己存 entry
    // 只需要广播消息即可
    broadcast?.({
      type: "interaction_request",
      intId,
      requestType,
      prompt,
      options,
    });
  };

  child.on("message", handler);

  // 返回卸载函数
  return () => {
    child.off("message", handler);
  };
}
