/**
 * FAMILY-26 家长端家庭守护仪表板 composable — WS topic 包装。
 *
 * 3 个只读 topic 由 desktop web-shell 注册 (family-guard-handlers.js)，读
 * family_child_event 镜像表。仅 desktop web-shell / V6 shell 有数据；cc ui
 * standalone 无 desktop DB（topic 未注册）→ 调用 reject，store 兜底显空。
 *
 * 解封同 usePersonalDataHub：plain handler 回 `{type:".result", ok, result}`，
 * ws-store resolve 整个 frame，_unwrap 取 `.result`（= handler 的 {success, data}）。
 */
import { useWsStore } from "../stores/ws.js";

function _unwrap(reply) {
  if (!reply) {
    return reply;
  }
  if (reply.error) {
    throw new Error(reply.error);
  }
  return reply.result !== undefined ? reply.result : reply;
}

/** 取 handler 的 {success, data}，success===false 抛，否则返 data。 */
function _data(inner, fallback) {
  if (inner && inner.success === false) {
    throw new Error(inner.error || "请求失败");
  }
  return inner && inner.data !== undefined ? inner.data : fallback;
}

export function useFamilyGuard() {
  const ws = useWsStore();
  const send = (type, payload = {}, timeoutMs = 15000) =>
    ws.sendRaw({ type, ...payload }, timeoutMs).then(_unwrap);

  return {
    async listChildren() {
      return _data(await send("family-guard.list-children", {}, 10000), []);
    },
    async listChildEvents(params = {}) {
      return _data(await send("family-guard.list-child-events", params), []);
    },
    async appUsageSummary(params = {}) {
      return _data(await send("family-guard.app-usage-summary", params), {
        totalMs: 0,
        apps: [],
      });
    },
  };
}
