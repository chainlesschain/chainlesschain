/**
 * Adapter import guides — step-by-step "如何把这个平台/App 的数据导入个人 AI
 * 中台" instructions, surfaced in the UI next to each data source.
 *
 * Why this exists: readiness() tells the user WHETHER a source can collect
 * and a one-line reason. But "needs_setup / 需手机采集" isn't actionable on
 * its own — the user needs the concrete steps (装 App → 进采集页 → ...,
 * or root + ADB pull DB, or 填 IMAP 授权码). This module is the single
 * source of truth for those steps, reused by web-shell / desktop / CLI /
 * Android so guidance never drifts per shell.
 *
 * Structure: most sources collect via one of a few shared MECHANISMS keyed
 * by category (local / snapshot / device / credential). So the guide is
 * category-driven, with per-adapter display names + optional overrides for
 * sources that have a bespoke flow (email IMAP, Alipay bill, WeChat).
 *
 * A guide = {
 *   displayName,            // 中文平台名
 *   category,              // local | snapshot | device | credential | platform
 *   summary,              // one-line "what this is"
 *   methods: [            // one or more ways to import; first = recommended
 *     { label, recommended?, steps: string[], note?: string }
 *   ],
 * }
 */

"use strict";

const { READINESS_CATEGORY } = require("./adapter-readiness");

// adapter name → 中文显示名. Keeps UI labels consistent across shells.
const DISPLAY_NAMES = Object.freeze({
  "social-bilibili": "哔哩哔哩",
  "social-weibo": "微博",
  "social-zhihu": "知乎",
  "recruit-boss": "BOSS 直聘",
  "social-csdn": "CSDN",
  "social-dongchedi": "懂车帝",
  "biz-tianyancha": "天眼查",
  "social-douyin": "抖音",
  "social-xiaohongshu": "小红书",
  "social-toutiao": "今日头条",
  "social-kuaishou": "快手",
  "messaging-qq": "QQ（手机）",
  "messaging-telegram": "Telegram",
  "messaging-whatsapp": "WhatsApp",
  "wechat": "微信（手机）",
  "wechat-pc": "微信（电脑版）",
  "qq-pc": "QQ（电脑版 NT）",
  "dingtalk-pc": "钉钉（电脑版）",
  "feishu-pc": "飞书（电脑版）",
  "wework-pc": "企业微信（电脑版）",
  "email-imap": "邮箱（IMAP）",
  "finance-alipay": "支付宝",
  "alipay-bill": "支付宝账单",
  "shopping-taobao": "淘宝",
  "shopping-jd": "京东",
  "shopping-meituan": "美团",
  "shopping-pinduoduo": "拼多多",
  "shopping-dianping": "大众点评",
  "travel-12306": "12306 铁路",
  "travel-ctrip": "携程",
  "travel-tongcheng": "同程旅行",
  "travel-didi": "滴滴企业版",
  "travel-amap": "高德地图",
  "travel-baidu-map": "百度地图",
  "travel-tencent-map": "腾讯地图",
  "game-genshin": "原神",
  "game-honor-of-kings": "王者荣耀",
  "edu-zuoyebang": "作业帮",
  "edu-huawei-learning": "华为教育中心",
  "ai-chat-history": "AI 对话历史",
  "apple-health": "Apple 健康",
  "netease-music": "网易云音乐",
  "music-kugou": "酷狗音乐",
  "music-qq": "QQ音乐",
  "video-iqiyi": "爱奇艺",
  "video-tencent": "腾讯视频",
  "video-xigua": "西瓜视频",
  "weread": "微信读书",
  "doc-wps": "WPS 云文档",
  "doc-tencent-docs": "腾讯文档",
  "doc-baidu-netdisk": "百度网盘",
  "doc-camscanner": "扫描全能王",
  "gov-ixiamen": "i厦门",
  "health-meiyou": "美柚",
  "gov-tax": "个人所得税",
  "bank-cmbc": "民生银行",
  "bank-boc": "中国银行",
  "bank-bankcomm": "交通银行",
  "bank-icbc": "工商银行",
  "finance-dcep": "数字人民币",
  "gov-12123": "交管12123",
  "browser-history-chrome": "Chrome 浏览历史",
  "browser-history-edge": "Edge 浏览历史",
  "vscode": "VS Code",
  "win-recent": "Windows 最近使用",
  "git-activity": "Git 提交记录",
  "shell-history": "命令行历史",
  "local-files": "本地文件",
  "system-data-android": "Android 系统数据",
});

