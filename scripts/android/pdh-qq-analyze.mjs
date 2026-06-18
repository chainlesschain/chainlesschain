#!/usr/bin/env node
/**
 * pdh-qq-analyze.mjs — Relational analysis over decrypted QQ DBs → Markdown report.
 * 谁在哪个群最活跃 / 和谁聊得最多 / 我的群活跃度。Resolves QQ numbers → nicknames,
 * group numbers → group names (full-column scan link).
 *
 * Usage:
 *   node scripts/android/pdh-qq-analyze.mjs --msg <decrypted nt_msg.db>[,<more>] \
 *        --profile <dec_profile_info.db> --group <dec_group_info.db> [--self <qq>] [--out <file.md>]
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const MSGS = (val('--msg', '')).split(',').filter(Boolean);
const PROFILE = val('--profile'), GROUP = val('--group');
const SELF = val('--self', '');
const OUT = val('--out', 'C:/Users/longfa/Desktop/我的数据库/QQ_关系分析.md');
const S = (v) => (typeof v === 'bigint' ? v.toString() : String(v ?? ''));

// contact map: QQ number → nickname
const nick = new Map();
if (PROFILE) { const db = new Database(PROFILE, { readonly: true }); for (const r of db.prepare('SELECT [1002] uin,[20002] n FROM profile_info_v6').safeIntegers().all()) { const u = S(r.uin); if (u && u !== '0' && typeof r.n === 'string' && r.n.trim()) nick.set(u, r.n.trim()); } db.close(); }
// group map: scan all numeric cols for the one linking to message group ids
const groupName = new Map(); // groupNum → name
let groupCols = [];
if (GROUP) { const db = new Database(GROUP, { readonly: true });
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('group_detail_info_ver1','group_list')").all().map(r => r.name)[0];
  if (tbl) { const rows = db.prepare(`SELECT * FROM ${tbl}`).safeIntegers().all(); groupCols = Object.keys(rows[0] || {});
    // we resolve later once we know the message group ids
    db.close(); var GROUP_ROWS = rows; } else db.close();
}
// tally messages
const senderCount = new Map(), groupCount = new Map(), myGroupMsgs = new Map();
let total = 0;
for (const m of MSGS) {
  if (!fs.existsSync(m)) continue;
  const db = new Database(m, { readonly: true });
  let rows; try { rows = db.prepare('SELECT [40033] sender,[40021] grp,[40011] type FROM group_msg_table').safeIntegers().all(); } catch { db.close(); continue; }
  for (const r of rows) {
    if (Number(r.type) === 5 || Number(r.type) === 9) continue;
    const s = S(r.sender), g = S(r.grp);
    if (s) senderCount.set(s, (senderCount.get(s) || 0) + 1);
    if (g) groupCount.set(g, (groupCount.get(g) || 0) + 1);
    if (SELF && s === SELF && g) myGroupMsgs.set(g, (myGroupMsgs.get(g) || 0) + 1);
    total++;
  }
  db.close();
}
// resolve group names: find which group col holds the message group ids
if (typeof GROUP_ROWS !== 'undefined') {
  const msgGids = new Set(groupCount.keys());
  let bestCol = null, bestHits = 0;
  for (const col of groupCols) { let h = 0; for (const row of GROUP_ROWS) if (msgGids.has(S(row[col]))) h++; if (h > bestHits) { bestHits = h; bestCol = col; } }
  const nameCol = '60007';
  if (bestCol) for (const row of GROUP_ROWS) { const gid = S(row[bestCol]); const nm = row[nameCol]; if (gid && typeof nm === 'string' && nm.trim()) groupName.set(gid, nm.trim()); }
  console.error(`group link col = ${bestCol} (${bestHits} hits)`);
}
const nm = (uin) => nick.get(uin) ? `${nick.get(uin)} (${uin})` : `QQ${uin}`;
const gnm = (g) => groupName.get(g) ? `${groupName.get(g)} (${g})` : `群${g}`;
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

let md = `# QQ 关系分析\n\n> ${total} 条群消息 · ${nick.size} 联系人 · ${groupName.size} 群名已解析\n\n`;
md += `## 最活跃的群（按消息量）\n\n| 群 | 消息数 |\n|---|---|\n`;
for (const [g, c] of top(groupCount, 20)) md += `| ${gnm(g)} | ${c} |\n`;
md += `\n## 群里最活跃的人（按发言量）\n\n| 联系人 | 发言数 |\n|---|---|\n`;
for (const [s, c] of top(senderCount, 25)) md += `| ${nm(s)} | ${c} |\n`;
if (SELF) { md += `\n## 我最活跃的群\n\n| 群 | 我的发言数 |\n|---|---|\n`; for (const [g, c] of top(myGroupMsgs, 15)) md += `| ${gnm(g)} | ${c} |\n`; }
fs.writeFileSync(OUT, md);
console.log('wrote', OUT);
console.log('\n=== 最活跃的群 top5 ===');
for (const [g, c] of top(groupCount, 5)) console.log(`  ${gnm(g)}: ${c}`);
console.log('=== 最活跃的人 top8 ===');
for (const [s, c] of top(senderCount, 8)) console.log(`  ${nm(s)}: ${c}`);
