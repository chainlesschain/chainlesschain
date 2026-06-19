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
  ['history', '历史'], ['trans', '翻译'], ['brand', '品牌'], ['wording', '文案'], ['word', '词'], ['digest', '摘要'], ['media', '媒体'], ['video', '视频'], ['voice', '语音'], ['audio', '音频'], ['image', '图片'], ['img', '图片'], ['photo', '照片'], ['pic', '图片'], ['file', '文件'], ['stream', '流'], ['format', '格式'], ['card', '卡片'], ['product', '产品'], ['silent', '静音'], ['human', '人工'], ['primary', '主'], ['term', '词条'], ['segment', '段'], ['seg', '段'], ['position', '位置'], ['uuid', 'UUID'], ['block', '块'], ['click', '点击'], ['view', '查看'], ['play', '播放'], ['like', '点赞'], ['comment', '评论'], ['share', '分享'], ['collect', '收藏'], ['follow', '关注'], ['fans', '粉丝'], ['cdn', 'CDN'], ['xml', 'XML'], ['json', 'JSON'], ['html', 'HTML'], ['sdk', 'SDK'], ['api', 'API'], ['gif', 'GIF'], ['cover', '封面'], ['tag', '标签'], ['label', '标签'], ['mark', '标记'], ['report', '上报'], ['login', '登录'], ['logout', '登出'], ['auth', '授权'], ['verify', '验证'], ['secret', '密钥'], ['encrypt', '加密'], ['decrypt', '解密'], ['cipher', '密文'], ['raw', '原始'], ['origin', '原始'], ['parent', '父'], ['child', '子'], ['root', '根'], ['level', '级别'], ['grade', '等级'], ['rank', '排名'], ['score', '分数'], ['point', '积分'], ['vip', 'VIP'], ['svip', 'SVIP'], ['pay', '支付'], ['order', '订单'], ['trade', '交易'], ['coin', '币'], ['gift', '礼物'], ['red', '红包'], ['packet', '红包'], ['env', '环境'], ['debug', '调试'], ['test', '测试'], ['mode', '模式'], ['style', '样式'], ['theme', '主题'], ['font', '字体'], ['bg', '背景'], ['background', '背景'], ['fg', '前景'], ['border', '边框'], ['margin', '边距'], ['padding', '内边距'], ['radius', '圆角'], ['scale', '缩放'], ['rotate', '旋转'], ['anim', '动画'], ['effect', '特效'], ['sticker', '贴纸'], ['emoji', '表情'], ['emoticon', '表情'], ['ref', '引用'], ['ts', '时间戳'], ['idx', '索引'], ['serial', '序列'], ['batch', '批次'], ['queue', '队列'], ['priority', '优先级'], ['weight', '权重'], ['ratio', '比例'], ['percent', '百分比'], ['rate', '速率'], ['speed', '速度'], ['bytes', '字节'], ['byte', '字节'], ['bit', '位'], ['kb', 'KB'], ['mb', 'MB'], ['use', '使用'], ['used', '已使用'], ['clicked', '已点击'], ['had', '曾'], ['feature', '特征'], ['engineering', '工程'], ['model', '模型'], ['predict', '预测'], ['recommend', '推荐'], ['feed', '信息流'], ['live', '直播'], ['room', '房间/群'], ['anchor', '主播'], ['gift', '礼物'], ['ecom', '电商'], ['shop', '店铺'], ['mall', '商城'], ['goods', '商品'], ['sku', '商品规格'], ['spu', '商品'], ['cart', '购物车'], ['address', '地址'], ['express', '快递'], ['logistic', '物流'],
  ['record', '记录'], ['backup', '备份'], ['recover', '恢复'], ['restore', '恢复'], ['context', '上下文'], ['patch', '补丁'], ['notification', '通知'], ['notify', '通知'], ['antispam', '反垃圾'], ['enterprise', '企业'], ['finder', '视频号'], ['single', '单'], ['multi', '多'], ['mass', '群发'], ['account', '账号'], ['profile', '资料'], ['session', '会话'], ['device', '设备'], ['system', '系统'], ['service', '服务'], ['plugin', '插件'], ['module', '模块'], ['component', '组件'], ['resource', '资源'], ['attach', '附件'], ['attachment', '附件'], ['number', '号码'], ['phone', '手机'], ['contact', '联系人'], ['subscribe', '订阅'], ['subscription', '订阅'], ['moment', '朋友圈'], ['sns', '朋友圈'], ['feed', '动态/信息流'], ['comment', '评论'], ['praise', '点赞'], ['relation', '关系'], ['relationship', '关系'], ['blacklist', '黑名单'], ['block', '拉黑/块'], ['whitelist', '白名单'], ['ad', '广告'], ['advert', '广告'], ['banner', '横幅'], ['popup', '弹窗'], ['dialog', '对话框'], ['toast', '提示'], ['notice', '通知/公告'], ['announce', '公告'], ['template', '模板'], ['layout', '布局'], ['my', '我的'], ['self', '自己'], ['other', '其它'], ['default', '默认'],
  ['transfer', '转账/转移'], ['transaction', '交易'], ['timeline', '时间线'], ['line', '线'], ['qrcode', '二维码'], ['qr', '二维码'], ['cmd', '命令'], ['command', '命令'], ['buf', '缓冲'], ['buffer', '缓冲'], ['clean', '清理'], ['clear', '清除'], ['delay', '延迟'], ['item', '项'], ['confirm', '确认'], ['bot', '机器人'], ['robot', '机器人'], ['qrcode', '二维码'], ['scan', '扫描'], ['barcode', '条码'], ['voip', '音视频通话'], ['call', '通话'], ['emoji', '表情'], ['sticker', '贴纸'], ['recall', '撤回'], ['revoke', '撤回'], ['forward', '转发'], ['multitalk', '群聊'], ['voipcall', '音视频通话'], ['hardware', '硬件'], ['bluetooth', '蓝牙'], ['wifi', 'WiFi'], ['network', '网络'], ['proxy', '代理'], ['cookie', 'Cookie'], ['session', '会话'], ['oplog', '操作日志'], ['log', '日志'], ['kv', '键值'], ['fts', '全文索引'], ['migrate', '迁移'], ['migration', '迁移'], ['schema', '结构'], ['meta', '元'], ['snapshot', '快照'], ['checkpoint', '检查点'], ['frequency', '频率'], ['fold', '折叠'], ['unfold', '展开'], ['pin', '置顶'], ['archive', '归档'], ['recent', '最近'], ['nearby', '附近'], ['stranger', '陌生人'], ['official', '官方'], ['verify', '认证'], ['certified', '认证'], ['auth', '授权'], ['privacy', '隐私'], ['safety', '安全'], ['security', '安全'], ['risk', '风险'], ['spam', '垃圾'], ['report', '举报/上报'], ['complaint', '投诉'],
  ['complete', '完成'], ['expand', '展开'], ['collapse', '收起'], ['tips', '提示'], ['tip', '提示'], ['sz', '大小'], ['pgno', '页码'], ['active', '活跃'], ['emotion', '表情'], ['reward', '打赏/奖励'], ['magic', '魔法'], ['loan', '借贷'], ['wallet', '钱包'], ['bulletin', '公告'], ['smiley', '小表情'], ['piece', '片段'], ['music', '音乐'], ['role', '角色'], ['category', '分类'], ['discuss', '讨论组'], ['edition', '版本'], ['publish', '发布'], ['game', '游戏'], ['entry', '入口'], ['kind', '种类'], ['function', '功能'], ['func', '功能'], ['enter', '进入'], ['exit', '退出'], ['join', '加入'], ['quit', '退出'], ['invite', '邀请'], ['apply', '申请'], ['approve', '批准'], ['accept', '接受'], ['decline', '拒绝'], ['agree', '同意'], ['refuse', '拒绝'],
  ['applog', '应用埋点'], ['event', '事件'], ['params', '参数'], ['param', '参数'], ['rid', '请求ID'], ['behot', '热门时间'], ['digg', '点赞/顶'], ['bury', '踩'], ['repin', '收藏'], ['article', '文章'], ['news', '资讯'], ['feed', '信息流'], ['cell', '单元'], ['gid', '群/组ID'], ['mblog', '微博'], ['weibo', '微博'], ['troop', '群(QQ)'], ['discuss', '讨论组'], ['emoticon', '表情'], ['emotion', '表情'], ['letter', '私信'], ['scheme', '协议跳转'], ['launch', '启动'], ['impression', '曝光'], ['exposure', '曝光'], ['behavior', '行为'], ['stat', '统计'], ['metric', '指标'], ['monitor', '监控'], ['trace', '追踪'], ['span', '跨度'], ['sample', '采样'], ['quota', '配额'], ['flow', '流水'], ['stream', '流'], ['pull', '拉取'], ['push', '推送'], ['poll', '轮询'], ['fetch', '抓取'], ['prefetch', '预取'], ['preload', '预加载'], ['render', '渲染'], ['layout', '布局'],
  ['business', '业务'], ['permission', '权限'], ['arg', '参数'], ['filter', '筛选/过滤'], ['nick', '昵称'], ['portrait', '头像'], ['nt', '网络类型'], ['frame', '帧'], ['distance', '距离'], ['verified', '已认证'], ['verify', '认证'], ['outgoing', '外发/去电'], ['incoming', '来电'], ['important', '重要'], ['bubble', '气泡'], ['quality', '质量'], ['progress', '进度'], ['panel', '面板'], ['src', '来源'], ['btm', '底部'], ['spell', '拼音'], ['compare', '比较'], ['part', '部分'], ['seed', '种子'], ['right', '权限'], ['left', '左'], ['option', '选项'], ['option_string', '选项'], ['pre', '前'], ['bottom', '底部'], ['middle', '中'], ['large', '大图'], ['largest', '最大图'], ['original', '原图'], ['origin', '原始'], ['thumbnail', '缩略图'], ['cover', '封面'], ['blur', '模糊'], ['uhd', '超清'], ['hdr', 'HDR'], ['cut', '裁剪'], ['crop', '裁剪'], ['focus', '焦点'], ['sticker', '贴纸'], ['water', '水印'], ['vip', 'VIP'], ['bubble', '气泡'], ['fold', '折叠'], ['follower', '粉丝'], ['following', '关注'], ['attention', '关注'], ['fans', '粉丝'], ['repost', '转发'], ['retweet', '转发'], ['praise', '点赞'], ['favourite', '收藏'], ['favorite', '收藏'], ['topic', '话题'], ['hot', '热门'], ['rank', '排行'], ['trend', '趋势'], ['feed', '信息流']];
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
function annotate(col) {
  const e = EXACT[col.toLowerCase()];
  if (e) return e;
  // QQ NT 数字列：精确字典没有的，按编号段给范围含义(社区无权威文档)
  if (/^\d{3,6}$/.test(col)) {
    const seg = { '1': '账号', '2': '用户资料', '3': '富媒体/卡片', '4': '消息', '5': '扩展', '6': '群/会话' }[col[0]] || '内部';
    return `QQ${seg}字段(编号${col}, 含义社区未公开)`;
  }
  return heuristic(col);
}

