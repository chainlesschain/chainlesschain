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

/** A user-exported bearer authorizes one bounded read, never plugin admission. */
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
        ? "/goal-drafts"
        : context.evidence
          ? "/goal-evidence"
          : "/goal-summary";
      const choice = await dialog().showMessageBox(context.parent, {
        type: "question",
        title: context.drafts
          ? "授权 CLI / IDE 提交待审草稿"
          : context.evidence
            ? "连接 CLI / IDE 风险与回执证据"
            : "连接 CLI / IDE 目标摘要",
        message: context.drafts
          ? "允许持有此连接凭据的本机程序，按此来源标签为目标保存待审说明草稿？"
          : context.evidence
            ? "允许持有连接文件的本机程序读取此目标摘要、风险历史与动作回执摘要 15 分钟？"
            : "允许持有连接文件的本机程序读取此目标摘要 15 分钟？",
        detail: context.drafts
          ? [
              `目标：${JSON.stringify(goal.objective)}`,
              `版本：${goal.goalRef.revision}`,
              `来源标签（未经代码鉴定）：${JSON.stringify(context.access.plugin)}`,
              `声明摘要：${context.access.declarationDigest}`,
              "授权持有者读取当前任务说明建议的来源标识，并仅提交待审草稿。此凭据不能鉴定实际运行的插件代码，也不授予任务写入或审批权限。",
              "连接最长15分钟；断开、到期或退出应用后，已保存草稿及此项原生授权仍保留。请在桌面逐项撤销来源授权，使旧草稿及未确认预览失效。CLI 插件信任与此原生授权相互独立。",
              "实际修改任务仍须当前预览与逐次原生确认。连接文件含临时凭据，请保存到私有目录。",
            ].join("\n\n")
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
        const nonce = request.headers["x-cc-nonce"],
          signature = request.headers["x-cc-signature"];
        const authenticated =
          typeof nonce === "string" &&
          /^[a-f0-9]{64}$/.test(nonce) &&
          typeof signature === "string" &&
          /^[a-f0-9]{64}$/.test(signature) &&
          timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(mac(`request\nGET\n${endpointPath}\n${nonce}`)),
          );
        if (
          request.method !== "GET" ||
          request.url !== endpointPath ||
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
          const snapshot = context.evidence ? context.readEvidence() : read();
          const body = JSON.stringify({
            schema: context.evidence
              ? "chainlesschain.project-goal-evidence/v1"
              : "chainlesschain.project-goal-summary/v1",
            ...snapshot,
          });
          if (Buffer.byteLength(body) > 16 * 1024) fail();
          read();
          response.setHeader(
            "X-CC-Signature",
            mac(`response\n${nonce}\n${body}`),
          );
          response.end(body);
        } catch {
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
          ? "chainlesschain.project-goal-connection/v3"
          : context.evidence
            ? "chainlesschain.project-goal-connection/v2"
            : SCHEMA,
        ...(context.drafts
          ? {
              capability: "goal.drafts",
              plugin: context.access.plugin,
              declarationDigest: context.access.declarationDigest,
              grantRef: context.grantRef,
            }
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
