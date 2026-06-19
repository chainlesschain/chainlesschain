#!/usr/bin/env node
/**
 * pdh-gen-schema-dict.mjs — 生成「完整数据字典」：每个库每张表每个字段的中文备注 + 表关联。
 * 纯结构(无数据) → 可入 git 也可放桌面。
 *
 * 标注来源：① 精确字典 EXACT(已知高价值字段/QQ数字列) ② 英文字段名启发式 TOKEN 翻译
 *   (createTime→创建时间, isSend→是否发送, msgSvrId→消息服务器ID …)。
 *
 * Usage:
 *   node scripts/android/pdh-gen-schema-dict.mjs \
 *     --db "微信=<EnMicroMsg.db>" --db "QQ消息=<nt_msg.db>" --db "QQ联系人=<profile_info.db>" \
 *     --sql "抖音IM=docs/internal/reference/douyin_im_schema.sql" --out <out.md>
 */
import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const A = process.argv.slice(2);
const multi = (f) => A.map((v, i) => (A[i - 1] === f ? v : null)).filter(Boolean);
const val = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const OUT = val('--out', 'C:/Users/longfa/Desktop/我的数据库/数据字典_完整.md');

// ---- 精确字段字典（key 小写）----
const EXACT = {
  // 微信 message (只放 message 专属、不易与其它表混淆的)
  msgsvrid: '服务器消息ID(全局唯一,去重用)', talker: '会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx', issend: '方向: 0=收到 1=我发出', imgpath: '图片/资源缩略图本地路径', lvbuffer: '扩展二进制(protobuf)', transcontent: '翻译内容', talkerid: '会话方数字ID(关联rcontact行)', solitairefoldinfo: '接龙折叠信息',
  // 微信 rcontact
  conremark: '我给对方设的备注名(优先显示)', pyinitial: '拼音首字母', quanpin: '全拼', encryptusername: '加密用户名', chatroomflag: '群标志',
  // 微信 chatroom
  chatroomname: '群ID(<id>@chatroom,主键)', memberlist: '群成员wxid列表(;分隔)', displayname: '群成员群名片(;分隔,与memberlist同序)', roomowner: '群主wxid', selfdisplayname: '我在本群的群名片', roomdata: '群成员扩展(protobuf)', modifytime: '修改时间', membercount: '群成员数',
  // QQ 数字列
  '40001': 'msgId(本地消息ID,19位雪花长整型)', '40002': '消息random随机数(去重)', '40003': '消息seq序列号', '40005': '客户端序号', '40006': '关联序号', '40020': '发送者uid(u_xxx)', '40021': '群号/对端QQ号(关联键)', '40027': '对端uid数字', '40026': '会话标识', '40030': '发送者类型', '40033': '发送者QQ号(uin,关联profile.1002)', '40090': '发送者群名片/昵称', '40093': '群名片/备注', '40010': '消息归属(0自己/2群)', '40011': '消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统)', '40012': '消息子类型elemType', '40013': '消息状态', '40050': '发送时间戳(秒,×1000=毫秒)', '40052': '修改时间', '40040': '已读标志', '40041': '消息流向', '40080': '消息摘要文本', '40800': '消息体(protobuf,富元素需解码)', '40900': '消息扩展(protobuf)', '40801': '消息体扩展(protobuf)', '40105': '引用消息信息',
  '1000': 'uid(u_xxx,关联消息40020)', '1001': '账号附加', '1002': 'QQ号(uin,关联消息40033)', '20002': '昵称(显示名)', '20009': '性别', '20011': '生日', '25007': '好友分组/标志',
  '60001': '群号(关联消息40021)', '60004': '群主QQ号(关联profile.1002)', '60007': '群名', '60005': '最大成员数', '60006': '当前成员数', '60002': '群主uid(u_xxx)', '60011': '群等级/活跃度', '60010': '群成员数(另)',
  // 抖音/头条 ByteDance IM
  msg_uuid: '消息UUID(本地唯一,主键)', msg_server_id: '服务器消息ID(全局唯一)', conversation_id: '会话ID(0:类型:uidA:uidB,关联conversation_core)', conversation_short_id: '会话短ID(数字)', conversation_type: '会话类型(0单聊/群另值)', index_in_conversation: '会话内序号(排序)', order_index: '排序索引', net_status: '网络状态', sec_sender: '发送者sec_uid(加密uid)', property_list: '属性列表(JSON)', local_info: '本地态(JSON)', owner_id: '群主uid', creator_uid: '创建者uid', sec_owner: '群主sec_uid', read_index: '已读位置', last_msg_index: '最后消息位置', unread_count: '未读数', member_count: '成员数', draft_content: '草稿内容', stick_top: '是否置顶', mute: '是否免打扰', stranger: '是否陌生人', sort_order: '排序', participant: '成员(JSON)', local_uri: '本地路径', remote_uri: '远程URL', mime_type: 'MIME类型', ids_str: '@的人ID串',
};
// ---- 启发式 token → 中文 ----
const TOK = [['createtime', '创建时间'], ['modifytime', '修改时间'], ['updatetime', '更新时间'], ['inserttime', '插入时间'], ['svrid', '服务器ID'], ['msgid', '消息ID'], ['userid', '用户ID'], ['groupid', '群ID'], ['roomid', '房间ID'], ['nickname', '昵称'], ['username', '用户名'], ['avatar', '头像'], ['icon', '图标'], ['thumb', '缩略图'], ['package', '包'], ['watermark', '水印'], ['agent', '代理'], ['store', '商店'], ['create', '创建'], ['modify', '修改'], ['update', '更新'], ['delete', '删除'], ['insert', '插入'], ['expire', '过期'], ['begin', '开始'], ['start', '开始'], ['end', '结束'], ['finish', '完成'], ['timestamp', '时间戳'], ['time', '时间'], ['date', '日期'], ['count', '数量'], ['num', '数量'], ['size', '大小'], ['length', '长度'], ['duration', '时长'], ['status', '状态'], ['state', '状态'], ['subtype', '子类型'], ['type', '类型'], ['flag', '标志'], ['msgseq', '消息序号'], ['seq', '序号'], ['order', '顺序'], ['index', '索引'], ['version', '版本'], ['url', '链接'], ['uri', '地址'], ['path', '路径'], ['link', '链接'], ['name', '名称'], ['title', '标题'], ['description', '描述'], ['desc', '描述'], ['content', '内容'], ['text', '文本'], ['summary', '摘要'], ['message', '消息'], ['msg', '消息'], ['member', '成员'], ['owner', '群主/拥有者'], ['group', '群/组'], ['room', '群'], ['chat', '聊天'], ['conversation', '会话'], ['contact', '联系人'], ['friend', '好友'], ['buddy', '好友'], ['sender', '发送者'], ['receiver', '接收者'], ['send', '发送'], ['recv', '接收'], ['unread', '未读'], ['read', '已读'], ['mention', '提及@'], ['reply', '回复'], ['quote', '引用'], ['draft', '草稿'], ['mute', '免打扰'], ['stick', '置顶'], ['top', '置顶'], ['favorite', '收藏'], ['favor', '收藏'], ['remark', '备注'], ['alias', '别名'], ['phone', '手机'], ['mobile', '手机'], ['email', '邮箱'], ['region', '地区'], ['province', '省'], ['city', '城市'], ['country', '国家'], ['gender', '性别'], ['sex', '性别'], ['signature', '签名'], ['sign', '签名'], ['price', '价格'], ['amount', '金额'], ['money', '金额'], ['fee', '费用'], ['default', '默认'], ['current', '当前'], ['total', '总'], ['max', '最大'], ['min', '最小'], ['last', '最后'], ['first', '首'], ['page', '页'], ['offset', '偏移'], ['limit', '限制'], ['batch', '批'], ['channel', '渠道'], ['platform', '平台'], ['scene', '场景'], ['sync', '同步'], ['upload', '上传'], ['download', '下载'], ['retry', '重试'], ['success', '成功'], ['fail', '失败'], ['request', '请求'], ['response', '响应'], ['cache', '缓存'], ['temp', '临时'], ['head', '头像'], ['key', '键'], ['value', '值'], ['data', '数据'], ['info', '信息'], ['detail', '详情'], ['list', '列表'], ['config', '配置'], ['setting', '设置'], ['token', '令牌'], ['ticket', '票据'], ['hash', '哈希'], ['md5', 'MD5'], ['ext', '扩展'], ['extra', '扩展'], ['reserved', '保留'], ['local', '本地'], ['server', '服务器'], ['svr', '服务器'], ['remote', '远程'], ['client', '客户端'], ['source', '来源'], ['target', '目标'], ['enable', '启用'], ['disable', '禁用'], ['valid', '有效'], ['deleted', '已删除'], ['hidden', '隐藏'], ['show', '显示'], ['display', '显示'], ['width', '宽'], ['height', '高'], ['color', '颜色'], ['lang', '语言'], ['longitude', '经度'], ['latitude', '纬度'], ['lat', '纬度'], ['lng', '经度'], ['uin', 'QQ号/UIN'], ['uid', 'uid'], ['wxid', '微信ID'], ['biz', '业务'], ['app', '应用'], ['action', '动作'], ['result', '结果'], ['reason', '原因'], ['error', '错误'], ['code', '码'], ['user', '用户'], ['id', 'ID'],
  ['history', '历史'], ['trans', '翻译'], ['brand', '品牌'], ['wording', '文案'], ['word', '词'], ['digest', '摘要'], ['media', '媒体'], ['video', '视频'], ['voice', '语音'], ['audio', '音频'], ['image', '图片'], ['img', '图片'], ['photo', '照片'], ['pic', '图片'], ['file', '文件'], ['stream', '流'], ['format', '格式'], ['card', '卡片'], ['product', '产品'], ['silent', '静音'], ['human', '人工'], ['primary', '主'], ['term', '词条'], ['segment', '段'], ['seg', '段'], ['position', '位置'], ['pos', '位置'], ['uuid', 'UUID'], ['block', '块'], ['click', '点击'], ['view', '查看'], ['play', '播放'], ['like', '点赞'], ['comment', '评论'], ['share', '分享'], ['collect', '收藏'], ['follow', '关注'], ['fans', '粉丝'], ['cdn', 'CDN'], ['xml', 'XML'], ['json', 'JSON'], ['html', 'HTML'], ['sdk', 'SDK'], ['api', 'API'], ['gif', 'GIF'], ['cover', '封面'], ['tag', '标签'], ['label', '标签'], ['mark', '标记'], ['report', '上报'], ['login', '登录'], ['logout', '登出'], ['auth', '授权'], ['verify', '验证'], ['secret', '密钥'], ['encrypt', '加密'], ['decrypt', '解密'], ['cipher', '密文'], ['raw', '原始'], ['origin', '原始'], ['parent', '父'], ['child', '子'], ['root', '根'], ['level', '级别'], ['grade', '等级'], ['rank', '排名'], ['score', '分数'], ['point', '积分'], ['vip', 'VIP'], ['svip', 'SVIP'], ['pay', '支付'], ['order', '订单'], ['trade', '交易'], ['coin', '币'], ['gift', '礼物'], ['red', '红包'], ['packet', '红包'], ['env', '环境'], ['debug', '调试'], ['test', '测试'], ['mode', '模式'], ['style', '样式'], ['theme', '主题'], ['font', '字体'], ['bg', '背景'], ['background', '背景'], ['fg', '前景'], ['border', '边框'], ['margin', '边距'], ['padding', '内边距'], ['radius', '圆角'], ['scale', '缩放'], ['rotate', '旋转'], ['anim', '动画'], ['effect', '特效'], ['sticker', '贴纸'], ['emoji', '表情'], ['emoticon', '表情'], ['at', '@'], ['ref', '引用'], ['ack', '确认'], ['ts', '时间戳'], ['idx', '索引'], ['no', '编号'], ['serial', '序列'], ['batch', '批次'], ['queue', '队列'], ['priority', '优先级'], ['weight', '权重'], ['ratio', '比例'], ['percent', '百分比'], ['rate', '速率'], ['speed', '速度'], ['bytes', '字节'], ['byte', '字节'], ['bit', '位'], ['kb', 'KB'], ['mb', 'MB'], ['use', '使用'], ['used', '已使用'], ['clicked', '已点击'], ['had', '曾'], ['feature', '特征'], ['engineering', '工程'], ['model', '模型'], ['predict', '预测'], ['recommend', '推荐'], ['rec', '推荐'], ['feed', '信息流'], ['live', '直播'], ['room', '房间/群'], ['anchor', '主播'], ['gift', '礼物'], ['ecom', '电商'], ['shop', '店铺'], ['mall', '商城'], ['goods', '商品'], ['sku', '商品规格'], ['spu', '商品'], ['cart', '购物车'], ['address', '地址'], ['express', '快递'], ['logistic', '物流']];