// Shared guide for honest best-effort desktop IM local-DB sources (钉钉/飞书).
function localImPcGuide(platform) {
  const adapterName =
    platform === "钉钉" ? "dingtalk-pc" : platform === "企业微信" ? "wework-pc" : "feishu-pc";
  return {
    summary: `采集${platform}电脑版的聊天记录（来自本地数据库）。⚠️ v0.1 实验性：${platform}桌面库为私有结构、可能加密、随版本变化，文本解析为尽力而为，原始行会完整保留以便后续解析。`,
    methods: [
      {
        label: "解密本地库后直读（推荐）",
        recommended: true,
        steps: [
          `登录${platform}电脑版，定位其数据目录下的本地 SQLite 库。`,
          "若加密，用工具解密为明文（或采集时附带 --key）。",
          `执行 cc hub sync-adapter ${adapterName} --input <本地库路径>，或界面「📂 选择文件采集」。`,
          "中台自动发现消息表并入库；诊断会显示找到了哪些表/列。",
        ],
        note: "纯个人使用、全程本地。聊天记录敏感，首次会要求法律确认。文本若未解析出，原始行已保留，可后续在真机上微调列。",
      },
    ],
  };
}

// Shared guide for the social platforms that have a dedicated one-click ADB
// sync (B站/微博/小红书/头条/快手) — root 手机 + USB → 界面一键按钮直接采集。
function socialAdbGuide(platform, dataDesc) {
  return {
    summary: `采集${platform}的${dataDesc}。最快路径：插上已 root 的安卓手机（USB 调试）→ 在中台点该平台的「一键采集」按钮，自动从手机抓登录态并拉取数据入库——无需在网页端手动操作。`,
    methods: [
      {
        label: `方式一：root 手机 + USB 一键采集（推荐）`,
        recommended: true,
        steps: [
          "手机已 root，开启「开发者选项 → USB 调试」，用数据线连接电脑。",
          "确保电脑能看到设备（命令行 `adb devices` 列出你的手机）。",
          `手机上已登录${platform} App。`,
          `在中台点该平台的「一键采集」按钮（或对应的 *AdbSync 操作），自动抓取登录态 + 拉取数据入库。`,
        ],
        note: "登录态 / cookie 仅在本地处理，不上传服务器。纯个人使用。",
      },
      {
        label: "方式二：手机 App 内采集快照",
        steps: [
          "在手机 ChainlessChain App 内进入「数据源」，找到该平台点「采集」。",
          "按提示在内置浏览器登录，App 采完生成快照并同步到中台。",
        ],
      },
    ],
  };
}

function displayName(name) {
  return DISPLAY_NAMES[name] || name;
}

// ── category-level mechanism guides (the common path) ────────────────────

