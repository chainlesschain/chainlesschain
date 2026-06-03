#!/usr/bin/env node
/**
 * audit-webview-cookie-race.js — trap #20 static-scan gate
 *
 * Detects `WebViewClient.onPageFinished` overrides that call
 * `CookieManager.getCookie(...)` without a `postDelayed(...)` defer.
 *
 * The trap: Bilibili / Weibo / Douyin / Xiaohongshu / 抖音 anti-spider
 * keys (buvid3 / bili_jct / SUB / SUBP / web_session / sessionid_ucp_v1
 * / ...) are written by JavaScript that runs AFTER window.onload.
 * `onPageFinished` fires at window.onload. Reading the cookie jar
 * inline beats those writes → cookies missing the keys → API returns
 * `{code:0, data:{list:[]}}` silently → user sees "登录成功" but next
 * sync produces 0 events.
 *
 * Correct pattern (`SocialCookieWebViewScreen.kt:660`):
 *
 *     override fun onPageFinished(view: WebView, url: String) {
 *         if (isLoginSuccess(url)) {
 *             view.postDelayed({                    // ← defer 2-5s
 *                 CookieManager.getInstance().flush()
 *                 val cookie = CookieManager.getInstance().getCookie(domain)
 *                 ...
 *             }, COOKIE_CAPTURE_DELAY_MS)
 *         }
 *     }
 *
 * Anti-pattern (what we flag):
 *
 *     override fun onPageFinished(view: WebView, url: String) {
 *         val cookie = CookieManager.getInstance().getCookie(domain)
 *         //                                       ^^^^^^^^^^ raced
 *     }
 *
 * Usage:
 *   node scripts/audit-webview-cookie-race.js           # scan tree
 *   node scripts/audit-webview-cookie-race.js --json    # machine-readable
 *
 * Exit: 0 if clean, 1 if findings. PR workflow runs advisory (continue-
 * on-error) so it surfaces but doesn't block — the static heuristic
 * might miss valid deferral patterns (Handler.post / coroutines /
 * helper-function indirection) and flag them as false positives.
 *
 * See: docs/internal/hidden-risk-traps.md §20
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["android-app/app/src/main", "android-app/app/src/test"];
const SKIP_RE =
  /(?:^|[\\/])(?:build|generated|\.gradle|node_modules)(?:[\\/]|$)/;

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitFiles = args.filter((a) => !a.startsWith("--"));

/**
 * Walk a directory tree yielding .kt file paths.
 */
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (SKIP_RE.test(full)) continue;
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".kt")) {
      yield full;
    }
  }
}

/**
 * Capture the body of a function whose `(` is at `parenStart` — balance
 * parens to find the close `)`, then balance braces of the body.
 * Returns the full text including the outer braces. Null if unbalanced.
 */
function captureFunctionBody(src, fnHeaderStart) {
  // 1. Find the open paren of the parameter list.
  const parenStart = src.indexOf("(", fnHeaderStart);
  if (parenStart < 0) return null;
  // 2. Balance parens to find param-list close.
  let depth = 0;
  let inStr = null;
  let escape = false;
  let i = parenStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  // 3. Now skip whitespace + look for `{` (body start).
  while (i < src.length && /[\s\r\n]/.test(src[i])) i++;
  if (src[i] !== "{") return null;
  const bodyStart = i;
  // 4. Balance braces.
  depth = 0;
  inStr = null;
  escape = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i + 1);
    }
  }
  return null;
}

/**
 * Returns line number for a character offset.
 */
function offsetToLine(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

// Match `onPageFinished(` (any whitespace before `(`).
const ONPAGE_RE = /\b(?:override\s+)?fun\s+onPageFinished\s*\(/g;
// getCookie( call (any receiver).
const GETCOOKIE_RE = /\bgetCookie\s*\(/;
// Defer indicators — postDelayed / Handler.postDelayed / coroutine delay /
// LaunchedEffect / Handler.post (still queued, often acceptable).
const DEFER_RE =
  /\bpostDelayed\s*\(|\bHandler\([^)]*\)\.post(?:Delayed)?\s*\(|\bdelay\s*\(\s*\d+|\bLaunchedEffect\s*\(|\blifecycleScope\.launch\s*\{/;

function scanFile(file) {
  let src;
  try {
    src = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  // Cheap pre-filter.
  if (
    !ONPAGE_RE.test(src) ||
    !GETCOOKIE_RE.test(src)
  ) {
    ONPAGE_RE.lastIndex = 0;
    return [];
  }
  ONPAGE_RE.lastIndex = 0;

  const findings = [];
  let m;
  while ((m = ONPAGE_RE.exec(src))) {
    const fnStart = m.index;
    const body = captureFunctionBody(src, fnStart);
    if (!body) continue;
    const hasGetCookie = GETCOOKIE_RE.test(body);
    if (!hasGetCookie) continue;
    const hasDefer = DEFER_RE.test(body);
    if (hasDefer) continue;
    // Find the getCookie line for the finding location.
    const getCookieIdx = body.search(GETCOOKIE_RE);
    const absOffset = fnStart + (getCookieIdx >= 0 ? getCookieIdx : 0);
    findings.push({
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      line: offsetToLine(src, absOffset),
      severity: "HIGH",
      message:
        "getCookie() called inside onPageFinished without postDelayed/Handler.post/delay/launch defer — trap #20 cookie race",
      snippet: body
        .slice(0, 200)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return findings;
}

function collectFiles() {
  if (explicitFiles.length > 0) {
    return explicitFiles
      .map((p) => path.resolve(p))
      .filter((p) => p.endsWith(".kt") && fs.existsSync(p));
  }
  const out = [];
  for (const sub of SCAN_DIRS) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) out.push(f);
  }
  return out;
}

function main() {
  const files = collectFiles();
  const allFindings = [];
  for (const f of files) {
    const findings = scanFile(f);
    allFindings.push(...findings);
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        { findings: allFindings, scanned: files.length },
        null,
        2,
      ) + "\n",
    );
    process.exit(allFindings.length > 0 ? 1 : 0);
  }

  if (allFindings.length === 0) {
    console.log(
      `✅ audit-webview-cookie-race: 0 findings in ${files.length} Kotlin files`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  audit-webview-cookie-race: ${allFindings.length} finding(s) in ${files.length} files`,
  );
  console.log(
    `   Trap #20 — onPageFinished + inline getCookie races post-onload JS that`,
  );
  console.log(
    `   writes anti-spider keys (buvid3 / SUB / web_session / sessionid_ucp_v1).`,
  );
  console.log(
    `   Fix: wrap with view.postDelayed({ ... }, COOKIE_CAPTURE_DELAY_MS).`,
  );
  console.log("");
  for (const f of allFindings) {
    console.log(`  ${f.file}:${f.line}  [${f.severity}]  ${f.message}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("");
  console.log(
    `   See docs/internal/hidden-risk-traps.md §20 and reference fix at`,
  );
  console.log(
    `   android-app/.../pdh/social/SocialCookieWebViewScreen.kt:660.`,
  );
  process.exit(1);
}

main();