const HEUR_SORTED = [...TOK].sort((a, b) => b[0].length - a[0].length);
function heuristic(col) {
  const low = col.toLowerCase().replace(/[_\s]/g, '');
  // is/has/need 前缀 → 是否 (不含 use/allow/enable/should: 它们是实词)
  let prefix = '';
  let m = low.match(/^(is|has|need)([a-z].{2,})$/);
  let rest = low;
  if (m) { prefix = '是否'; rest = m[2]; }
  const parts = [];
  let s = rest;
  let matched = false;
  const sorted = HEUR_SORTED;
  let guard = 0;
  while (s.length && guard++ < 24) {
    let hit = null;
    for (const [t, zh] of sorted) if (s.startsWith(t)) { hit = [t, zh]; break; }
    if (hit) { parts.push(hit[1]); s = s.slice(hit[0].length); matched = true; }
    else { let next = s.length; for (const [t] of sorted) { const i = s.indexOf(t); if (i > 0 && i < next) next = i; } if (next === s.length) { parts.push(s); break; } parts.push(s.slice(0, next)); s = s.slice(next); }
  }
  const zh = prefix + parts.join('');
  if (!matched || !zh) return '(' + col + ')';   // 一个 token 都没匹配上才标原名
  return zh;
}
const annotate = (col) => EXACT[col.toLowerCase()] || heuristic(col);

