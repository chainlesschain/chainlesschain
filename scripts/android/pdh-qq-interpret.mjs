#!/usr/bin/env node
/**
 * pdh-qq-interpret.mjs — 生成「QQ 数据库实例解读」MD（结合真实数据逐字段解读 + 关联演示）。
 * 含真实个人数据 → 输出到桌面(非 git)。脚本本身无数据，可入 git。
 * Usage: node scripts/android/pdh-qq-interpret.mjs --msg <nt_msg.db> --profile <p> --group <g> --self <qq> --out <md>
 */
import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const A = process.argv.slice(2); const val = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const MSG = val('--msg'), PROFILE = val('--profile'), GROUP = val('--group'), SELF = val('--self', '');
const OUT = val('--out', 'C:/Users/longfa/Desktop/我的数据库/解读_QQ.md');
const S = (v) => (typeof v === 'bigint' ? v.toString() : String(v ?? ''));
// protobuf text
function rv(b, p) { let s = 0, r = 0n; while (p < b.length) { const x = b[p++]; r |= BigInt(x & 0x7f) << BigInt(s); if (!(x & 0x80)) break; s += 7; } return [r, p]; }
function* fl(b) { let p = 0; while (p < b.length) { let t;[t, p] = rv(b, p); t = Number(t); const w = t & 7; if (w === 0) { let v;[v, p] = rv(b, p); } else if (w === 2) { let l;[l, p] = rv(b, p); l = Number(l); const d = b.subarray(p, p + l); p += l; yield d; } else if (w === 5) p += 4; else if (w === 1) p += 8; else return; } }
const okT = (s) => s && /[一-鿿A-Za-z0-9]/.test(s) && ![...s].some((c) => c.charCodeAt(0) < 32 && c !== '\n');
function tx(b, d, o) { if (d > 6 || !b?.length) return; for (const x of fl(b)) { if (!x?.length) continue; let s = null; try { s = x.toString('utf8'); } catch {} if (s && Buffer.from(s, 'utf8').equals(x) && okT(s) && s.length <= 200) o.push(s); if (x.length >= 2) tx(x, d + 1, o); } }
const body = (b) => { if (!Buffer.isBuffer(b)) return ''; const o = []; tx(b, 0, o); return (o.filter((t) => /[一-鿿]/.test(t)).sort((a, b) => b.length - a.length)[0] || o[0] || ''); };

const msg = new Database(MSG, { readonly: true });
const prof = PROFILE ? new Database(PROFILE, { readonly: true }) : null;
const grp = GROUP ? new Database(GROUP, { readonly: true }) : null;
const nick = new Map(); if (prof) for (const r of prof.prepare('SELECT [1002] u,[20002] n FROM profile_info_v6').safeIntegers().all()) { const u = S(r.u); if (u && typeof r.n === 'string' && r.n.trim()) nick.set(u, r.n.trim()); }
const gname = new Map(); if (grp) { try { for (const r of grp.prepare('SELECT [60001] g,[60007] n FROM group_list').safeIntegers().all()) { const g = S(r.g); if (g && typeof r.n === 'string') gname.set(g, r.n.trim()); } } catch {} }
const TYPE = { 2: '普通消息(文本/图文)', 5: '特殊消息·含文本(回复/转发等)', 9: '特殊消息·含文本', 3: '文件消息(文件名在正文)', 7: '视频/短视频', 10: 'QQ红包', 1: '图片/系统(正文常空)', 11: '图片/系统', 8: '特殊(加密/灰条)', 17: '特殊' };

