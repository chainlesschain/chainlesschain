/**
 * `cc android` — Android-side data + control commands.
 *
 * Plan A Sub-Phase A7 scaffold. Exposes the bridge surface from
 * `lib/cc-android-bridge.js` as commander subcommands. Method shapes mirror
 * `docs/design/Personal_Data_Hub_Android_Standalone_Cc.md` §6.1.
 *
 * **v0.1 status**: native JNI bridge (`cc-android-bridge.node`) not yet
 * bundled (A6 in progress). On non-Android hosts every command exits non-zero
 * with `ANDROID_BRIDGE_NOT_AVAILABLE`. On Android with a missing binding,
 * same error with a different reason string. This lets the surface land and
 * be tested ahead of the JNI shipping work.
 *
 * All commands support `--json` for scripting and exit non-zero on error.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import * as bridgeModule from "../lib/cc-android-bridge.js";

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(err, asJson) {
  const msg = err && err.message ? err.message : String(err);
  const code = err && err.code ? err.code : null;
  if (asJson) {
    printJson({ error: msg, code });
  } else {
    logger.error(chalk.red(`✗ ${msg}`));
  }
  process.exit(1);
}

async function run(method, params, options) {
  try {
    const result = await _deps.bridge.invoke(method, params);
    if (options.json) {
      printJson(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    fail(err, options.json);
  }
}

// ─── caps ────────────────────────────────────────────────────────────

async function cmdCaps(options) {
  const capsResult = _deps.bridge.caps();
  if (options.json) {
    printJson(capsResult);
    return;
  }
  if (capsResult.available) {
    logger.log(chalk.green("✓ android bridge available"));
  } else {
    logger.log(
      chalk.yellow(`⚠ android bridge unavailable: ${capsResult.reason}`),
    );
  }
}

// ─── contacts / sms / calls — P1 ContentResolver ─────────────────────

function cmdContactsPull(options) {
  return run(
    "contacts.query",
    { since: options.since ? Number(options.since) : undefined },
    options,
  );
}
function cmdSmsPull(options) {
  return run(
    "sms.query",
    { since: options.since ? Number(options.since) : undefined },
    options,
  );
}
function cmdCallsPull(options) {
  return run(
    "calls.query",
    { since: options.since ? Number(options.since) : undefined },
    options,
  );
}

// ─── app — PackageManager ────────────────────────────────────────────

function cmdAppList(options) {
  return run("app.list", { includeSystem: !!options.system }, options);
}
function cmdAppLaunch(pkg, options) {
  return run("app.launch", { pkg }, options);
}
function cmdAppIntent(pkg, action, options) {
  const extras = {};
  if (Array.isArray(options.extra)) {
    for (const kv of options.extra) {
      const idx = kv.indexOf("=");
      if (idx > 0) extras[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
  }
  return run("app.intent", { pkg, action, extras }, options);
}

// ─── fs — SAF / sandbox ──────────────────────────────────────────────

function cmdFsRead(target, options) {
  return run("fs.read", { target }, options);
}
function cmdFsList(target, options) {
  return run("fs.list", { target }, options);
}

// ─── a11y — Accessibility Service ────────────────────────────────────

function cmdA11yQuery(options) {
  return run("a11y.query", { filter: options.filter }, options);
}
function cmdA11yClick(nodeId, options) {
  return run("a11y.click", { nodeId }, options);
}
function cmdA11yType(text, options) {
  return run("a11y.type", { text }, options);
}

// ─── shizuku / root ──────────────────────────────────────────────────

function cmdShizukuExec(cmd, options) {
  return run("shizuku.exec", { cmd }, options);
}
function cmdRootExec(cmd, options) {
  return run("root.exec", { cmd }, options);
}

// ─── perms ────────────────────────────────────────────────────────────

function cmdPerms(name, options) {
  return run("perms.check", { name }, options);
}

// ─── Commander wire-up ───────────────────────────────────────────────

export function registerAndroidCommand(program) {
  const android = program
    .command("android")
    .description(
      "Android-native bridge: ContentResolver / SAF / Accessibility / Shizuku / root (Plan A A7)",
    );

  android
    .command("caps")
    .description("Probe what bridge capabilities are available on this device")
    .option("--json", "Output JSON")
    .action(cmdCaps);

  const contacts = android
    .command("contacts")
    .description("ContentResolver: contacts");
  contacts
    .command("pull")
    .description("Pull contacts (READ_CONTACTS runtime permission required)")
    .option("--since <ms>", "Watermark — only newer entries")
    .option("--json", "Output JSON")
    .action(cmdContactsPull);

  const sms = android.command("sms").description("ContentResolver: SMS");
  sms
    .command("pull")
    .description("Pull SMS (READ_SMS runtime permission required)")
    .option("--since <ms>", "Watermark")
    .option("--json", "Output JSON")
    .action(cmdSmsPull);

  const calls = android
    .command("calls")
    .description("ContentResolver: call log");
  calls
    .command("pull")
    .description("Pull call log (READ_CALL_LOG runtime permission required)")
    .option("--since <ms>", "Watermark")
    .option("--json", "Output JSON")
    .action(cmdCallsPull);

  const app = android
    .command("app")
    .description("PackageManager: app inventory + Intent");
  app
    .command("list")
    .description("List installed packages")
    .option("--system", "Include system packages")
    .option("--json", "Output JSON")
    .action(cmdAppList);
  app
    .command("launch <pkg>")
    .description("Launch app by package id (default activity)")
    .option("--json", "Output JSON")
    .action(cmdAppLaunch);
  app
    .command("intent <pkg> <action>")
    .description("Fire an Intent at <pkg> with <action>")
    .option(
      "--extra <kv...>",
      "Repeatable extras as KEY=VAL (e.g. --extra foo=bar --extra n=1)",
    )
    .option("--json", "Output JSON")
    .action(cmdAppIntent);

  const fs = android.command("fs").description("SAF / sandbox filesystem");
  fs.command("read <target>")
    .description("Read file (sandbox path OR SAF tree URI)")
    .option("--json", "Output JSON")
    .action(cmdFsRead);
  fs.command("list <target>")
    .description("List directory")
    .option("--json", "Output JSON")
    .action(cmdFsList);

  const a11y = android.command("a11y").description("Accessibility Service");
  a11y
    .command("query")
    .description("Dump current screen's node tree")
    .option("--filter <css>", "css-like filter")
    .option("--json", "Output JSON")
    .action(cmdA11yQuery);
  a11y
    .command("click <nodeId>")
    .description("Click a node")
    .option("--json", "Output JSON")
    .action(cmdA11yClick);
  a11y
    .command("type <text>")
    .description("Type text into focused field")
    .option("--json", "Output JSON")
    .action(cmdA11yType);

  const shizuku = android
    .command("shizuku")
    .description("Shizuku ADB-like privileges");
  shizuku
    .command("exec <cmd>")
    .description("Run shell via Shizuku")
    .option("--json", "Output JSON")
    .action(cmdShizukuExec);

  const root = android.command("root").description("Magisk root su");
  root
    .command("exec <cmd>")
    .description("Run shell as root")
    .option("--json", "Output JSON")
    .action(cmdRootExec);

  android
    .command("perms <name>")
    .description("Check (and request) a runtime permission")
    .option("--json", "Output JSON")
    .action(cmdPerms);
}

// _deps injection seam — tests reach in and replace `bridge` with a mock so
// the cmd* functions exercise the routing code without a real bridge.
export const _deps = { bridge: bridgeModule };

// Test-only exports.
export const _cmds = {
  cmdCaps,
  cmdContactsPull,
  cmdSmsPull,
  cmdCallsPull,
  cmdAppList,
  cmdAppLaunch,
  cmdAppIntent,
  cmdFsRead,
  cmdFsList,
  cmdA11yQuery,
  cmdA11yClick,
  cmdA11yType,
  cmdShizukuExec,
  cmdRootExec,
  cmdPerms,
};