// ---- 表级描述 ----
const TABLE_DESC = {
  message: '聊天消息(核心)', rcontact: '联系人/好友/群/公众号', chatroom: '群信息(成员/群主)', imginfo2: '图片消息元信息', userinfo: '账号配置', conversation: '会话表', emojiinfo: '表情信息', appinfo: '小程序/应用信息', voiceinfo: '语音信息', videoinfo2: '视频信息', addr_upload2: '通讯录上传', bizinfo: '公众号信息', fmessage: '好友请求/打招呼', snsdata: '朋友圈数据',
  c2c_msg_table: '单聊(1对1)消息', group_msg_table: '群聊消息', group_at_me_msg: '群里@我的消息', recent_contact_v3_table: '最近会话列表', msg_unread_info_table: '未读计数', c2c_msg_flow_table: '单聊消息流水', group_msg_flow_table: '群消息流水', ai_assistant_msg_table: 'AI助手消息',
  profile_info_v6: '联系人资料(QQ号/昵称/uid)', buddy_list: '好友列表', group_list: '群列表', group_detail_info_ver1: '群详情(群名/群主/人数)', public_account_list: '公众号列表', category_list_v2: '好友分组',
  msg: '私信消息(ByteDance IM)', conversation_core: '会话/群核心信息', conversation_list: '会话列表(未读/排序)', conversation_setting: '会话设置(置顶/免打扰)', participant: '会话成员', attchment: '附件(图片/文件)', mention: '@提及记录', conversation_kv: '会话键值扩展', message_kv: '消息键值扩展',
};