const CATEGORY_GUIDES = Object.freeze({
  [READINESS_CATEGORY.LOCAL]: {
    summary: "数据就在这台电脑上，中台直接读取，无需登录或联网。",
    methods: [
      {
        label: "本机直接采集",
        recommended: true,
        steps: [
          "确认对应程序/数据在本机存在（如浏览器已安装、代码仓库在本地）。",
          "点这一行的「同步」按钮即可入库。",
          "若状态是「待配置」，按提示在设置里指定数据目录后再同步。",
        ],
      },
    ],
  },

  [READINESS_CATEGORY.SNAPSHOT]: {
    summary:
      "该平台数据在手机 App 里。中台不直接抓取网页，而是在手机 App 内用你已登录的会话采集，再回传到中台——绕开平台风控，最稳。",
    methods: [
      {
        label: "方式一：手机 App 内采集（推荐）",
        recommended: true,
        steps: [
          "在手机上安装并打开 ChainlessChain App。",
          "进入「个人数据中心 → 数据源」，找到对应平台，点「采集」。",
          "按提示在内置浏览器里登录该平台（仅本机保存登录态）。",
          "App 采集完成后会生成快照并自动同步到中台 vault。",
        ],
        note: "登录态只存在你自己的设备上，采集动作 100% 本地。",
      },
      {
        label: "方式二：电脑通过 USB 连手机自动拉取",
        steps: [
          "手机开启「开发者选项 → USB 调试」，用数据线连接电脑。",
          "确保电脑已安装 adb（命令行 `adb devices` 能看到设备）。",
          "在手机 App 内先完成一次该平台采集（生成快照）。",
          "回到中台点这一行「同步」，会自动通过 ADB 拉取手机上的快照入库。",
        ],
      },
    ],
  },

  [READINESS_CATEGORY.DEVICE]: {
    summary:
      "该数据存在 App 的本地数据库里（加密或受保护）。需要 root 的手机或在电脑上做本地解密，把数据库导出后再导入——这是最可靠、不依赖网络接口的方式。",
    methods: [
      {
        label: "方式一：root 手机 + ADB 拉取数据库（推荐）",
        recommended: true,
        steps: [
          "手机已 root，开启 USB 调试并用数据线连接电脑。",
          "通过 ADB 从 `/data/data/<App 包名>/databases/` 拉取目标数据库。",
          "若数据库加密，按该平台说明取出解密密钥（如微信用 frida 提取）。",
          "在中台点「同步」并指定数据库路径（或用对应的一键采集按钮）。",
        ],
        note: "纯个人使用、数据全程本地，不上传任何服务器。",
      },
      {
        label: "方式二：电脑客户端本地数据库解密",
        steps: [
          "在电脑上登录该平台的桌面客户端（如微信 PC 版）。",
          "定位客户端的本地数据库文件。",
          "用本地密钥解密后，在中台「同步」时指定该数据库路径。",
        ],
      },
    ],
  },

  [READINESS_CATEGORY.CREDENTIAL]: {
    summary: "该数据源需要你提供账号或登录态后才能采集。",
    methods: [
      {
        label: "添加账号后采集",
        recommended: true,
        steps: [
          "在「数据源」上方点对应的「添加账号」按钮。",
          "按表单填入账号信息 / 完成登录授权。",
          "保存后回到列表点「同步」即可入库。",
        ],
      },
    ],
  },

  [READINESS_CATEGORY.PLATFORM]: {
    summary: "当前操作系统或运行环境不支持该数据源。",
    methods: [
      {
        label: "无法在此设备采集",
        steps: [
          "该数据源仅在特定平台可用（如部分功能仅 Windows）。",
          "请在受支持的设备上打开中台后再采集。",
        ],
      },
    ],
  },
});

// ── per-adapter overrides (bespoke flows) ────────────────────────────────