// ---- 表级描述 ----
const TABLE_DESC = {
  message: '聊天消息(核心)', rcontact: '联系人/好友/群/公众号', chatroom: '群信息(成员/群主)', imginfo2: '图片消息元信息', userinfo: '账号配置', conversation: '会话表', emojiinfo: '表情信息', appinfo: '小程序/应用信息', voiceinfo: '语音信息', videoinfo2: '视频信息', addr_upload2: '通讯录上传', bizinfo: '公众号信息', fmessage: '好友请求/打招呼', snsdata: '朋友圈数据',
  c2c_msg_table: '单聊(1对1)消息', group_msg_table: '群聊消息', group_at_me_msg: '群里@我的消息', recent_contact_v3_table: '最近会话列表', msg_unread_info_table: '未读计数', c2c_msg_flow_table: '单聊消息流水', group_msg_flow_table: '群消息流水', ai_assistant_msg_table: 'AI助手消息',
  profile_info_v6: '联系人资料(QQ号/昵称/uid)', buddy_list: '好友列表', group_list: '群列表', group_detail_info_ver1: '群详情(群名/群主/人数)', public_account_list: '公众号列表', category_list_v2: '好友分组',
  msg: '私信消息(ByteDance IM)', conversation_core: '会话/群核心信息', conversation_list: '会话列表(未读/排序)', conversation_setting: '会话设置(置顶/免打扰)', participant: '会话成员', attchment: '附件(图片/文件)', mention: '@提及记录', conversation_kv: '会话键值扩展', message_kv: '消息键值扩展',
  // 补全：之前未翻译的表
  activeinfo: '活跃度信息', emotionrewardinfo: '表情打赏信息', gamehaowanpublishedition: '游戏(好玩)发布版本', loanentryinfo: '借贷入口信息', magicpkginfo: '魔法表情包信息', music: '音乐', newtipsinfo: '新提示信息', piecemusicinfo: '片段音乐信息', smileyinfo: '小表情(smiley)信息', walletbulletin: '钱包公告', walletfunciontlist: '钱包功能列表', walletkindinfo: '钱包种类信息', qqlist: '导入的QQ好友列表', role_info: '角色信息', category_list: '分类列表', discuss_list: '讨论组列表',
  // 明文库：头条阅读 news_article.db
  article: '文章/视频(信息流缓存; is_user_digg/repin/read_timestamp=用户互动)', article_detail: '文章正文详情(打开过的;标题在content的<tt-title>)', post: '微头条/动态', cell_ref: '信息流单元引用', category_refresh_record: '频道刷新记录',
  // 明文库：QQ 老版 mobileqq(文本字段混淆,uin是digit-byte)
  troopextdbinfo: '群扩展信息(QQ老库,文本混淆)', troopmemberinfoext: '群成员信息(QQ老库)', publicaccountinfo: '公众号信息', mayknowrecommend: '可能认识的人推荐', shieldlistinfo: '屏蔽列表', emoticon: '表情', emoticonpackage: '表情包', recentschemelaunchdbsource: '最近启动记录',
  // 明文库：微博
  long_text_table: '本人长微博正文(明文)', mblog_pic_table: '微博配图(图片URL,与mblogid关联)', t_session: '私信会话(message_<uid>.db)', emotionpackagedbsource: '微博表情包', card_dot_remind_table: '红点提醒', new_letter_users: '私信用户',
  // 微信朋友圈 SnsMicroMsg.db(明文)
  snsinfo: '朋友圈动态(本人+好友; userName=发布者, createTime=发布时间, type=类型, likeFlag=已赞)', snscomment: '朋友圈评论/点赞', snscover: '朋友圈封面', snsextinfo3: '朋友圈扩展信息', snswsfoldgroupdetail: '朋友圈折叠分组', adsnsinfo: '朋友圈广告', snsconfig: '朋友圈配置', snsdraft: '朋友圈草稿', snsalbum: '朋友圈相册', snsobject: '朋友圈对象', snsfaultinfo: '朋友圈异常信息', adpullrecordsinfo: '广告拉取记录',
  // 次要库
  textstatus: '微信状态(我发布的状态/心情)', textstatussessioninfo: '状态会话信息', findersessioninfo: '视频号会话信息', finderconversation: '视频号私信会话', wxfileindex3: '文件传输索引(收发文件的元信息:名/大小/时间)', wxfileindexrefresh: '文件索引刷新记录', wxfileindexregistry: '文件索引注册', file_assistant_v2: 'QQ文件传输助手记录', config_mgr_table: '配置管理(QQ)', misc_kv_storage_table: '杂项键值存储', online_status_kv_table: '在线状态键值', public_account_kv_table: '公众号键值', service_assistant_kv_table: '服务助手键值',
};

