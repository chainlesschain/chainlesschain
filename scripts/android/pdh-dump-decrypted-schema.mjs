#!/usr/bin/env node
/**
 * pdh-dump-decrypted-schema.mjs — Extract + annotate the schema of decrypted WeChat /
 * QQ DBs into a Markdown dictionary (CREATE TABLE SQL + 中文列含义 + 样本) so an AI / UI
 * can interpret and display the data. Output goes next to the DBs by default.
 *
 * Usage:
 *   node scripts/android/pdh-dump-decrypted-schema.mjs [--dir "C:/Users/<u>/Desktop/我的数据库"] [--out <dir>]
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const DIR = val('--dir', 'C:/Users/longfa/Desktop/我的数据库');
const OUT = val('--out', DIR);

// ---- annotation dictionaries ----
const WECHAT_COLS = {
  message: { msgId: '本地消息ID', msgSvrId: '服务器消息ID(全局唯一)', type: '消息类型 1=文本 3=图片 34=语音 42=名片 43=视频 47=动画表情 48=位置 49=分享/链接/文件 10000=系统', status: '状态', isSend: '0=收到 1=发出', createTime: '时间戳(毫秒)', talker: '会话方: 单聊=对方wxid, 群聊=<id>@chatroom', content: '正文; 群消息前缀 "wxid_xxx:\\n" 标识发送者', imgPath: '缩略图路径', reserved: '保留', lvbuffer: '扩展二进制' },
  rcontact: { username: '账号: wxid_xxx / 群<id>@chatroom / gh_xxx(公众号)', alias: '微信号(自定义)', conRemark: '我给对方的备注名', nickname: '对方昵称', type: '联系人类型位标志(好友/群/公众号)', pyInitial: '昵称拼音首字母', quanPin: '昵称全拼' },
  chatroom: { chatroomname: '群ID <id>@chatroom', memberlist: '群成员 wxid 列表(; 分隔)', displayname: '群内成员昵称(; 分隔, 与 memberlist 对应)', roomowner: '群主 wxid', selfDisplayName: '我在群里的昵称' },
};
const QQ_COLS = {
  '40001': 'msgId(本地消息ID, 雪花算法长整型)', '40002': '消息随机数(random)', '40003': '消息序列号(seq)', '40005': '客户端序号', '40006': '关联序号',
  '40020': '消息 uid(字符串, u_xxx)', '40021': '对端/群号(单聊=对方QQ, 群聊=群号)', '40027': '对端 uid', '40026': '会话标识',
  '40030': '发送者类型', '40033': '发送者 QQ号(uin)', '40090': '发送者昵称/群名片', '40093': '群名片/备注',
  '40010': '消息归属(0自己/2群)', '40011': '消息类型(大类: 2=文本/图文 5=灰条系统 ...)', '40012': '消息子类型(elemType)', '40013': '消息状态',
  '40050': '发送时间戳(秒)', '40052': '修改时间', '40040': '已读标志', '40041': '消息流向',
  '40080': '消息摘要文本(部分类型直存)', '40800': '消息体(protobuf 二进制; 富文本/图片/引用等元素需解码)', '40900': '消息扩展(protobuf)', '40801': '消息体扩展(protobuf)',
  '40105': '引用消息信息', '40600': '扩展blob', '40601': '扩展blob', '40605': '扩展blob', '40062': '扩展blob',
};
const QQ_RECENT_NOTE = '最近会话(消息列表)：每行一个会话，含对端号/最后消息/未读数/置顶等';
const QQ_TABLE_NOTE = {
  c2c_msg_table: '单聊(1对1)消息', group_msg_table: '群聊消息', group_at_me_msg: '群里@我的消息',
  recent_contact_v3_table: '最近会话列表(消息列表)', msg_unread_info_table: '未读计数',
  c2c_msg_flow_table: '单聊消息流水', group_msg_flow_table: '群消息流水', ai_assistant_msg_table: 'AI助手消息',
};

function annotate(db, dbName, colDict, tableNote) {
  let md = `\n## ${dbName}\n\n`;
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name").all();
  for (const t of tables) {
    let n = 0; try { n = db.prepare(`SELECT count(*) c FROM "${t.name}"`).get().c; } catch {}
    if (n === 0) continue;
    md += `### \`${t.name}\`  (${n} 行)${tableNote && tableNote[t.name] ? ' — ' + tableNote[t.name] : ''}\n\n`;
    md += '```sql\n' + (t.sql || '').trim() + '\n```\n\n';
    // column annotations + sample
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
    let sample = null; try { sample = db.prepare(`SELECT * FROM "${t.name}" LIMIT 1`).get(); } catch {}
    md += '| 列 | 类型 | 含义 | 样本 |\n|---|---|---|---|\n';
    for (const c of cols) {
      const mean = (colDict && (colDict[t.name]?.[c.name] || colDict[c.name])) || '';
      let s = sample ? sample[c.name] : null;
      if (Buffer.isBuffer(s)) s = `<blob ${s.length}B>`;
      else if (typeof s === 'string') s = s.length > 24 ? s.slice(0, 24).replace(/\n/g, ' ') + '…' : s.replace(/\n/g, ' ');
      else if (s === null) s = '';
      md += `| \`${c.name}\` | ${c.type || ''} | ${mean} | ${String(s).replace(/\|/g, '\\|')} |\n`;
    }
    md += '\n';
  }
  return md;
}

// 核心数据表(供 AI/展示优先关注; 其余多为 App 内部表)
const CORE = {
  '微信': { message: '聊天消息(收发/类型/时间/正文)', rcontact: '联系人/好友/群/公众号', chatroom: '群信息(成员/群主)', ImgInfo2: '图片消息元信息', userinfo: '账号配置' },
  'QQ': { c2c_msg_table: '单聊消息', group_msg_table: '群聊消息', group_at_me_msg: '群@我', recent_contact_v3_table: '最近会话列表', msg_unread_info_table: '未读计数' },
};
function coreSummary(db, label) {
  let s = `### ${label} 核心表\n\n| 表 | 行数 | 用途 |\n|---|---|---|\n`;
  for (const [t, desc] of Object.entries(CORE[label] || {})) {
    let n = null; try { n = db.prepare(`SELECT count(*) c FROM "${t}"`).get().c; } catch { continue; }
    s += `| \`${t}\` | ${n} | ${desc} |\n`;
  }
  return s + '\n';
}

let out = `# 解密数据库 Schema 字典 (供 AI 解读 / UI 展示)\n\n> 自动生成 by pdh-dump-decrypted-schema.mjs。WeChat 列名自带语义；QQ NT 列为数字编号，\n> 含义来自 qq-pc 适配器 COL_CANDIDATES + 推断；消息正文 40800/40900 为 protobuf 二进制需解码。\n>\n> **时间戳**: 微信 createTime=毫秒, QQ 40050=秒。**对端**: 微信 talker(wxid / 群@chatroom), QQ 40021(QQ号/群号)。\n\n## 一、核心表速查(优先看这些)\n`;

const targets = [
  { glob: /EnMicroMsg_decrypted.*\.db$/i, label: '微信', name: '微信 EnMicroMsg (聊天/联系人/群)', dict: WECHAT_COLS, note: null },
  { glob: /QQ_nt_msg.*\.db$/i, label: 'QQ', name: 'QQ NT nt_msg (聊天/会话/联系人)', dict: QQ_COLS, note: QQ_TABLE_NOTE },
];
// pass 1: core summaries
const opened = [];
for (const f of fs.readdirSync(DIR)) {
  const t = targets.find((x) => x.glob.test(f));
  if (!t) continue;
  try { const db = new Database(path.join(DIR, f), { readonly: true }); opened.push({ f, t, db }); out += coreSummary(db, t.label); } catch (e) { console.log('skip', f, e.message); }
}
// pass 2: full per-table detail
out += `\n## 二、全部表详情 (CREATE TABLE SQL + 列含义 + 样本)\n`;
for (const { f, t, db } of opened) {
  out += annotate(db, `${t.name} — \`${f}\``, t.dict, t.note);
  db.close();
  console.log('annotated', f);
}
const outPath = path.join(OUT, 'SCHEMA_字典.md');
fs.writeFileSync(outPath, out);
console.log('wrote', outPath, `(${out.length} chars)`);