const ADAPTER_OVERRIDES = Object.freeze({
  "email-imap": {
    summary:
      "通过 IMAP 协议拉取邮件（账单、订单、行程、注册信息等会自动分类提取）。",
    methods: [
      {
        label: "添加 IMAP 邮箱账号（推荐）",
        recommended: true,
        steps: [
          "在邮箱网页端开启 IMAP 服务，并生成一个「授权码 / 应用专用密码」。",
          "点上方「添加邮箱账号」，填入邮箱地址 + 授权码（不是登录密码）。",
          "可先点「测试」验证连通，保存后点「同步」拉取邮件。",
        ],
        note: "常见邮箱（QQ/163/Gmail 等）已内置服务器配置，只需授权码。",
      },
      {
        label: "手机 App 内采集邮件快照",
        steps: [
          "在手机 App 内完成邮箱采集，生成快照后同步到中台。",
        ],
      },
    ],
  },

  "alipay-bill": {
    summary: "导入从支付宝导出的账单文件（含交易明细、对手方、金额）。",
    methods: [
      {
        label: "导入支付宝账单文件（推荐）",
        recommended: true,
        steps: [
          "支付宝 App →「我的 → 账单 → 右上角 ... → 开具交易流水证明 / 申请账单」。",
          "选择用于「个人对账」，邮箱会收到带密码的 ZIP（CSV）账单。",
          "点上方「导入支付宝账单」，选择 ZIP/CSV 文件并填入解压密码。",
        ],
      },
    ],
  },

  "finance-alipay": {
    summary: "导入从支付宝导出的账单文件（含交易明细、对手方、金额）。",
    methods: [
      {
        label: "导入支付宝账单文件（推荐）",
        recommended: true,
        steps: [
          "支付宝 App →「我的 → 账单」申请交易流水（用途选个人对账）。",
          "从邮箱下载带密码的账单 ZIP/CSV。",
          "点上方「导入支付宝账单」，选择文件并填入解压密码。",
        ],
      },
    ],
  },

  "wechat": {
    summary:
      "采集微信聊天记录 / 联系人 / 群（来自本地加密数据库 EnMicroMsg.db）。需要 root 手机或电脑本地解密。",
    methods: [
      {
        label: "方式一：root 手机 + frida 提取密钥（推荐）",
        recommended: true,
        steps: [
          "手机已 root，安装并运行 frida-server，开启 USB 调试连电脑。",
          "点上方「添加 WeChat」，按向导探测环境并提取数据库密钥。",
          "提取成功后点「同步」解密并入库。",
        ],
        note: "纯个人使用、全程本地。聊天记录敏感，首次会要求法律确认。",
      },
      {
        label: "方式二：电脑微信本地数据库解密",
        steps: [
          "电脑登录微信 PC 版，定位本地聊天数据库。",
          "用本地密钥解密后，在「添加 WeChat」向导里指定数据库路径。",
        ],
      },
    ],
  },

  "ai-chat-history": {
    summary: "采集你在各 AI 助手（DeepSeek/Kimi/豆包/通义等）里的对话历史。",
    methods: [
      {
        label: "WebView 登录向导（推荐）",
        recommended: true,
        steps: [
          "点上方「添加 AI 对话账号」，选择服务商。",
          "在弹出的内置浏览器里登录该 AI 服务（登录态仅本机保存）。",
          "向导抓取所需 Cookie 后注册账号，回列表点「同步」拉取对话。",
        ],
      },
    ],
  },

  "messaging-qq": {
    summary:
      "采集手机 QQ 的聊天记录 + 联系人 + 群（来自 App 本地数据库 <uin>.db）。库本身是明文 SQLite，消息正文按设备 IMEI 做 XOR 加密——root 拉库 + 提供 IMEI 即可本地直读。",
    methods: [
      {
        label: "方式一：root 手机拉 <uin>.db + IMEI 本地直读（推荐）",
        recommended: true,
        steps: [
          "root 手机开启 USB 调试连电脑。",
          "拉取 `/data/data/com.tencent.mobileqq/databases/<uin>.db`（uin 为你的 QQ 号）。",
          "在数据源设置中登记 QQ 账号(uin) + 设备 IMEI（用于 XOR 解密消息正文）。",
          "点「同步」直接读取联系人 / 群 / 消息入库。",
        ],
        note: "DB 明文、仅消息正文 XOR；纯个人使用、全程本地。",
      },
      {
        label: "方式二：手机 App 内 root 采集",
        steps: ["在已 root 的手机 App 内触发 QQ 采集，生成快照同步到中台。"],
      },
    ],
  },

  "qq-pc": {
    summary:
      "采集电脑版 QQ（NT 新版）的聊天记录（来自本地 nt_msg.db）。中台已支持自动解密 + 解析：取一次密钥后，自动解密 SQLCipher 库、解析 c2c/群消息的 protobuf 正文为可读文本（含发送者昵称、群号）。",
    methods: [
      {
        label: "方式一：取密钥后一键采集（推荐）",
        recommended: true,
        steps: [
          "在电脑上打开并登录 QQ（NT 新版，数据在 文档\\Tencent Files\\<QQ号>\\nt_qq\\nt_db\\nt_msg.db）。",
          "下载并运行 qq-win-db-key（github.com/QQBackup/qq-win-db-key 的 windows_ntqq_get_key.ps1）。它会全关 QQ → 以调试器启动 QQ → 你登录后自动抓出 16 位密钥（形如 5{sww#,6aq=)8=A@）。",
          "回到中台执行 `cc hub sync-adapter qq-pc --passphrase \"<那串密钥>\"`（或点该行「一键采集」并粘贴密钥）。",
          "中台自动解密 + 解析 c2c_msg_table / group_msg_table → 可读消息入库（私聊 + 群聊，含昵称/群号）。",
        ],
        note: "QQ 每次重启密钥会变，重采时重新跑 qq-win-db-key 取一次即可。纯个人使用、全程本地；首次会要求法律确认。依赖随中台分发的 Python（含 cryptography）。",
      },
      {
        label: "方式二：已解密为明文库则直接导入",
        steps: [
          "若已用工具把 nt_msg.db 解密为明文 SQLite，执行 `cc hub sync-adapter qq-pc --input <明文 nt_msg.db>`。",
        ],
      },
    ],
  },

  "wechat-pc": {
    summary:
      "采集电脑版微信的聊天记录 + 公众号 + 朋友圈 + 收藏 + 联系人。微信 4.0（xwechat_files）已支持全自动一键采集：中台自动发现本机数据库、从运行中的微信进程提取密钥、解密入库——无需手动解密或装第三方工具。",
    methods: [
      {
        label: "方式一：一键采集（微信 4.0，推荐，全自动）",
        recommended: true,
        steps: [
          "在这台电脑上打开并登录微信（4.0 版，数据在 文档\\xwechat_files\\）。",
          "回到中台，点 wechat-pc 这一行的「一键采集」（或 `cc hub sync-adapter wechat-pc`）。",
          "中台自动定位各数据库 → 从微信进程内存按库取密钥 → 解密 → 聊天/公众号/朋友圈/收藏/联系人全部入库。",
        ],
        note: "需要微信保持登录运行（密钥在内存里）。聊天记录含压缩消息与图片/文件/链接/引用等均会解析成可读文本。纯个人使用、全程本地，首次会要求法律确认。依赖随中台分发的 Python（含 cryptography）。",
      },
      {
        label: "方式二：旧版微信 3.x / 手动解密",
        steps: [
          "微信 3.x（文档\\WeChat Files\\<wxid>\\Msg\\）用工具（如 PyWxDump）解密 MSG0.db / MicroMsg.db 为明文。",
          "执行 `cc hub sync-adapter wechat-pc --input <解密后的 .db>`（或附 `--key <64位hex>` 让中台尝试直接解密）。",
        ],
      },
    ],
  },

  "dingtalk-pc": localImPcGuide("钉钉"),
  "feishu-pc": localImPcGuide("飞书"),
  "wework-pc": localImPcGuide("企业微信"),

  "social-bilibili": socialAdbGuide("哔哩哔哩", "观看历史 / 收藏 / 动态 / 关注"),
  "social-weibo": socialAdbGuide("微博", "微博 / 收藏 / 关注"),
  "social-xiaohongshu": socialAdbGuide("小红书", "笔记 / 点赞收藏 / 关注"),
  "social-toutiao": socialAdbGuide("今日头条", "阅读 feed / 收藏 / 搜索历史"),
  "social-kuaishou": socialAdbGuide("快手", "作品 / 推荐 / 个人主页"),

  "social-douyin": {
    summary:
      "采集抖音私信 + 联系人（来自 App 本地明文数据库 <uid>_im.db）。明文 SQLite、无加密、无 X-Bogus 签名——本地直读是最可靠的方式。",
    methods: [
      {
        label: "方式一：本地直读 <uid>_im.db（推荐，最可靠）",
        recommended: true,
        steps: [
          "root 手机开启 USB 调试连电脑（adb 可见）。",
          "从 `/data/data/com.ss.android.ugc.aweme/databases/` 拉取 `<uid>_im.db`（uid 为 19 位数字）。",
          "执行 `cc hub sync-adapter social-douyin --input <本地 im.db 路径>`，或在界面「同步」时选择该文件。",
          "中台自动识别 SQLite 并直接读取私信 + 联系人入库（无需快照、无需联网）。",
        ],
        note: "im.db 明文存储（多篇 DFIR 取证已证实），不需要 frida。纯个人使用、全程本地。",
      },
      {
        label: "方式二：电脑通过 USB 一键 ADB 采集",
        steps: [
          "root 手机连电脑，确保 adb 可见。",
          "点界面「通过 PC ADB 同步 Douyin」，自动拉取 im.db 并入库。",
        ],
      },
      {
        label: "方式三：手机 App 内 root 采集",
        steps: [
          "在已 root 的手机 App 内授予权限并触发抖音采集，生成快照同步到中台。",
        ],
      },
    ],
  },

  "weread": {
    summary:
      "采集微信读书的书架 / 划线 / 想法，构建你的阅读画像。走网页版 cookie——登录一次抓取登录态即可，无需 root。",
    methods: [
      {
        label: "登录抓取 cookie 后一键采集（推荐）",
        recommended: true,
        steps: [
          "电脑浏览器登录 weread.qq.com（微信扫码）。",
          "在中台点这一行采集，按提示粘贴登录态 cookie（或用内置登录窗口抓取）。",
          "中台自动拉取你有笔记的书 + 划线 + 想法入库。",
        ],
        note: "cookie 仅本地保存；wr_skey 会过期，过期后重新登录抓取即可。纯个人使用。",
      },
      {
        label: "已有快照文件则直接选择采集",
        steps: ["点「📂 选择文件采集」选中微信读书快照 JSON 即可入库。"],
      },
    ],
  },

  "apple-health": {
    summary:
      "导入 iPhone「健康」App 导出的数据（步数 / 心率 / 睡眠 / 体重 / 运动等）。这是最省事的健康数据来源——自己导出，无需越狱或连接，文件直读。",
    methods: [
      {
        label: "导出健康数据后一键选择文件采集（推荐）",
        recommended: true,
        steps: [
          "iPhone 打开「健康」App → 右上角头像 → 最下方「导出所有健康数据」。",
          "会生成一个 zip，解压得到 export.xml（可发到电脑）。",
          "在中台点这一行的「📂 选择文件采集」，选中 export.xml 即可自动入库。",
        ],
        note: "完全本地、无需越狱。文件较大时首次导入稍慢，会自动分批。",
      },
    ],
  },

  "netease-music": {
    summary: "采集网易云音乐的听歌记录 / 收藏 / 歌单，构建你的音乐口味画像。",
    methods: [
      {
        label: "手机 App 内采集（推荐）",
        recommended: true,
        steps: [
          "在手机 App「个人数据中心」里打开网易云音乐采集页。",
          "登录后采集听歌记录 / 歌单，生成快照自动同步到中台。",
        ],
      },
      {
        label: "已有快照文件则直接选择采集",
        steps: ["点「📂 选择文件采集」选中网易云快照 JSON 即可入库。"],
      },
    ],
  },

  "system-data-android": {
    summary: "采集 Android 通讯录、已装应用列表、短信、通话记录等系统数据。",
    methods: [
      {
        label: "手机 App 内采集（推荐）",
        recommended: true,
        steps: [
          "在手机 App「个人数据中心」里授予所需权限。",
          "点「采集系统数据」生成快照并同步到中台。",
        ],
      },
      {
        label: "电脑通过 USB 实时拉取",
        steps: [
          "手机开启 USB 调试连电脑（adb 可见）。",
          "中台点「同步」，自动通过 ADB 实时读取通讯录 + 应用列表。",
        ],
      },
    ],
  },
});

