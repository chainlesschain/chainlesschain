#!/usr/bin/env node
"use strict";
/*
 * Generate the PDH app-data catalog: a machine + human index of "which app has
 * what data and where it lands in PDH", built FROM each adapter's own metadata
 * (name / capabilities / dataDisclosure.fields / sensitivity) + adapter-guide
 * category. Lets the personal AI find data across all ~80 apps without hand-docs.
 *
 * Output: docs/internal/pdh-app-data-catalog.md  +  .json (AI-consumable)
 * Run: node scripts/pdh/gen-app-data-catalog.js
 * Schema-only (no real personal data).
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const pdh = require(path.join(REPO, "packages/personal-data-hub/lib"));
let guide = {};
try { guide = require(path.join(REPO, "packages/personal-data-hub/lib/adapter-guide")); } catch (_e) {}
const displayName = guide.displayName || ((n) => n);

// data-domain category (for "AI find data"), derived from adapter name prefix.
const DOMAIN = [
  [/^shopping-/, "购物/电商"], [/^social-/, "社交/内容"], [/^travel-|^car-/, "出行/车"],
  [/^bank-|^finance-|^alipay|alipay-bill/, "金融/支付"], [/^messaging-|^wechat|^qq|-pc$|wework/, "即时通讯"],
  [/^music-|^audio-|^video-|^reading-/, "媒体/阅读"], [/^edu-/, "教育/学习"], [/^gov-/, "政务"],
  [/^doc-/, "文档/云盘"], [/^fitness-|^health-|apple-health/, "健康/运动"], [/^email/, "邮件"],
  [/^recruit-/, "招聘"], [/^biz-/, "企业/工商"], [/^game-/, "游戏"],
  [/^browser-|^local-|^shell-|^git-|^system|^win-|^vscode/, "本地/系统"],
  [/^ai-chat/, "AI 对话"],
];
function inferCategory(name) {
  for (const [re, cat] of DOMAIN) if (re.test(name)) return cat;
  return "其它";
}

// permissive opts so most constructors succeed (they read dataDisclosure there)
const OPTS = {
  account: { uid: "_catalog", uin: "_catalog", email: "catalog@example.com", username: "_catalog" },
  dbPath: null,
  deps: { chat: async () => ({ text: "" }) },
};

const rows = [];
const failed = [];
for (const key of Object.keys(pdh)) {
  if (!/Adapter$/.test(key) || key === "MockAdapter" || key === "CcLLMAdapter") continue;
  const Cls = pdh[key];
  if (typeof Cls !== "function") continue;
  let inst = null;
  for (const o of [OPTS, { ...OPTS, account: undefined }, {}]) {
    try { inst = new Cls(o); break; } catch (_e) { /* try next */ }
  }
  if (!inst || !inst.name) { failed.push(key); continue; }
  const dd = inst.dataDisclosure || {};
  rows.push({
    export: key,
    name: inst.name,
    display: displayName(inst.name),
    category: (typeof inferCategory === "function" ? inferCategory(inst.name) : "unknown") || "unknown",
    version: inst.version || null,
    capabilities: inst.capabilities || [],
    fields: Array.isArray(dd.fields) ? dd.fields : [],
    sensitivity: dd.sensitivity || "unknown",
    legalGate: !!dd.legalGate,
  });
}
rows.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));

// JSON (for AI)
const jsonPath = path.join(REPO, "docs/internal/pdh-app-data-catalog.json");
fs.writeFileSync(jsonPath, JSON.stringify({ generated: "run gen-app-data-catalog.js", count: rows.length, adapters: rows }, null, 2));

// Markdown (for humans + AI find)
const byCat = {};
for (const r of rows) (byCat[r.category] = byCat[r.category] || []).push(r);
let md = `# PDH App 数据目录（自动生成，供 AI 找数据）

> 由 \`scripts/pdh/gen-app-data-catalog.js\` 从各 adapter 自带元数据生成 —— 索引「哪个 app
> 有什么数据、怎么采、敏感度」。**共 ${rows.length} 个 adapter。** 详细表/字段级 schema 见
> \`pdh-app-db-schemas.md\`（微信/抖音等已展开）。重新生成：\`node scripts/pdh/gen-app-data-catalog.js\`。
>
> 列含义：**采集方式** = capabilities（sync:cookie-api/sqlite/snapshot/...）；**敏感度** =
> dataDisclosure.sensitivity；🔒 = legalGate（需法律/用户同意门）。

`;
for (const cat of Object.keys(byCat).sort()) {
  md += `\n## 分类: ${cat}（${byCat[cat].length}）\n\n`;
  md += `| App | 名称 | 采集方式 | 敏感度 | 数据字段（摘要）|\n|---|---|---|---|---|\n`;
  for (const r of byCat[cat]) {
    const caps = r.capabilities.filter((c) => c.startsWith("sync:")).map((c) => c.slice(5)).join("/") || "—";
    const fields = (r.fields.slice(0, 4).join("; ") || "—").replace(/\|/g, "/").slice(0, 120);
    md += `| ${r.display} | \`${r.name}\` | ${caps} | ${r.sensitivity}${r.legalGate ? " 🔒" : ""} | ${fields} |\n`;
  }
}
if (failed.length) md += `\n> 未能自省（需特殊构造参数）：${failed.join(", ")}\n`;
const mdPath = path.join(REPO, "docs/internal/pdh-app-data-catalog.md");
fs.writeFileSync(mdPath, md);
console.log(`catalog: ${rows.length} adapters across ${Object.keys(byCat).length} categories; failed=${failed.length}`);
console.log(`wrote ${path.relative(REPO, mdPath)} + .json`);
