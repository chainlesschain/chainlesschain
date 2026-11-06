"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, timingSafeEqual, createHmac } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const {
  ensurePrivateFile,
  ensurePrivateDirectory,
  inspectPrivatePath,
} = require("@chainlesschain/session-core/private-storage");
const TTL = 15 * 60 * 1000;
const SCHEMA = "chainlesschain.project-goal-connection/v1";
function fail() {
  throw new Error("GOAL_BRIDGE_UNAVAILABLE");
}

/** Native-scoped leases authorize bounded reads or pending drafts. */
function createProjectGoalCliBridge({
  capture,
  dialog,
  clock = Date.now,
  subscribeAuthChanges,
  getConnectionDirectory,
}) {
  let lease = null,
    operation = 0,
    opening = false;
  function close() {
    operation++;
    lease?.close();
    lease = null;
  }
  function status() {
    if (lease) {
      try {
        lease.read();
      } catch {
        close();
      }
    }
    return {
      enabled: !!lease,
      expiresAt: lease?.expiresAt ?? null,
      goalRef: lease?.goalRef ?? null,
    };
  }
  async function open(event, input) {
    if (opening) fail();
    opening = true;
    const stamp = ++operation;
    let pending, context;
    try {
      context = await capture(event, input);
      if (stamp !== operation) fail();
      const goal = context.read();
      const endpointPath = context.drafts
        ? context.createDrafts
          ? "/goal-create-drafts"
          : "/goal-drafts"
        : context.eventHistory
          ? "/goal-event-history"
          : context.events
            ? "/goal-events"
            : context.evidence
              ? "/goal-evidence"
              : "/goal-summary";
      const choice = await dialog().showMessageBox(context.parent, {
        type: "question",
        title: context.drafts
          ? context.createDrafts
            ? "另行授权 CLI 提交待审创建任务草稿"
            : "授权 CLI / IDE 提交待审草稿"
          : context.eventHistory
            ? "授权 CLI 读取保留的事件历史"
            : context.events
              ? "授权 CLI 订阅风险与动作事件"
              : context.evidence
                ? "连接 CLI / IDE 风险与回执证据"
                : "连接 CLI / IDE 目标摘要",
        message: context.drafts
          ? context.createDrafts
            ? "允许持有此连接凭据的本机程序，按此来源标签为目标保存待审创建任务草稿？"
            : "允许持有此连接凭据的本机程序，按此来源标签为目标保存待审说明草稿？"
          : context.eventHistory
            ? "允许持有连接文件的本机程序分页读取此目标保留的风险与动作事件历史 15 分钟？"
            : context.events
              ? "允许持有连接文件的本机程序轮询此目标的风险检查与动作回执摘要 15 分钟？"
              : context.evidence
                ? "允许持有连接文件的本机程序读取此目标摘要、风险历史与动作回执摘要 15 分钟？"
                : "允许持有连接文件的本机程序读取此目标摘要 15 分钟？",
        detail: context.drafts
          ? [
              `目标：${JSON.stringify(goal.objective)}`,
              `版本：${goal.goalRef.revision}`,
              `来源标签（未经代码鉴定）：${JSON.stringify(context.access.plugin)}`,
              `声明摘要：${context.access.declarationDigest}`,
              context.createDrafts
                ? "仅授权当前创建建议的来源标识和待审创建草稿保存，任务类型随提议固定。说明草稿的旧授权不能替代本次授权；此凭据不授予实际创建任务、执行任务或审批权限，也不鉴定插件代码。"
                : "授权持有者读取当前任务说明建议的来源标识，并仅提交待审草稿。此凭据不能鉴定实际运行的插件代码，也不授予任务写入或审批权限。",
              "连接最长15分钟；断开、到期或退出应用后，已保存草稿及此项原生授权仍保留。请在桌面逐项撤销来源授权，使旧草稿及未确认预览失效。CLI 插件信任与此原生授权相互独立。",
              "实际修改任务仍须当前预览与逐次原生确认。连接文件含临时凭据，请保存到私有目录。",
            ].join("\n\n")
          : context.eventHistory
            ? `目标：${JSON.stringify(goal.objective)}\n版本：${goal.goalRef.revision}\n\n另行允许读取事件账本启用后保留的最近1000条风险检查/动作状态事件摘要，每页至多20条。不会补造启用前历史，也不返回任务正文、记忆或审批材料。游标不是权限；恢复时仍需新的有效连接和当前插件准入。保留窗口以外的游标将报告缺口，不保证恰好一次展示。\n\n此授权不同于实时观察，不授予写入或插件信任。连接最长15分钟，断开、身份/导航/数据库/目标版本变化或到期后失效。请将凭据保存到私有目录。`
            : context.events
              ? `目标：${JSON.stringify(goal.objective)}\n版本：${goal.goalRef.revision}\n\n仅可轮询最近一次持久风险检查状态/时间/风险数及最近20条动作回执的标识、状态与类型。连接不包含目标说明、任务正文、记忆或审批材料，不授予写入或插件信任。轮询可能遗漏中间变化，没有历史重放；时间为观察时间，历史检查与回执不证明当前风险已解决或目标已完成。\n\n连接最长15分钟且请求数有上限；断开、退出登录、导航、目标版本变化或到期后失效。请将含临时凭据的连接文件保存在私有目录。`
              : `目标：${JSON.stringify(goal.objective)}\n版本：${goal.goalRef.revision}\n\n${context.evidence ? "另可读取最近一次原生风险检查状态/时间/风险数，以及最近20条动作回执的标识、状态与类型；不包含任务正文或审批材料。历史证据不代表当前风险已解决。" : "可读取此目标的说明、状态与版本。"}不授予任务写入、插件信任或审批权限。连接文件含临时凭据，请保存到私有目录。退出登录、导航、目标版本变化或停止连接后失效。`,
        buttons: ["取消", "允许并保存连接"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      context.read();
      if (stamp !== operation) fail();
      if (choice?.response !== 1) return status();
      const directory = path.resolve(getConnectionDirectory());
      ensurePrivateDirectory(directory, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      if (!inspectPrivatePath(directory).ok) fail();
      const selected = await dialog().showSaveDialog(context.parent, {
        title: "保存临时目标连接（限本机私有连接目录，选择不存在的文件）",
        defaultPath: path.join(
          directory,
          "chainlesschain-goal-connection.json",
        ),
        filters: [{ name: "Goal connection", extensions: ["json"] }],
      });
      context.read();
      if (stamp !== operation) fail();
      if (selected?.canceled || !selected?.filePath) return status();
      if (
        fs.realpathSync(path.dirname(selected.filePath)) !==
          fs.realpathSync(directory) ||
        !inspectPrivatePath(directory).ok
      )
        fail();
      if (context.drafts) {
        context.authorizeDrafts();
        context.read();
        if (stamp !== operation) fail();
      }
      const key = randomBytes(32).toString("hex");
      const mac = (value) =>
        createHmac("sha256", Buffer.from(key, "hex"))
          .update(value)
          .digest("hex");
      const nonces = new Set();
      const expiresAt = clock() + TTL;
      const deadline = performance.now() + TTL;
      let active = true,
        timer,
        unsubscribe = () => {},
        detach = () => {};
      const read = () => {
        if (!active || clock() >= expiresAt || performance.now() >= deadline)
          fail();
        return context.read();
      };
      const server = http.createServer((request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Connection", "close");
        if (context.drafts) {
          require("./project-goal-drafts-transport").handleGoalDraftRequest({
            request,
            response,
            context,
            read,
            mac,
            nonces,
            port: server.address()?.port,
            close: () => pending?.close(),
          });
          return;
        }
        const historyTarget = context.eventHistory
          ? /^\/goal-event-history(?:\?after=([A-Za-z0-9_-]{1,2048}))?$/u.exec(
              request.url || "",
            )
          : null;
        const signedTarget = context.eventHistory ? request.url : endpointPath;
        const nonce = request.headers["x-cc-nonce"],
          signature = request.headers["x-cc-signature"];
        const authenticated =
          typeof nonce === "string" &&
          /^[a-f0-9]{64}$/.test(nonce) &&
          typeof signature === "string" &&
          /^[a-f0-9]{64}$/.test(signature) &&
          timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(mac(`request\nGET\n${signedTarget}\n${nonce}`)),
          );
        if (
          request.method !== "GET" ||
          (context.eventHistory
            ? !historyTarget
            : request.url !== endpointPath) ||
          request.headers.host !== `127.0.0.1:${server.address()?.port}` ||
          request.headers.origin !== undefined ||
          request.headers["sec-fetch-site"] !== undefined ||
          request.headers["transfer-encoding"] !== undefined ||
          (request.headers["content-length"] !== undefined &&
            request.headers["content-length"] !== "0") ||
          !authenticated
        ) {
          response.writeHead(403);
          response.end('{"error":"GOAL_BRIDGE_DENIED"}');
          return;
        }
        if (nonces.has(nonce) || nonces.size >= 512) {
          response.writeHead(429);
          response.end('{"error":"GOAL_BRIDGE_REQUEST_LIMIT"}');
          return;
        }
        nonces.add(nonce);
        try {
          read();
          const snapshot = context.eventHistory
            ? context.readEventPage(historyTarget[1])
            : context.events
              ? context.readEvents()
              : context.evidence
                ? context.readEvidence()
                : read();
          const body = JSON.stringify({
            schema: context.eventHistory
              ? "chainlesschain.goal-event-history/v1"
              : context.events
                ? "chainlesschain.project-goal-events/v1"
                : context.evidence
                  ? "chainlesschain.project-goal-evidence/v1"
                  : "chainlesschain.project-goal-summary/v1",
            ...snapshot,
          });
          if (Buffer.byteLength(body) > 16 * 1024) fail();
          read();
          response.setHeader(
            "X-CC-Signature",
            mac(
              context.eventHistory
                ? `response\n${nonce}\n200\n${body}`
                : `response\n${nonce}\n${body}`,
            ),
          );
          response.end(body);
        } catch (error) {
          if (context.eventHistory) {
            const code = [
              "GOAL_EVENT_CURSOR_INVALID",
              "GOAL_EVENT_HISTORY_GAP",
              "GOAL_EVENT_HISTORY_REGRESSED",
              "GOAL_EVENT_HISTORY_UNAVAILABLE",
              "GOAL_EVENT_HISTORY_INVALID",
            ].includes(error?.code)
              ? error.code
              : "GOAL_BRIDGE_UNAVAILABLE";
            const status = code === "GOAL_BRIDGE_UNAVAILABLE" ? 410 : 409;
            const body = JSON.stringify({ error: code });
            response.setHeader(
              "X-CC-Signature",
              mac(`response\n${nonce}\n${status}\n${body}`),
            );
            response.writeHead(status);
            response.end(body);
            if (status === 410) pending?.close();
            return;
          }
          response.writeHead(410);
          response.end('{"error":"GOAL_BRIDGE_UNAVAILABLE"}');
          pending?.close();
        }
      });
      server.maxConnections = 8;
      server.maxHeadersCount = 16;
      server.headersTimeout = 5000;
      server.requestTimeout = 5000;
      server.on("connection", (socket) =>
        socket.setTimeout(5000, () => socket.destroy()),
      );
      pending = {
        expiresAt,
        goalRef: goal.goalRef,
        grantId: context.grantRef?.id,
        read,
        close() {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          unsubscribe();
          detach();
          context.dispose();
          nonces.clear();
          server.close(() => {});
          server.closeIdleConnections();
          if (lease === pending) lease = null;
        },
      };
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      server.unref();
      unsubscribe = subscribeAuthChanges(() => pending.close());
      detach = context.onInvalidate(() => pending.close());
      read();
      if (stamp !== operation) fail();
      const descriptor = {
        schema: context.drafts
          ? context.createDrafts
            ? "chainlesschain.project-goal-connection/v6"
            : "chainlesschain.project-goal-connection/v3"
          : context.eventHistory
            ? "chainlesschain.project-goal-connection/v5"
            : context.events
              ? "chainlesschain.project-goal-connection/v4"
              : context.evidence
                ? "chainlesschain.project-goal-connection/v2"
                : SCHEMA,
        ...(context.drafts
          ? {
              capability: context.createDrafts
                ? "goal.create-drafts"
                : "goal.drafts",
              plugin: context.access.plugin,
              declarationDigest: context.access.declarationDigest,
              grantRef: context.grantRef,
            }
          : context.eventHistory
            ? { capability: "goal.event-history" }
            : context.events
              ? { capability: "goal.events" }
              : context.evidence
                ? { capability: "goal.evidence" }
                : {}),
        endpoint: `http://127.0.0.1:${server.address().port}${endpointPath}`,
        key,
        goalRef: goal.goalRef,
        expiresAt,
      };
      const fd = fs.openSync(selected.filePath, "wx", 0o600);
      try {
        ensurePrivateFile(selected.filePath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
        const opened = fs.fstatSync(fd),
          current = fs.lstatSync(selected.filePath);
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          opened.ino !== current.ino ||
          opened.dev !== current.dev ||
          opened.nlink !== 1
        )
          fail();
        fs.writeFileSync(fd, JSON.stringify(descriptor));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      read();
      lease?.close();
      lease = pending;
      timer = setTimeout(() => pending.close(), TTL);
      timer.unref();
      return status();
    } catch {
      pending?.close();
      fail();
    } finally {
      if (!pending || pending !== lease) context?.dispose();
      opening = false;
    }
  }
  return {
    open,
    close,
    status,
    closeGrant(id) {
      if (lease?.grantId === id) close();
    },
  };
}
module.exports = { createProjectGoalCliBridge };
