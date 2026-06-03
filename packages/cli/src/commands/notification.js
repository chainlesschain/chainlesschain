/**
 * `cc notification send` — push a notification to a paired mobile device.
 *
 * Wire model: the desktop Electron app (when running with --web-shell) starts
 * a ws-bridge on an OS-assigned port and writes the bound URL into
 * `~/.chainlesschain/desktop.port`. We read that file, open a WebSocket, and
 * invoke the `notification.send-mobile` topic which routes to
 * remoteGateway.handlers.notification.sendToMobile inside the desktop
 * process, which in turn pushes over the P2P DC to the paired iPhone/Android.
 *
 * Exit codes:
 *   0  success
 *   2  desktop port file missing or stale (desktop app not running)
 *   3  desktop returned ok:false / handler unavailable / network error
 *   4  invalid args
 *
 * Implemented as part of #21 v1.3+ to unblock plan
 * `iOS_Phase_6_0_RealDevice_E2E_Plan.md` §6 D2/D3/D6 reproducer.
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import WebSocket from "ws";

const PORT_FILE = path.join(os.homedir(), ".chainlesschain", "desktop.port");
const TOPIC = "notification.send-mobile";
const RESULT_TOPIC = "notification.send-mobile.result";

export function registerNotificationCommand(program) {
  const cmd = program
    .command("notification")
    .alias("notif")
    .description("Push notifications to paired mobile devices");

  cmd
    .command("send")
    .description("Send a push notification to a paired iPhone/Android")
    .requiredOption(
      "--target <did>",
      "Target device DID (paired iPhone/Android)",
    )
    .requiredOption("--title <title>", "Notification title")
    .option("--body <body>", "Notification body", "")
    .option(
      "--silenced",
      "Send envelope without ringing (delivery-only, for quiet hours test)",
    )
    .option("--type <type>", "Notification type", "app")
    .option("--timeout <ms>", "RPC timeout in milliseconds", "10000")
    .option("--json", "Emit machine-readable JSON instead of human text")
    .action(async (options) => {
      const exitCode = await runSendNotification(options);
      process.exit(exitCode);
    });
}

export async function runSendNotification(options, _deps = {}) {
  const fsDep = _deps.fs || fs;
  const wsDep = _deps.WebSocket || WebSocket;
  const portFilePath = _deps.portFilePath || PORT_FILE;
  const log = _deps.log || console.log;
  const err = _deps.err || ((m) => console.error(m));

  let descriptor;
  try {
    const raw = fsDep.readFileSync(portFilePath, "utf-8");
    descriptor = JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") {
      err(
        options.json
          ? JSON.stringify({
              success: false,
              error: "desktop_not_running",
              portFile: portFilePath,
            })
          : `桌面未运行（找不到 ${portFilePath}）。请先启动 ChainlessChain 桌面 app (\`cd desktop-app-vue && npm run dev\`)。`,
      );
      return 2;
    }
    err(
      options.json
        ? JSON.stringify({
            success: false,
            error: "port_file_unreadable",
            detail: e.message,
          })
        : `读取桌面 port 文件失败: ${e.message}`,
    );
    return 2;
  }

  if (!descriptor || typeof descriptor.wsUrl !== "string") {
    err(
      options.json
        ? JSON.stringify({
            success: false,
            error: "port_file_malformed",
            descriptor,
          })
        : `桌面 port 文件格式错误: ${JSON.stringify(descriptor)}`,
    );
    return 2;
  }

  // Stale-pid check: if the writing process is gone, the port is dead.
  if (typeof descriptor.pid === "number" && descriptor.pid > 0) {
    try {
      // process.kill with signal 0 doesn't actually send anything — it only
      // tests if the pid exists and we can signal it.
      process.kill(descriptor.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") {
        err(
          options.json
            ? JSON.stringify({
                success: false,
                error: "desktop_stale_pid",
                pid: descriptor.pid,
              })
            : `桌面 port 文件存在但 pid=${descriptor.pid} 已退出（残留文件，可手动 rm ${portFilePath} 或重启桌面）。`,
        );
        return 2;
      }
      // EPERM = process exists but we can't signal it (still alive, fine)
    }
  }

  const requestId = crypto.randomUUID();
  // ws-bridge protocol: frame.type is the topic name; notification semantic
  // type rides on frame.notificationType.
  const frame = {
    type: TOPIC,
    id: requestId,
    title: options.title,
    body: options.body || "",
    target: options.target,
    silent: !!options.silenced,
    notificationType: options.type,
  };

  const timeoutMs = Math.max(
    1000,
    Math.min(120000, parseInt(options.timeout, 10) || 10000),
  );

  const result = await new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    let socket;
    try {
      socket = new wsDep(descriptor.wsUrl);
    } catch (e) {
      finish({
        success: false,
        error: "ws_construct_failed",
        detail: e.message,
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        socket.terminate();
      } catch {
        /* ignore */
      }
      finish({ success: false, error: "rpc_timeout", timeoutMs });
    }, timeoutMs);

    socket.on("open", () => {
      try {
        socket.send(JSON.stringify(frame));
      } catch (e) {
        clearTimeout(timer);
        finish({ success: false, error: "ws_send_failed", detail: e.message });
      }
    });

    socket.on("message", (raw) => {
      let response;
      try {
        response = JSON.parse(raw.toString("utf-8"));
      } catch (e) {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        finish({
          success: false,
          error: "invalid_response_json",
          detail: e.message,
        });
        return;
      }
      if (response?.id !== requestId) {
        // Ignore unrelated frames (ws-bridge may have other subscribers).
        return;
      }
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (response.type !== RESULT_TOPIC) {
        finish({
          success: false,
          error: "unexpected_response_topic",
          response,
        });
        return;
      }
      if (response.ok === true) {
        finish({ success: true, result: response.result });
      } else {
        finish({ success: false, error: response.error || "unknown_error" });
      }
    });

    socket.on("error", (e) => {
      clearTimeout(timer);
      finish({
        success: false,
        error: "ws_error",
        detail: e?.message || String(e),
      });
    });
  });

  if (result.success) {
    if (options.json) {
      log(JSON.stringify(result));
    } else {
      log(`✔ 通知已推送 (target=${options.target}, title="${options.title}")`);
      if (result.result && typeof result.result === "object") {
        log(`  详情: ${JSON.stringify(result.result)}`);
      }
    }
    return 0;
  }

  if (options.json) {
    err(JSON.stringify(result));
  } else {
    err(
      `✖ 推送失败: ${result.error}${result.detail ? ` — ${result.detail}` : ""}`,
    );
  }
  return 3;
}