function tableDesc(name) {
  const exact = TABLE_DESC[name.toLowerCase()];
  if (exact) return exact;
  // 字节系明文库多为埋点日志，统一识别
  if (/^applog_/i.test(name)) return '应用埋点日志(' + name.replace(/^AppLog_/i, '') + '事件统计)';
  if (/tea_agent|^event$|^eventv3|^launch$|^pack$|^page$/i.test(name)) return '埋点上报(头条/抖音 Tea SDK)';
  if (/_fts(_|$)/i.test(name)) return '全文搜索索引(FTS,辅助表)';
  if (/_index$|_idx$/i.test(name)) return '索引表';
  if (/^sqlite_|^android_|room_master_table|metadata/i.test(name)) return '系统/框架表';
  const h = heuristic(name.replace(/_?(v\d+|ver\d+|table|tbl|info|list|new|old)$/i, '') || name);
  return h.startsWith('(') ? '(' + name + ')' : h + '表';
}
function tableSection(name, sql, cols) {
  let s = `### \`${name}\` — ${tableDesc(name)}\n\n`;
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

const SPLIT = val('--split');  // 给目录 → 每个 app 单独一个文件；否则合并到 --out
const HEADER = (title) => `# ${title}\n\n> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；\`(原名)\` 表示未能翻译的字段。\n> 表关联见 \`数据库表结构详解.md\`。生成器 \`scripts/android/pdh-gen-schema-dict.mjs\`。\n\n`;
const apps = []; // {label, file, kind}
for (const spec of multi('--db')) { const [label, file] = spec.split('='); apps.push({ label, file, kind: 'db' }); }
for (const spec of multi('--sql')) { const [label, file] = spec.split('='); apps.push({ label, file, kind: 'sql' }); }
let combined = HEADER('数据字典（完整）— 每库 / 每表 / 每字段 中文备注'); let grand = { nt: 0, nc: 0 };
for (const a of apps) {
  if (!fs.existsSync(a.file)) { console.error('skip', a.file); continue; }
  const r = a.kind === 'db' ? fromDb(a.file) : fromSql(a.file);
  grand.nt += r.nt; grand.nc += r.nc;
  console.log(`${a.label}: ${r.nt} 表 ${r.nc} 字段`);
  const body = `\n## 📁 ${a.label}  \`${path.basename(a.file)}\`\n\n${r.s}`;
  combined += body;
  if (SPLIT) {
    const safe = a.label.replace(/[\\/:*?"<>|\s]+/g, '_');
    const fp = path.join(SPLIT, `数据字典_${safe}.md`);
    fs.mkdirSync(SPLIT, { recursive: true });
    fs.writeFileSync(fp, HEADER(`数据字典 — ${a.label}（\`${path.basename(a.file)}\`）`) + `> 本库 ${r.nt} 张表 / ${r.nc} 个字段。\n\n` + r.s);
    console.log('  → wrote', fp);
  }
}
if (!SPLIT) {
  combined = combined.replace('每字段 中文备注\n', `每字段 中文备注\n\n> 共 ${grand.nt} 张表 / ${grand.nc} 个字段已标注。\n`);
  fs.writeFileSync(OUT, combined);
  console.log('\nwrote', OUT, `(${combined.length} chars, ${grand.nt} tables, ${grand.nc} fields)`);
} else console.log(`\nsplit done: ${grand.nt} 张表 / ${grand.nc} 字段 → ${SPLIT}`);
