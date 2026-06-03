/**
 * `mtc.*` (audit / bridge status) WS handlers — 2026-05-07.
 *
 * 暴露 3 个 read-only topic 给 web-panel：
 *   mtc.audit-status   → audit-mtc.getStatus(getAuditMtcDir(homeDir))
 *   mtc.bridge-status  → cross-chain-mtc.getBridgeMtcStatus(getCrossChainMtcDir(homeDir))
 *   mtc.bridge-sla     → cross-chain-mtc.getBridgeMtcSlaMetrics(getCrossChainMtcDir(homeDir))
 *
 * 为什么不用 ws.execute('audit mtc status …') / 'crosschain mtc-status …':
 *   v5.0.3.39 切到 asar:true（B4 ASAR surgery, issue #8）后，spawn `cc` 子进程
 *   冷启动从 dev 的 ~2.5s 涨到打包后 6-10s（asar header 走查 + Node module
 *   resolve 多一层虚拟 fs）。Mtc.vue onMounted 三发并发 (`loadStatus` +
 *   `loadBridgeStatus` + `loadBridgeSla`) 必爆原 8s/6s timeout —— 用户截图
 *   就是这两个错。in-process WS handler 直查文件，零 spawn、零 asar 开销。
 *
 * audit-mtc / cross-chain-mtc 都是 ESM (packages/cli/src/lib/) + 纯文件读
 * (JSON config + staging/batches dir + trust-anchors)，**不**碰 SQLite，
 * 因此不需要 database 注入；只需要 home 目录路径，沿用 `getHomeDir()`。
 *
 * Envelope shape: handler 返回 `{success, ...data}` 或 `{success:false, error}`；
 * ws-cli-loader 包成 `{ok:true, result:{success, ...}}`。客户端走
 * `reply.result.xxx` 读字段（与 sync.* / notification.* / knowledge.* 一致）。
 */

const path = require("path");
const { pathToFileURL } = require("url");

const AUDIT_MTC_REL = "../../../../../packages/cli/src/lib/audit-mtc.js";
const CROSS_CHAIN_MTC_REL =
  "../../../../../packages/cli/src/lib/cross-chain-mtc.js";
const PATHS_REL = "../../../../../packages/cli/src/lib/paths.js";

let _auditMtcPromise = null;
let _crossChainMtcPromise = null;
let _pathsPromise = null;

function loadAuditMtc() {
  if (!_auditMtcPromise) {
    _auditMtcPromise = import(
      pathToFileURL(path.resolve(__dirname, AUDIT_MTC_REL)).href
    );
  }
  return _auditMtcPromise;
}

function loadCrossChainMtc() {
  if (!_crossChainMtcPromise) {
    _crossChainMtcPromise = import(
      pathToFileURL(path.resolve(__dirname, CROSS_CHAIN_MTC_REL)).href
    );
  }
  return _crossChainMtcPromise;
}

function loadPaths() {
  if (!_pathsPromise) {
    _pathsPromise = import(
      pathToFileURL(path.resolve(__dirname, PATHS_REL)).href
    );
  }
  return _pathsPromise;
}

async function _resolveHomeDir(injected) {
  if (typeof injected === "function") {
    return injected();
  }
  const { getHomeDir } = await loadPaths();
  return getHomeDir();
}

function createAuditStatusHandler({ getHomeDir } = {}) {
  return async function auditStatusHandler() {
    try {
      const { getAuditMtcDir, getStatus } = await loadAuditMtc();
      const dir = getAuditMtcDir(await _resolveHomeDir(getHomeDir));
      const status = getStatus(dir);
      return { success: true, status };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createBridgeStatusHandler({ getHomeDir } = {}) {
  return async function bridgeStatusHandler() {
    try {
      const { getCrossChainMtcDir, getBridgeMtcStatus } =
        await loadCrossChainMtc();
      const dir = getCrossChainMtcDir(await _resolveHomeDir(getHomeDir));
      const status = getBridgeMtcStatus(dir);
      return { success: true, status };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createBridgeSlaHandler({ getHomeDir } = {}) {
  return async function bridgeSlaHandler() {
    try {
      const { getCrossChainMtcDir, getBridgeMtcSlaMetrics } =
        await loadCrossChainMtc();
      const dir = getCrossChainMtcDir(await _resolveHomeDir(getHomeDir));
      const metrics = getBridgeMtcSlaMetrics(dir);
      return { success: true, metrics };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createMtcStatusHandlers(opts = {}) {
  return {
    "mtc.audit-status": createAuditStatusHandler(opts),
    "mtc.bridge-status": createBridgeStatusHandler(opts),
    "mtc.bridge-sla": createBridgeSlaHandler(opts),
  };
}

module.exports = {
  createMtcStatusHandlers,
  createAuditStatusHandler,
  createBridgeStatusHandler,
  createBridgeSlaHandler,
};
