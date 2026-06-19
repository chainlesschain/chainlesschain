#!/usr/bin/env node
/**
 * pdh-wechat-interpret.mjs — 生成「微信 EnMicroMsg 实例解读」MD（真实数据逐字段 + 关联演示）。
 * 含真实数据 → 输出桌面(非 git)。Usage: --db <EnMicroMsg_decrypted.db> [--out <md>]
 */
import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const A = process.argv.slice(2); const val = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const DB = val('--db'), OUT = val('--out', 'C:/Users/longfa/Desktop/我的数据库/解读_微信.md');
const db = new Database(DB, { readonly: true });
const TYPE = { 1: '文本', 3: '图片', 34: '语音', 42: '名片', 43: '视频', 47: '动画表情', 48: '位置', 49: '分享/链接/文件/转账/小程序(看content里<appmsg>子type)', 50: '语音/视频通话', 10000: '系统提示(撤回/拍一拍/入群)', 10002: '系统提示' };
// contact name map
const nameOf = new Map();
for (const r of db.prepare("SELECT username,nickname,conRemark FROM rcontact").all()) nameOf.set(r.username, (r.conRemark && r.conRemark.trim()) || r.nickname || r.username);
const groupSet = new Set(db.prepare("SELECT chatroomname FROM chatroom").all().map((r) => r.chatroomname));

let md = `# 微信 EnMicroMsg 数据库 — 实例解读（你的真实数据）\n\n`;
md += `> ⚠️ 含真实聊天/联系人，仅本地查看，勿外传。结构详解(无数据)见 \`docs/internal/reference/数据库表结构详解.md\`。\n\n`;
md += `## 一、一条消息长什么样（逐字段实例）\n\n`;
// pick a group text message (has wxid: prefix)
const g = db.prepare("SELECT msgId,msgSvrId,type,isSend,createTime,talker,content FROM message WHERE type=1 AND talker LIKE '%@chatroom' AND content LIKE '%:%' ORDER BY createTime DESC LIMIT 1").get();
if (g) {
  const colon = g.content.indexOf(':');
  const senderWxid = g.content.slice(0, colon);
  const text = g.content.slice(colon + 1).trim();
  md += `取 message 一行（群聊文本消息）：\n\n| 列 | 原始值 | 解读 |\n|---|---|---|\n`;
  md += `| msgId | ${g.msgId} | 本地消息ID |\n`;
  md += `| msgSvrId | ${g.msgSvrId} | 服务器ID(全局唯一,去重用) |\n`;
  md += `| type | ${g.type} | ${TYPE[g.type] || '?'} |\n`;
  md += `| isSend | ${g.isSend} | ${g.isSend ? '我发出的' : '收到的'} |\n`;
  md += `| createTime | ${g.createTime} | 毫秒 = ${new Date(g.createTime).toLocaleString('zh-CN')} |\n`;
  md += `| talker | ${g.talker} | 群ID(@chatroom) → chatroom 表 / 是群聊 |\n`;
  md += `| content | \`${senderWxid}:↵${text.slice(0, 30)}…\` | **群消息正文带发送者前缀**：\`${senderWxid}\`(→rcontact查昵称 **${nameOf.get(senderWxid) || '?'}**) + 冒号后是真正内容 |\n\n`;
  md += `**→ 一句话还原**：${new Date(g.createTime).toLocaleDateString('zh-CN')}，群里 **${nameOf.get(senderWxid) || senderWxid}** 说了「${text.slice(0, 40)}」。\n\n`;
}
// single chat example
const c = db.prepare("SELECT type,isSend,createTime,talker,content FROM message WHERE type=1 AND talker NOT LIKE '%@chatroom' AND talker NOT LIKE 'gh_%' ORDER BY createTime DESC LIMIT 1").get();
if (c) md += `单聊对比：talker=\`${c.talker}\`(对方wxid→**${nameOf.get(c.talker) || '?'}**)，content 无前缀直接是内容「${(c.content || '').slice(0, 30)}」，isSend=${c.isSend}(${c.isSend ? '我发' : '收到'})。\n\n`;

md += `## 二、消息类型 type 实测分布\n\n| type | 含义 | 条数 |\n|---|---|---|\n`;
for (const r of db.prepare('SELECT type,count(*) c FROM message GROUP BY type ORDER BY c DESC LIMIT 12').all()) md += `| ${r.type} | ${TYPE[r.type] || '其它/扩展'} | ${r.c} |\n`;

md += `\n## 三、联系人 rcontact 实例\n\n| username | nickname(昵称) | conRemark(我的备注) | 类别 |\n|---|---|---|---|\n`;
for (const r of db.prepare("SELECT username,nickname,conRemark FROM rcontact WHERE nickname IS NOT NULL AND nickname!='' AND username LIKE 'wxid_%' LIMIT 6").all()) md += `| ${r.username} | ${r.nickname} | ${r.conRemark || '(无)'} | 好友 |\n`;
md += `\n共 ${db.prepare('SELECT count(*) c FROM rcontact').get().c} 个联系人(含好友/群/公众号)。**关联**：message.talker = rcontact.username。\n\n`;

md += `## 四、群 chatroom 实例\n\n`;
const cr = db.prepare('SELECT chatroomname,memberlist,displayname,roomowner FROM chatroom LIMIT 1').get();
if (cr) {
  const members = (cr.memberlist || '').split(';').filter(Boolean);
  const dnames = (cr.displayname || '').split(';');
  md += `群 \`${cr.chatroomname}\`：${members.length} 个成员，群主 \`${cr.roomowner}\`(→${nameOf.get(cr.roomowner) || '?'})。\n`;
  md += `memberlist 与 displayname **同序对应**，前 3 个成员：\n`;
  for (let i = 0; i < Math.min(3, members.length); i++) md += `- \`${members[i]}\`(昵称 ${nameOf.get(members[i]) || '?'}) 群名片=${dnames[i] || '(无)'}\n`;
  md += `\n共 ${db.prepare('SELECT count(*) c FROM chatroom').get().c} 个群。\n\n`;
}
md += `## 五、关联关系一图流\n\n\`\`\`\nmessage.talker ──┬─单聊→ rcontact.username → nickname/conRemark(显示名)\n                └─群@chatroom→ chatroom.chatroomname → memberlist/displayname/roomowner\n群消息发送者: content "wxid_xxx:" 前缀 → rcontact.username\n时间: createTime 毫秒  |  方向: isSend(0收/1发)  |  类型: type(1文本/3图/49分享…)\n\`\`\`\n`;
fs.writeFileSync(OUT, md);
console.log('wrote', OUT, `(${md.length} chars)`);
db.close();