function tableSection(name, sql, cols) {
  let s = `### \`${name}\`${TABLE_DESC[name.toLowerCase()] ? ' — ' + TABLE_DESC[name.toLowerCase()] : ''}\n\n`;
  if (sql) s += '```sql\n' + sql.trim() + '\n```\n\n';
  s += '| 字段 | 类型 | 中文备注 |\n|---|---|---|\n';
  for (const c of cols) s += `| \`${c.name}\` | ${c.type || ''} | ${annotate(c.name)} |\n`;
  return s + '\n';
}
function fromDb(file) {
  const db = new Database(file, { readonly: true });
  const tabs = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name").all();
  let s = ''; let nt = 0, nc = 0;
  for (const t of tabs) { const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all(); s += tableSection(t.name, t.sql, cols); nt++; nc += cols.length; }
  db.close();
  return { s, nt, nc };
}
function fromSql(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const re = /CREATE TABLE\s+["'\[]?(\w+)["'\]]?\s*\(([\s\S]*?)\);/gi;
  let m, s = '', nt = 0, nc = 0;
  while ((m = re.exec(txt))) {
    const name = m[1]; const inner = m[2];
    // split top-level commas
    const cols = []; let depth = 0, cur = '';
    for (const ch of inner) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) cols.push(cur.trim());
    const parsed = cols.map((c) => { const mm = c.match(/^["'\[]?(\w+)["'\]]?\s+(\w+)/); return mm ? { name: mm[1], type: mm[2] } : null; }).filter(Boolean);
    if (!parsed.length) continue;
    s += tableSection(name, `CREATE TABLE ${name}(...)`, parsed); nt++; nc += parsed.length;
  }
  return { s, nt, nc };
}

let out = `# 数据字典（完整）— 每库 / 每表 / 每字段 中文备注\n\n> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；\`(原名)\` 表示未能翻译的字段。\n> 表关联见各 App 末尾 + \`数据库表结构详解.md\`。生成器 \`scripts/android/pdh-gen-schema-dict.mjs\`。\n`;
let grand = { nt: 0, nc: 0 };
for (const spec of multi('--db')) {
  const [label, file] = spec.split('='); if (!fs.existsSync(file)) { console.error('skip', file); continue; }
  out += `\n## 📁 ${label}  \`${path.basename(file)}\`\n\n`;
  const r = fromDb(file); out += r.s; grand.nt += r.nt; grand.nc += r.nc;
  console.log(`${label}: ${r.nt} 表 ${r.nc} 字段`);
}
for (const spec of multi('--sql')) {
  const [label, file] = spec.split('='); if (!fs.existsSync(file)) { console.error('skip', file); continue; }
  out += `\n## 📁 ${label}  \`${path.basename(file)}\`\n\n`;
  const r = fromSql(file); out += r.s; grand.nt += r.nt; grand.nc += r.nc;
  console.log(`${label}: ${r.nt} 表 ${r.nc} 字段`);
}
out = out.replace('每字段 中文备注\n', `每字段 中文备注\n\n> 共 ${grand.nt} 张表 / ${grand.nc} 个字段已标注。\n`);
fs.writeFileSync(OUT, out);
console.log('\nwrote', OUT, `(${out.length} chars, ${grand.nt} tables, ${grand.nc} fields)`);
