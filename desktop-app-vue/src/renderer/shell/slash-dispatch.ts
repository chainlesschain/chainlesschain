/**
 * Slash command dispatcher — 渲染进程侧 handler 注册表
 *
 * 插件在 `ui.slash` 贡献里声明 `handler` 字符串（例如 "builtin:openAdminConsole"）。
 * 宿主组件在挂载时 `registerSlashHandler(handler, fn)` 注册实际回调，
 * Composer 在用户选中命令时 `dispatchSlash(handler, ctx)` 触发。
 *
 * 第三方插件的 handler 未来可由 main 进程 IPC 桥接，此处只管 builtin:*。
 */

import { logger } from "@/utils/logger";

export interface SlashDispatchContext {
  trigger: string;
  args: string;
}

export type SlashHandler = (ctx: SlashDispatchContext) => void | Promise<void>;

const handlers = new Map<string, SlashHandler>();

export function registerSlashHandler(id: string, fn: SlashHandler): () => void {
  if (handlers.has(id)) {
    logger.warn("[slash-dispatch] 覆盖已注册的 handler:", id);
  }
  handlers.set(id, fn);
  return () => {
    if (handlers.get(id) === fn) {
      handlers.delete(id);
    }
  };
}

export function dispatchSlash(
  handlerId: string | null | undefined,
  ctx: SlashDispatchContext,
): boolean {
  if (!handlerId) {
    logger.warn("[slash-dispatch] 命令没有声明 handler");
    return false;
  }
  const fn = handlers.get(handlerId);
  if (!fn) {
    logger.warn("[slash-dispatch] 未注册的 handler:", handlerId);
    return false;
  }
  try {
    void fn(ctx);
    return true;
  } catch (err) {
    logger.error("[slash-dispatch] handler 抛错:", err);
    return false;
  }
}

export function listRegisteredHandlers(): string[] {
  return Array.from(handlers.keys());
}