/**
 * Get the import guide for one adapter.
 *
 * @param {string} name      adapter name (e.g. "social-bilibili")
 * @param {string} category  readiness category (local/snapshot/device/...)
 * @returns {{displayName, category, summary, methods}}
 */
function getAdapterGuide(name, category) {
  const override = ADAPTER_OVERRIDES[name];
  const cat = category || _inferCategory(name);
  const base = CATEGORY_GUIDES[cat] || CATEGORY_GUIDES[READINESS_CATEGORY.LOCAL];
  return {
    displayName: displayName(name),
    category: cat,
    summary: (override && override.summary) || base.summary,
    methods: (override && override.methods) || base.methods,
  };
}

// Fallback category inference when caller doesn't pass one (keeps the guide
// usable standalone, e.g. CLI without a live readiness probe).
function _inferCategory(name) {
  if (ADAPTER_OVERRIDES[name] && name === "wechat") return READINESS_CATEGORY.DEVICE;
  if (/^(email-imap|finance-alipay|alipay-bill|ai-chat-history|weread|doc-wps|doc-tencent-docs|doc-baidu-netdisk|doc-camscanner|recruit-boss|social-csdn|social-dongchedi|biz-tianyancha|gov-ixiamen|health-meiyou|gov-tax|bank-cmbc|bank-boc|bank-bankcomm|finance-dcep|gov-12123|bank-icbc)$/.test(name))
    return READINESS_CATEGORY.CREDENTIAL;
  if (/^(messaging-(telegram|whatsapp)|wechat|wechat-pc|messaging-qq|qq-pc|dingtalk-pc|feishu-pc|wework-pc|travel-amap)$/.test(name))
    return READINESS_CATEGORY.DEVICE;
  if (
    /^(browser-history-|vscode|win-recent|git-activity|shell-history|local-files|apple-health)/.test(
      name,
    )
  )
    return READINESS_CATEGORY.LOCAL;
  return READINESS_CATEGORY.SNAPSHOT;
}

module.exports = {
  DISPLAY_NAMES,
  displayName,
  CATEGORY_GUIDES,
  ADAPTER_OVERRIDES,
  getAdapterGuide,
};