let md = `# QQ NT 数据库 — 实例解读（你的真实数据）\n\n`;
md += `> ⚠️ 含真实聊天/联系人，仅本地查看，勿外传。结构详解(无数据)见 \`docs/internal/reference/数据库表结构详解.md\`。\n\n`;
md += `## 一、一条群消息长什么样（逐字段实例）\n\n`;
const sample = msg.prepare("SELECT [40001] mid,[40033] sender,[40021] grp,[40050] t,[40011] type,[40012] sub,[40800] b FROM group_msg_table WHERE [40011]=2 AND [40033]!=0 LIMIT 1").safeIntegers().get();
if (sample) {
  const sd = S(sample.sender), gd = S(sample.grp);
  md += `取 group_msg_table 一行（type=2 普通消息）：\n\n`;
  md += `| 列 | 原始值 | 解读 |\n|---|---|---|\n`;
  md += `| 40001 (msgId) | ${S(sample.mid)} | 这条消息的本地ID(19位雪花) |\n`;
  md += `| 40033 (发送者QQ) | ${sd} | → profile_info_v6 查到昵称：**${nick.get(sd) || '(非好友/未缓存)'}** |\n`;
  md += `| 40021 (群号) | ${gd} | → group_list 查到群名：**${gname.get(gd) || '(未在群表)'}** |\n`;
  md += `| 40050 (时间) | ${S(sample.t)} | ×1000 = ${new Date(Number(sample.t) * 1000).toLocaleString('zh-CN')} |\n`;
  md += `| 40011/40012 (类型) | ${S(sample.type)}/${S(sample.sub)} | ${TYPE[Number(sample.type)] || '?'} |\n`;
  md += `| 40800 (正文protobuf) | \`<二进制>\` | 递归解码得文本：**"${body(sample.b).slice(0, 50)}"** |\n\n`;
  md += `**→ 一句话还原**：${new Date(Number(sample.t) * 1000).toLocaleDateString('zh-CN')}，在群「${gname.get(gd) || gd}」里，${nick.get(sd) || ('QQ' + sd)} 说了「${body(sample.b).slice(0, 40)}」。\n\n`;
}
md += `## 二、消息类型码 40011 实测（从你的数据统计 + 抽样推断）\n\n`;
md += `| 40011 | 条数 | 推断含义 | 真实样本 |\n|---|---|---|---|\n`;
for (const r of msg.prepare('SELECT [40011] t,count(*) c FROM group_msg_table GROUP BY [40011] ORDER BY c DESC').all()) {
  const s = msg.prepare('SELECT [40800] b FROM group_msg_table WHERE [40011]=? LIMIT 1').get(r.t);
  md += `| ${r.t} | ${r.c} | ${TYPE[r.t] || '未知'} | ${(body(s.b) || '(无文本)').slice(0, 24).replace(/\|/g, '/')} |\n`;
}
md += `\n> 注：互联网上 QQ NT 的 40011/40012 无权威文档（社区逆向中），以上为**从你的库抽样推断**。\n\n`;
md += `## 三、联系人表 profile_info_v6 实例\n\n`;
if (prof) { md += `| 1000 (uid) | 1002 (QQ号) | 20002 (昵称) |\n|---|---|---|\n`; for (const r of prof.prepare("SELECT [1000] uid,[1002] u,[20002] n FROM profile_info_v6 WHERE [20002] IS NOT NULL AND [20002]!='' LIMIT 6").safeIntegers().all()) md += `| ${S(r.uid).slice(0, 18)}… | ${S(r.u)} | ${r.n} |\n`; md += `\n共 ${prof.prepare('SELECT count(*) c FROM profile_info_v6').get().c} 个联系人。**关联**：消息 40033 = 这里的 1002。\n\n`; }
md += `## 四、群表 group_list 实例\n\n`;
if (grp) { try { md += `| 60001 (群号) | 60007 (群名) | 60006 (人数) | 60004 (群主QQ) |\n|---|---|---|---|\n`; for (const r of grp.prepare('SELECT [60001] g,[60007] n,[60006] m,[60004] o FROM group_list LIMIT 8').safeIntegers().all()) md += `| ${S(r.g)} | ${r.n} | ${S(r.m)} | ${S(r.o)} |\n`; md += `\n共 ${grp.prepare('SELECT count(*) c FROM group_list').get().c} 个群。**关联**：消息 40021 = 这里的 60001；群主 60004 = profile 的 1002。\n\n`; } catch {} }
md += `## 五、关联关系一图流（用你的数据）\n\n\`\`\`\n群消息(group_msg_table)\n  ├ 40033 发送者QQ ──→ profile_info_v6.1002 ──→ 20002 昵称\n  ├ 40021 群号    ──→ group_list.60001    ──→ 60007 群名\n  ├ 40050 时间(秒×1000)\n  └ 40800 正文(protobuf→文本)\ngroup_list.60004 群主 ──→ profile_info_v6.1002\nbuddy_list(好友781) ⊂ profile_info_v6(联系人946)\n\`\`\`\n`;
fs.writeFileSync(OUT, md);
console.log('wrote', OUT, `(${md.length} chars)`);
msg.close(); prof?.close(); grp?.close();
