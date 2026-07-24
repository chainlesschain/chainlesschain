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
  "social-douban": "豆瓣",
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
  wechat: "微信（手机）",
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
  "shopping-eleme": "饿了么",
  "shopping-pinduoduo": "拼多多",
  "shopping-dianping": "大众点评",
  "shopping-xianyu": "闲鱼",
  "shopping-vipshop": "唯品会",
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
  "audio-ximalaya": "喜马拉雅",
  "reading-fanqie": "番茄小说",
  "reading-qimao": "七猫小说",
  "fitness-joyrun": "悦跑圈",
  "fitness-keep": "Keep",
  "travel-didi-consumer": "滴滴出行",
  "car-mercedesme": "奔驰 Mercedes me",
  "video-iqiyi": "爱奇艺",
  "video-tencent": "腾讯视频",
  "video-xigua": "西瓜视频",
  weread: "微信读书",
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
  "browser-history-brave": "Brave 浏览历史",
  "browser-history-opera": "Opera 浏览历史",
  "browser-history-vivaldi": "Vivaldi 浏览历史",
  "browser-history-safari": "Safari 浏览历史",
  "browser-history-firefox": "Firefox 浏览历史",
  "browser-history-aosp": "MIUI/AOSP 浏览历史",
  "meeting-tencent": "腾讯会议历史",
  vscode: "VS Code",
  vscodium: "VSCodium",
  cursor: "Cursor",
  "claude-code": "Claude Code",
  "jetbrains-ide": "JetBrains IDE",
  "win-recent": "Windows 最近使用",
  "git-activity": "Git 提交记录",
  "shell-history": "命令行历史",
  hbuilderx: "HBuilderX",
  "local-files": "本地文件",
  "system-data-android": "Android 系统数据",
});

// Shared guide for honest best-effort desktop IM local-DB sources (钉钉/飞书).
function localImPcGuide(platform) {
  const adapterName =
    platform === "钉钉"
      ? "dingtalk-pc"
      : platform === "企业微信"
        ? "wework-pc"
        : "feishu-pc";
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

function shoppingCookieGuide(adapterName, platform, accountLabel) {
  return {
    summary: `采集${platform}订单。支持兼容快照导入，也支持用单次临时 Cookie 从电脑直接拉取；若手机端已有该平台采集入口，也可由手机生成快照。临时凭据不会写入账号库。`,
    methods: [
      {
        label: "手机或快照文件采集（稳定路径）",
        recommended: true,
        steps: [
          `若手机 ChainlessChain App 的数据源页已提供${platform}采集入口，可在手机端生成订单快照；否则使用已有的兼容快照文件。`,
          "在中台选择符合 schemaVersion 1 的对应订单快照 JSON 文件导入；手机生成的快照可按其同步流程进入中台。",
        ],
      },
      {
        label: "临时 Cookie 直采（实验性）",
        steps: [
          `在浏览器登录${platform}，从开发者工具复制当前登录会话的 Cookie。`,
          `把 Cookie 保存到仅当前用户可读的文本文件，并确认账号标识（${accountLabel}）。`,
          `执行 \`cc hub sync-adapter ${adapterName} --cookie-file <cookie.txt> --account-id <账号标识>\`。`,
          "中台通过受限 HTTPS/JSON transport 拉取；HTTP、非 JSON、超时会明确失败并保留旧水位。",
        ],
        note: "平台接口及签名会变化；若返回登录页或签名错误，请重新获取 Cookie，或改用快照路径。Cookie 只用于本次命令，不持久化。",
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

const CHROMIUM_BROWSER_GUIDE = Object.freeze({
  summary:
    "\u4ece\u672c\u673a Chromium \u914d\u7f6e\u76ee\u5f55\u91c7\u96c6\u6d4f\u89c8\u5386\u53f2\u3001\u4e0b\u8f7d\u8bb0\u5f55\u548c\u4e66\u7b7e\uff0c\u65e0\u9700\u6269\u5c55\u3001\u8d26\u53f7\u6216\u7f51\u7edc\u3002\u914d\u7f6e\u8def\u5f84\u53ea\u7528\u4e8e\u672c\u5730\u8bfb\u53d6\u548c\u54c8\u5e0c\u4f5c\u7528\u57df\uff0c\u4e0d\u5199\u5165\u4e2a\u4eba\u6570\u636e\u5b9e\u4f53\u3002",
  methods: [
    {
      label:
        "\u81ea\u52a8\u53d1\u73b0\u6700\u8fd1\u4f7f\u7528\u7684\u914d\u7f6e\uff08\u63a8\u8350\uff09",
      recommended: true,
      steps: [
        "\u786e\u8ba4\u6d4f\u89c8\u5668\u5df2\u5728\u672c\u673a\u6253\u5f00\u5e76\u4f7f\u7528\u8fc7\u81f3\u5c11\u4e00\u6b21\u3002",
        "\u5728\u6570\u636e\u4e2d\u53f0\u5237\u65b0\u6765\u6e90\uff1b\u4e2d\u53f0\u4f1a\u4f18\u5148\u8bfb\u53d6 Local State \u4e2d\u7684\u6700\u8fd1 profile\u3002",
        "\u70b9\u51fb\u91c7\u96c6\uff1bHistory \u6570\u636e\u5e93\u4f1a\u5148\u590d\u5236\u4e3a\u4e34\u65f6\u53ea\u8bfb\u5feb\u7167\uff0c\u4ece\u4e2d\u89e3\u6790\u8bbf\u95ee\u53ca\u4e0b\u8f7d\u8bb0\u5f55\uff0c\u4e66\u7b7e\u6309\u672c\u5730 JSON \u89e3\u6790\u3002",
      ],
      note: "\u9ed8\u8ba4\u8fc7\u6ee4 hidden \u9875\u9762\uff1b\u4e0b\u8f7d\u76ee\u6807\u53ea\u4fdd\u7559\u6587\u4ef6\u540d\u4e0e\u8def\u5f84\u54c8\u5e0c\uff0c\u6765\u6e90 URL \u4f1a\u79fb\u9664\u51ed\u636e\u3001\u67e5\u8be2\u53c2\u6570\u548c\u7247\u6bb5\u3002\u914d\u7f6e\u7edd\u5bf9\u8def\u5f84\u4e0d\u8fdb\u5165\u5b9e\u4f53\u3001\u5ba1\u8ba1\u6216\u6c34\u4f4d\uff0c\u9650\u989d\u672a\u626b\u5b8c\u65f6\u4fdd\u7559\u65e7\u6c34\u4f4d\u3002",
    },
    {
      label: "\u9009\u62e9\u5176\u4ed6\u6d4f\u89c8\u5668 profile",
      steps: [
        "\u9009\u62e9\u5305\u542b History\uff08\u8bbf\u95ee\u4e0e\u4e0b\u8f7d\uff0c\u53ef\u9009 Bookmarks\uff09\u7684\u4ea7\u54c1\u914d\u7f6e\u6839\u76ee\u5f55\u3001Default \u6216 Profile N \u76ee\u5f55\u3002",
        "\u547d\u4ee4\u884c\u6267\u884c `cc hub sync-adapter <adapter> --profile-path <profile\u76ee\u5f55>`\u3002",
        "\u591a\u4e2a profile \u4f7f\u7528\u5404\u81ea\u7684\u54c8\u5e0c\u4f5c\u7528\u57df\u548c\u7a33\u5b9a\u5b9e\u4f53 ID\u3002",
      ],
    },
  ],
});

const SAFARI_BROWSER_GUIDE = Object.freeze({
  summary:
    "从 macOS Safari 本地配置采集浏览历史、下载记录和书签，无需扩展、账号或网络。支持经典配置和 Safari 17+ 独立 profile；下载目标路径只保留文件名、扩展名和 SHA-256，带凭据或签名参数的来源 URL 会先净化。",
  methods: [
    {
      label: "自动发现 Safari 配置（推荐）",
      recommended: true,
      steps: [
        "确认 Safari 已在这台 Mac 上使用过，并完全退出 Safari 以获得最稳定的数据库快照。",
        "在数据中台刷新来源并点击采集；中台会复制 History.db 及 WAL 为临时只读快照，同时解析 XML 或二进制 Bookmarks.plist / Downloads.plist。",
        "若 macOS 拒绝读取，请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 ChainlessChain，然后重新打开应用。",
      ],
      note: "全程本地处理；临时快照在解析后清理。Safari 默认会在一天后从下载列表移除项目，建议及时采集。限额未扫描到源尾时保留旧水位，配置路径和下载目标绝对路径不会进入实体、审计或同步水位。",
    },
    {
      label: "选择其他 Safari profile",
      steps: [
        "选择包含 History.db 的 Safari 目录，或直接选择 History.db；Safari 17+ profile 通常位于 Safari/Profiles 的子目录。",
        "命令行执行 `cc hub sync-adapter browser-history-safari --profile-path <配置目录或History.db>`。",
        "不同 profile 使用各自的哈希作用域和稳定实体 ID；中台优先读取 profile 本地书签/下载列表，不存在时回退到 Safari 共享文件。",
      ],
      note: "只有 macOS 主机存在 Safari 默认目录；其他系统仍可手动选择从本人 Mac 合法复制的配置目录进行本地导入。",
    },
  ],
});

const ADAPTER_OVERRIDES = Object.freeze({
  "browser-history-chrome": CHROMIUM_BROWSER_GUIDE,
  "browser-history-edge": CHROMIUM_BROWSER_GUIDE,
  "browser-history-brave": CHROMIUM_BROWSER_GUIDE,
  "browser-history-opera": CHROMIUM_BROWSER_GUIDE,
  "browser-history-vivaldi": CHROMIUM_BROWSER_GUIDE,
  "browser-history-safari": SAFARI_BROWSER_GUIDE,
  vscode: {
    summary:
      "\u4ece\u672c\u673a VS Code \u7528\u6237\u6570\u636e\u76ee\u5f55\u91c7\u96c6\u5de5\u4f5c\u533a\u3001\u7ec8\u7aef\u5386\u53f2\u548c Local History \u4fdd\u5b58\u65f6\u95f4\u7ebf\u3002\u4e0d\u9700\u8981\u6269\u5c55\u3001\u8d26\u53f7\u6216\u7f51\u7edc\uff0c\u4e5f\u4e0d\u8bfb\u53d6 Local History \u4fdd\u5b58\u7684\u6e90\u7801\u5185\u5bb9\u3002",
    methods: [
      {
        label:
          "\u81ea\u52a8\u53d1\u73b0 VS Code \u672c\u5730\u6570\u636e\uff08\u63a8\u8350\uff09",
        recommended: true,
        steps: [
          "\u786e\u8ba4 VS Code \u5df2\u5728\u672c\u673a\u6253\u5f00\u8fc7\u5de5\u4f5c\u533a\uff1b\u7ec8\u7aef\u548c Local History \u9700\u5148\u5728 VS Code \u4e2d\u4ea7\u751f\u8fc7\u76f8\u5e94\u8bb0\u5f55\u3002",
          "\u5728\u6570\u636e\u4e2d\u53f0\u5237\u65b0\u6765\u6e90\u5e76\u70b9\u51fb\u91c7\u96c6\uff1b\u4e2d\u53f0\u4f1a\u53ea\u8bfb workspaceStorage\u3001globalStorage/state.vscdb \u548c History/*/entries.json\u3002",
          "\u547d\u4ee4\u884c\u53ef\u6267\u884c `cc hub sync-adapter vscode`\uff1b\u5982\u4e0d\u5e0c\u671b\u91c7\u96c6 Local History \u4fdd\u5b58\u52a8\u4f5c\uff0c\u52a0 `--no-local-history`\u3002",
        ],
        note: "\u5de5\u4f5c\u533a\u548c\u7ec8\u7aef\u76ee\u5f55\u7684\u7edd\u5bf9\u8def\u5f84\u4f1a\u5728\u539f\u59cb\u5f52\u6863\u524d\u7f29\u51cf\u4e3a\u672b\u7ea7\u540d\u79f0\u4e0e SHA-256\uff1bLocal History \u53ea\u4fdd\u7559\u6587\u4ef6\u540d\u3001\u6269\u5c55\u540d\u3001URI \u534f\u8bae\u3001\u8def\u5f84\u54c8\u5e0c\u548c\u4fdd\u5b58\u65f6\u95f4\uff0c\u4e0d\u6253\u5f00\u4efb\u4f55\u5386\u53f2\u5185\u5bb9\u6587\u4ef6\u3002\u7ec8\u7aef\u547d\u4ee4\u6b63\u6587\u4ecd\u5c5e\u9ad8\u654f\u611f\u6570\u636e\u3002",
      },
    ],
  },
  vscodium: {
    summary:
      "\u4ece\u672c\u673a VSCodium \u7528\u6237\u6570\u636e\u76ee\u5f55\u91c7\u96c6\u5de5\u4f5c\u533a\u3001\u7ec8\u7aef\u5386\u53f2\u548c Local History \u4fdd\u5b58\u65f6\u95f4\u7ebf\u3002\u4e0d\u9700\u8981\u6269\u5c55\u3001\u8d26\u53f7\u6216\u7f51\u7edc\uff0c\u4e5f\u4e0d\u8bfb\u53d6 Local History \u4fdd\u5b58\u7684\u6e90\u7801\u5185\u5bb9\u3002",
    methods: [
      {
        label:
          "\u81ea\u52a8\u53d1\u73b0 VSCodium \u672c\u5730\u6570\u636e\uff08\u63a8\u8350\uff09",
        recommended: true,
        steps: [
          "\u786e\u8ba4 VSCodium \u5df2\u5728\u672c\u673a\u6253\u5f00\u8fc7\u5de5\u4f5c\u533a\uff1b\u7ec8\u7aef\u548c Local History \u9700\u5148\u5728 VSCodium \u4e2d\u4ea7\u751f\u8fc7\u76f8\u5e94\u8bb0\u5f55\u3002",
          "\u5728\u6570\u636e\u4e2d\u53f0\u5237\u65b0\u6765\u6e90\u5e76\u70b9\u51fb\u91c7\u96c6\uff1b\u4e2d\u53f0\u4f1a\u53ea\u8bfb workspaceStorage\u3001globalStorage/state.vscdb \u548c History/*/entries.json\u3002",
          "\u547d\u4ee4\u884c\u53ef\u6267\u884c `cc hub sync-adapter vscodium`\uff1b\u4e5f\u53ef\u7528 `--profile-path <VSCodium \u7528\u6237\u6570\u636e\u76ee\u5f55>` \u624b\u52a8\u9009\u62e9\uff0c\u7528 `--no-local-history` \u6392\u9664\u4fdd\u5b58\u52a8\u4f5c\u3002",
        ],
        note: "\u5de5\u4f5c\u533a\u548c\u7ec8\u7aef\u76ee\u5f55\u7684\u7edd\u5bf9\u8def\u5f84\u4f1a\u5728\u539f\u59cb\u5f52\u6863\u524d\u7f29\u51cf\u4e3a\u672b\u7ea7\u540d\u79f0\u4e0e SHA-256\uff1bLocal History \u53ea\u4fdd\u7559\u6587\u4ef6\u540d\u3001\u6269\u5c55\u540d\u3001URI \u534f\u8bae\u3001\u8def\u5f84\u54c8\u5e0c\u548c\u4fdd\u5b58\u65f6\u95f4\uff0c\u4e0d\u6253\u5f00\u4efb\u4f55\u5386\u53f2\u5185\u5bb9\u6587\u4ef6\u3002\u7ec8\u7aef\u547d\u4ee4\u6b63\u6587\u4ecd\u5c5e\u9ad8\u654f\u611f\u6570\u636e\uff1b\u9650\u989d\u672a\u626b\u5b8c\u65f6\u4fdd\u7559\u65e7\u6c34\u4f4d\u3002",
      },
    ],
  },
  cursor: {
    summary:
      "从本机 Cursor 用户数据目录采集工作区、终端历史、Local History 保存元数据，以及 `.cursor/projects/*/agent-transcripts` 中的 Agent 提问/回答和 `ai-tracking` 中的对话摘要、AI 代码活动元数据。全程只读，不需要 Cursor 账号、网络或扩展。",
    methods: [
      {
        label: "自动发现 Cursor 本地数据（推荐）",
        recommended: true,
        steps: [
          "确认 Cursor 已在本机打开过项目或运行过 Agent；Windows 默认读取 `%APPDATA%\\Cursor` 与 `%USERPROFILE%\\.cursor`，macOS/Linux 使用对应的 Cursor Application Support/config 与 `~/.cursor`。",
          "在数据中台刷新来源并点击采集；中台会读取 VS Code 同源状态、Agent JSONL transcript，以及可选的 AI tracking SQLite 元数据。",
          "命令行可执行 `cc hub sync-adapter cursor`；用 `--profile-path <Cursor用户数据目录>` 和 `--cursor-home <.cursor目录>` 手动选择，用 `--no-local-history`、`--no-agent-transcripts` 或 `--no-ai-tracking` 排除对应数据。",
        ],
        note: "Agent 提问与回答正文属于高敏感数据。项目/config 绝对路径、项目目录名、会话 UUID、request ID 和跟踪主键会在 raw 归档前哈希或剔除；不查询 `cursorAuth` token/email、`tracked_file_content.content`、gitPath、分支或提交正文，也不打开 Local History 源码副本。文件损坏、内容超限或扫描截断时保留旧水位。",
      },
    ],
  },
  "claude-code": {
    summary:
      "从本机 Claude Code 配置目录采集主会话和子代理 JSONL 中的用户/助手文本，以及 stats-cache.json 的每日消息、会话、工具调用和模型 token 汇总。全程只读，不需要账号凭据或网络。",
    methods: [
      {
        label: "自动发现 Claude Code 本地数据（推荐）",
        recommended: true,
        steps: [
          "确认 Claude Code 已在本机产生可恢复会话；默认读取 `%USERPROFILE%\\.claude`（Windows）或 `~/.claude`，并尊重 `CLAUDE_CONFIG_DIR`。",
          "在数据中台刷新来源并点击采集；中台会完整扫描 `projects/*/*.jsonl` 和可选的 `projects/*/*/subagents/*.jsonl`，再通过时间水位增量同步。",
          "命令行可执行 `cc hub sync-adapter claude-code`；用 `--claude-home <目录>` 手动选择，用 `--no-claude-subagents` 或 `--no-claude-stats` 排除对应数据。",
        ],
        note: "会话正文属于高敏感数据。项目路径和目录键、session/request/message/agent ID 只保留 SHA-256；不读取 `.credentials.json`、`~/.claude.json`、settings、环境值、history.jsonl、file-history，也不归档 tool_use、tool_result、thinking 或 isMeta 内部消息。文件损坏、超出安全上限或显式 limit 截断时保留旧水位。",
      },
    ],
  },
  "jetbrains-ide": {
    summary:
      "\u4ece\u672c\u673a JetBrains Platform IDE \u7684 `options/recentProjects.xml` \u91c7\u96c6\u6700\u8fd1\u9879\u76ee\u548c\u6700\u540e\u6253\u5f00/\u6fc0\u6d3b\u65f6\u95f4\uff0c\u8986\u76d6 IntelliJ IDEA\u3001WebStorm\u3001PyCharm\u3001GoLand\u3001CLion \u7b49\u4ea7\u54c1\u3002\u4e0d\u8bfb\u53d6\u9879\u76ee\u6587\u4ef6\u3001`.idea` \u76ee\u5f55\u6216 IDE Local History \u6b63\u6587\u3002",
    methods: [
      {
        label:
          "\u81ea\u52a8\u53d1\u73b0 JetBrains IDE \u914d\u7f6e\uff08\u63a8\u8350\uff09",
        recommended: true,
        steps: [
          "\u786e\u8ba4\u81f3\u5c11\u4e00\u4e2a JetBrains IDE \u5df2\u5728\u672c\u673a\u6253\u5f00\u8fc7\u9879\u76ee\u3002",
          "\u5728\u6570\u636e\u4e2d\u53f0\u5237\u65b0\u6765\u6e90\u5e76\u70b9\u51fb\u91c7\u96c6\uff1b\u4e2d\u53f0\u4f1a\u5408\u5e76\u9ed8\u8ba4 JetBrains \u914d\u7f6e\u6839\u4e0b\u5404\u4ea7\u54c1\u7248\u672c\u7684\u6700\u8fd1\u9879\u76ee\u6e05\u5355\u3002",
          "\u547d\u4ee4\u884c\u53ef\u6267\u884c `cc hub sync-adapter jetbrains-ide`\uff1b\u4e5f\u53ef\u7528 `--profile-path <JetBrains\u914d\u7f6e\u6839\u6216\u5355\u4e2a\u4ea7\u54c1\u914d\u7f6e\u76ee\u5f55>` \u624b\u52a8\u9009\u62e9\u3002",
        ],
        note: "\u9879\u76ee\u7edd\u5bf9\u8def\u5f84\u5728\u539f\u59cb\u5f52\u6863\u524d\u7f29\u51cf\u4e3a\u672b\u7ea7\u9879\u76ee\u540d\u548c SHA-256\u3002\u7a97\u53e3\u6807\u9898\u3001\u5206\u652f\u540d\u3001workspace UUID\u3001IDE \u5b89\u88c5\u8def\u5f84\u548c\u9690\u85cf\u9879\u76ee\u5747\u4e0d\u5165\u5e93\uff1b\u9650\u989d\u672a\u626b\u5b8c\u65f6\u4fdd\u7559\u65e7\u6c34\u4f4d\u3002",
      },
    ],
  },
  "git-activity": {
    summary:
      "从本机所选代码根目录采集当前 HEAD 可达的非合并 Git 提交活动。增量进度按仓库使用版本化图游标，不依赖提交时间，因此新增仓库、回退或历史改写会安全重放。",
    methods: [
      {
        label: "自动发现本机 Git 仓库（推荐）",
        recommended: true,
        steps: [
          "在数据中台刷新来源并点击采集；默认只检查常见代码根目录及其直接子目录中的结构有效仓库。",
          "也可选择一个代码根目录或仓库目录，命令行执行 `cc hub sync-adapter git-activity --profile-path <目录>`。",
          "分页游标会记录仅由仓库哈希和提交哈希派生的安全锚点与恢复偏移；仓库图变化时从当前 HEAD 安全重放并按稳定记录 ID 去重。",
        ],
        note: "作者姓名（author name）、作者邮箱（author email）、提交主题（commit subject）和仓库名（repoName）属于高敏感采集字段；绝对根目录和仓库路径、原始 Git SHA、remote URL、凭据、分支名、reflog、diff 与文件内容均不入库。只采当前 HEAD 可达的非 merge 提交；游标或读取失败时保留旧水位。",
      },
    ],
  },
  "shell-history": {
    summary:
      "从本机 PowerShell、bash 与 zsh 的标准历史文件采集命令记录。bash/zsh 内嵌时间优先；无逐条时间时，文件修改时间只作为快照观测时间，并在 vault 中保留首次观测时间。",
    methods: [
      {
        label: "采集本机命令行历史（推荐）",
        recommended: true,
        steps: [
          "确认对应 shell 已生成 PSReadLine、`.bash_history` 或 `.zsh_history` 标准历史文件。",
          "在数据中台刷新来源并点击采集，或执行 `cc hub sync-adapter shell-history`。",
          "Bash/zsh 时间分隔记录和 PSReadLine 续行会先合并为完整多行命令；重复命令再按内容、时间来源和出现次数生成稳定 ID。",
        ],
        note: "命令正文属于高敏感数据。历史文件绝对路径只用于本地读取，入库前替换为 SHA-256 来源标识；不会读取 profile、启动脚本或命令之外的环境变量。无内嵌时间的记录明确按“首次观测快照”处理，文件后续追加不会移动既有事件时间；文件变化、损坏、缺失或安全预算截断时保留旧水位。",
      },
    ],
  },
  "local-files": {
    summary:
      "\u4ece\u672c\u673a\u5e38\u7528\u7528\u6237\u76ee\u5f55\u6216\u624b\u52a8\u9009\u62e9\u7684\u76ee\u5f55\u91c7\u96c6\u6587\u4ef6\u6d3b\u52a8\u5143\u6570\u636e\u3002\u53ea\u4fdd\u7559\u6587\u4ef6\u540d\u3001\u6269\u5c55\u540d\u3001\u5927\u5c0f\u3001\u4fee\u6539\u65f6\u95f4\u548c\u4f5c\u7528\u57df\u7ed1\u5b9a\u7684 SHA-256\uff1b\u4e0d\u8bfb\u53d6\u6587\u4ef6\u6b63\u6587\u3002",
    methods: [
      {
        label:
          "\u9009\u62e9\u8981\u626b\u63cf\u7684\u672c\u5730\u76ee\u5f55\uff08\u63a8\u8350\uff09",
        recommended: true,
        steps: [
          "\u5728\u6570\u636e\u4e2d\u53f0\u9009\u62e9\u4e00\u4e2a\u672c\u4eba\u6709\u6743\u5904\u7406\u7684\u76ee\u5f55\uff0c\u7136\u540e\u5f00\u59cb\u91c7\u96c6\uff1b\u5c31\u7eea\u72b6\u6001\u4e0d\u4f1a\u8df3\u8fc7\u8fd9\u4e00\u6388\u6743\u6b65\u9aa4\u3002\u4ec5\u547d\u4ee4\u884c\u65e0\u53c2\u8fd0\u884c\u65f6\uff0c\u4f1a\u81ea\u52a8\u68c0\u67e5 Documents\u3001Desktop\u3001Downloads\u3001Pictures\u3001Videos \u548c Music \u4e2d\u5df2\u5b58\u5728\u4e14\u53ef\u8bfb\u7684\u76ee\u5f55\u3002",
          "\u547d\u4ee4\u884c\u53ef\u6267\u884c `cc hub sync-adapter local-files --root <\u76ee\u5f55>`\uff1b\u591a\u4e2a\u76ee\u5f55\u8bf7\u91cd\u590d `--root`\uff0c\u542b\u9017\u53f7\u6216\u9996\u5c3e\u7a7a\u683c\u7684\u8def\u5f84\u4f1a\u539f\u6837\u4fdd\u7559\u3002\u65e7 `--roots` \u53ea\u517c\u5bb9\u5355\u4e2a\u65e0\u9017\u53f7\u76ee\u5f55\uff0c\u6b67\u4e49\u503c\u4f1a\u62d2\u7edd\u6267\u884c\u3002",
          "\u91c7\u96c6\u5668\u4f1a\u8fdb\u884c\u6709\u754c\u7684\u5b8c\u6574\u5143\u6570\u636e\u91cd\u626b\uff0c\u56e0\u6b64\u4e0a\u6b21\u540c\u6b65\u540e\u624d\u590d\u5236\u8fdb\u6765\u7684\u65e7\u65f6\u95f4\u6587\u4ef6\u4e5f\u4e0d\u4f1a\u9057\u6f0f\u3002",
        ],
        note: "\u6587\u4ef6\u540d\u5c5e\u4e8e\u9ad8\u654f\u611f\u5143\u6570\u636e\u3002\u7edd\u5bf9\u8def\u5f84\u3001\u76f8\u5bf9\u8def\u5f84\u3001\u6839\u76ee\u5f55\u548c\u6587\u4ef6\u6b63\u6587\u5747\u4e0d\u8fdb\u5165 raw \u5f52\u6863\u6216\u6807\u51c6\u5316\u5b9e\u4f53\uff1bWindows \u7f51\u7edc/\u8bbe\u5907\u547d\u540d\u7a7a\u95f4\u548c\u91cd\u89e3\u6790\u70b9\u6839\u76ee\u5f55\u4f1a\u88ab\u62d2\u7edd\u3002\u9ed8\u8ba4\u8df3\u8fc7\u540d\u79f0\u4ee5 `.` \u5f00\u5934\u7684\u9879\u3001\u7b26\u53f7\u94fe\u63a5\u3001`.git`\u3001`node_modules` \u548c\u5df2\u77e5\u7f13\u5b58\u76ee\u5f55\uff1bWindows Hidden/System \u5c5e\u6027\u672c\u8eab\u4e0d\u4f5c\u4e3a\u8fc7\u6ee4\u6761\u4ef6\uff0c\u8bf7\u901a\u8fc7\u76ee\u5f55\u9009\u62e9\u63a7\u5236\u8303\u56f4\u3002\u4ec5\u6570\u91cf\u622a\u65ad\u4f1a\u4fdd\u7559\u65e7\u6c34\u4f4d\u5e76\u6269\u5927\u4e0b\u6b21\u9884\u7b97\uff1b\u8bfb\u53d6\u5931\u8d25\u3001\u76ee\u5f55\u53d8\u5316\u6216\u5176\u4ed6\u5b89\u5168\u9884\u7b97\u8017\u5c3d\u4f1a\u76f4\u63a5\u62a5\u9519\u4e14\u4e0d\u63a8\u8fdb\u6c34\u4f4d\u3002",
      },
    ],
  },
  hbuilderx: {
    summary:
      "从本机 HBuilderX 配置根目录的直接子级 INI 中采集带时间的文件活动元数据。只保留作用域绑定的路径哈希、文件类型、扩展名和安全编码标识，不读取项目文件或代码正文。",
    methods: [
      {
        label: "自动发现 HBuilderX 本地活动（推荐）",
        recommended: true,
        steps: [
          "确认 HBuilderX 已在本机打开并编辑过文件；Windows 默认检查 `%APPDATA%\\HBuilder X` 与 `%LOCALAPPDATA%\\HBuilder X`。",
          "在数据中台刷新来源并点击采集；也可选择 HBuilderX 配置目录。采集器只检查根目录直接子级 `.ini`，不会递归进入缓存、插件或项目目录。",
          "命令行可执行 `cc hub sync-adapter hbuilderx`；便携版或自定义目录使用 `--hbuilderx-home <目录>` 或 `--profile-path <目录>`。如源时间不在系统时区，增加 `--source-timezone <IANA或UTC偏移>`。",
        ],
        note: "文件活动属于高敏感元数据。绝对路径、文件名、项目/工作区名和 INI section 名不会入库；语言索引的 lineText/context/value、日志原文、外部命令、Local History、终端和 AI 对话均明确排除。文件变化、解析异常或安全预算截断时保留旧水位。",
      },
    ],
  },
  "meeting-tencent": {
    summary:
      "从本人电脑上的腾讯会议客户端本地数据库采集历史会议时间线，包括主题、开始/加入/离开时间、时长、创建者、参会者以及文档/录制/AI 纪要元数据。不会读取会议密码、登录 token 或聊天正文。",
    methods: [
      {
        label: "自动发现腾讯会议数据（推荐）",
        recommended: true,
        steps: [
          "确认腾讯会议桌面端已登录并产生过历史会议；为获得稳定快照，建议先退出腾讯会议。",
          "在数据中台刷新来源并点击采集；中台会在腾讯会议 Database 目录中按表结构定位哈希命名的历史库，再复制 SQLite/WAL 临时只读快照。",
          "该来源标记为高敏感并带法律确认标识；仅应采集本人账号、本人设备中依法可处理的会议数据。",
        ],
        note: "Windows 默认根目录为 `%APPDATA%\\Tencent\\WeMeet`；macOS 默认根目录为 `~/Library/Containers/com.tencent.meeting/Data/Library`。会议号、用户 UID 和绝对路径会在原始归档前剔除或哈希。",
      },
      {
        label: "手动选择腾讯会议目录或历史库",
        steps: [
          "选择 WeMeet 数据根目录，或选择包含 historical_meetings 表的 SQLite 数据库文件。",
          "命令行执行 `cc hub sync-adapter meeting-tencent --profile-path <WeMeet目录>`；也可用 `--db-path <历史库.db>`。",
          "中台会合并本地新历史表和云历史缓存，以 `(meeting_id, period_id)` 去重；数据库变更会重放旧会议以补齐参会者或录制信息。",
        ],
        note: "不要选择或上传 authorizeinfo、login_history 等账号凭据库；适配器只读取历史会议表，并明确排除密码、token、会议链接与原始账号 UID。",
      },
    ],
  },
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
        steps: ["在手机 App 内完成邮箱采集，生成快照后同步到中台。"],
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

  "shopping-taobao": shoppingCookieGuide(
    "shopping-taobao",
    "淘宝",
    "淘宝 userId",
  ),
  "shopping-jd": shoppingCookieGuide("shopping-jd", "京东", "pt_pin / pin"),
  "shopping-meituan": shoppingCookieGuide(
    "shopping-meituan",
    "美团",
    "美团 userId",
  ),
  "shopping-eleme": shoppingCookieGuide(
    "shopping-eleme",
    "饿了么",
    "饿了么 userId",
  ),
  "shopping-pinduoduo": shoppingCookieGuide(
    "shopping-pinduoduo",
    "拼多多",
    "拼多多 uid",
  ),
  "shopping-dianping": shoppingCookieGuide(
    "shopping-dianping",
    "大众点评",
    "大众点评 userId",
  ),
  "shopping-xianyu": shoppingCookieGuide(
    "shopping-xianyu",
    "闲鱼",
    "闲鱼 userId",
  ),
  "shopping-vipshop": shoppingCookieGuide(
    "shopping-vipshop",
    "唯品会",
    "唯品会 userId",
  ),

  "doc-wps": {
    summary:
      "采集 WPS 云文档指定驱动盘和目录中的文件清单。稳定路径是导入 schemaVersion 1 快照；在线路径使用 WPS 365 OpenAPI 用户 OAuth 与 kso.file.read 只读权限。",
    methods: [
      {
        label: "导入 WPS 云文档快照（推荐）",
        recommended: true,
        steps: [
          "从已授权的移动端采集器或个人导出流程生成 schemaVersion 1 JSON，事件类型为 document。",
          "在数据中台选择 doc-wps 并导入快照；快照账号只用于隔离数据作用域。",
        ],
      },
      {
        label: "临时 OAuth 官方接口采集",
        steps: [
          "在 WPS 开放平台创建支持用户授权的应用，申请只读权限 kso.file.read，并按 OAuth 流程取得用户 access_token。",
          "确认需要采集的 drive_id；根目录 parent_id 为 0。把 access_token 保存到仅当前用户可读的临时文件。",
          "执行 `cc hub sync-adapter doc-wps --access-token-file <token.txt> --account-id <本地账号标识> --drive-id <drive_id> --parent-id 0`。",
          "若应用在开放平台开启了接口签名，再附加 `--app-id <APPID> --app-key-file <APPKEY文件>`；中台按官方 KSO-1 HMAC-SHA256 算法签名。",
          "中台通过 `openapi.wps.cn/v7/drives/{drive_id}/files/{parent_id}/children` 按 page_token 分页，并默认递归子文件夹；可用 `--page-size 500`、`--max-pages` 控制扫描，或用 `--shallow` 只采一层。",
        ],
        note: "access_token 与 APPKEY 只在本机本次调用中使用，不写入 adapter、账号库、原始事件、审计或水位；账号、drive 和 parent 只形成哈希作用域。接口错误、游标循环或未扫完时保留旧水位。",
      },
    ],
  },

  "doc-tencent-docs": {
    summary:
      "采集自己从腾讯文档导出的本地文件清单。个人版没有可核验的公开 OAuth 文件列表契约，因此不使用网页内部接口或登录 Cookie；企业开放 API 需按腾讯文档企业版合同单独集成。",
    methods: [
      {
        label: "扫描腾讯文档本地导出目录（推荐）",
        recommended: true,
        steps: [
          "在腾讯文档中把需要归档的文档导出到一个专用本地目录；支持 Word、Excel、PowerPoint、PDF、XMind、表单、文本和图片等常见导出格式。",
          "选择一个只用于本机水位隔离的稳定账号标识；账号原文不会入库。",
          "执行 `cc hub sync-adapter doc-tencent-docs --export-dir <导出目录> --account-id <本地账号标识>`。",
          "中台默认递归扫描子目录；可用 `--shallow` 只采直接子文件，或用 `--max-files <数量>` 限制单次检查规模。",
        ],
        note: "只保存相对路径、格式、大小和文件时间，不保存导出根目录的绝对路径；账号、根目录和递归方式只形成哈希作用域。符号链接会跳过，限额中断、文件错误或未扫完时保留旧水位。",
      },
      {
        label: "导入腾讯文档 schemaVersion 1 快照",
        steps: [
          "从已授权的采集器或个人导出流程生成 schemaVersion 1 JSON，事件类型为 document。",
          "在数据中台选择 doc-tencent-docs 并导入快照；快照账号只用于隔离数据作用域。",
        ],
        note: "腾讯文档企业版/私有化提供面向企业集成的开放 API，但个人 SaaS 文件列表没有已核验的通用公开契约；接入企业接口前需取得租户自己的接口文档、授权范围和测试账号。",
      },
    ],
  },

  "browser-history-firefox": {
    summary:
      "从 Firefox 本地 places.sqlite 采集浏览历史、下载记录和书签。无需扩展、账号或网络；下载目标绝对路径只保留文件名、扩展名和 SHA-256，带凭据或签名参数的下载 URL 会先净化。配置目录仅用于读取并转换成哈希作用域，不写入事件、审计或同步水位。",
    methods: [
      {
        label: "自动发现默认 Firefox 配置（推荐）",
        recommended: true,
        steps: [
          "确认 Firefox 已在本机打开并使用过至少一次。",
          "在数据中台刷新来源；若默认配置状态为「可采集」，直接点击采集。",
          "中台会复制 places.sqlite 及当前 WAL 为临时只读快照，解析浏览、下载和书签后立即清理临时副本。",
        ],
        note: "支持 Windows 普通安装和 Microsoft Store、macOS、Linux、Snap 与 Flatpak 的常见配置根目录；全程本地处理。",
      },
      {
        label: "选择其他 Firefox 配置目录",
        steps: [
          "在 Firefox 地址栏打开 `about:profiles`，找到目标配置的「根目录」。",
          "在数据中台点击「选择配置目录」，选择包含 places.sqlite 的目录。",
          "命令行可执行 `cc hub sync-adapter browser-history-firefox --profile-path <配置目录>`；也可用 `--input <places.sqlite>` 做一次完整导入。",
        ],
        note: "多个配置使用各自的哈希作用域和稳定实体 ID，不会共享增量水位；配置路径和下载目标绝对路径不会写入个人数据中台。",
      },
    ],
  },

  "doc-baidu-netdisk": {
    summary:
      "采集自己百度网盘开放应用沙箱中的文件树。稳定路径是导入 schemaVersion 1 快照；在线路径使用百度网盘开放平台官方 OAuth 文件列表接口，access_token 只用于本次同步。",
    methods: [
      {
        label: "导入百度网盘快照（推荐）",
        recommended: true,
        steps: [
          "从已授权的移动端采集器或个人导出流程生成 schemaVersion 1 JSON，事件类型为 document。",
          "在数据中台选择 doc-baidu-netdisk 并导入快照；快照账号只用于隔离数据作用域。",
        ],
      },
      {
        label: "临时 OAuth 官方接口采集",
        steps: [
          "在百度网盘开放平台创建应用，并按 OAuth 授权流程取得具有网盘权限的 access_token。",
          "官方接口仅允许访问 `/apps/{appname}` 应用沙箱；确认应用目录，把 access_token 保存到仅当前用户可读的临时文本文件，并选择稳定的本地账号标识。",
          "执行 `cc hub sync-adapter doc-baidu-netdisk --access-token-file <token.txt> --account-id <本地账号标识> --dir /apps/<appname>`。",
          "中台默认通过 `pan.baidu.com/rest/2.0/xpan/multimedia?method=listall` 递归文件树，并按 `has_more/cursor` 分页；可用 `--page-size 1000` 和 `--max-pages` 控制扫描。",
          "如只需目标目录的直接子项，可附加 `--shallow`，此时改用官方 `xpan/file?method=list` 的 start/limit 分页。",
        ],
        note: "百度官方接口要求 access_token 位于 HTTPS URL 参数中；中台仅在发起请求时组装该参数，不把 token、原始账号标识或完整请求 URL 写入账号库、原始事件、审计和水位。递归游标循环、接口错误或未扫完时保留旧水位。",
      },
    ],
  },

  "social-zhihu": {
    summary:
      "采集自己发布的知乎回答、关注账号和收藏夹。稳定路径是导入 schemaVersion 1 快照；也可用单次临时 Cookie 调用知乎 JSON 接口，凭据不会写入账号库。",
    methods: [
      {
        label: "导入知乎数据快照（推荐）",
        recommended: true,
        steps: [
          "从已授权的浏览器扩展、移动端采集器或个人导出流程生成 schemaVersion 1 JSON，包含 answer、follow、favourite 事件。",
          "在数据中台选择 social-zhihu 并导入该快照；快照中的账号标识只用于隔离数据作用域。",
        ],
      },
      {
        label: "临时 Cookie 接口采集",
        steps: [
          "在浏览器登录知乎，复制 www.zhihu.com 会话 Cookie，并保存到仅当前用户可读的文本文件。",
          "从个人主页 `/people/<url_token>` 取得自己的 url_token；该值必须作为 `--account-id`，中台只持久化其哈希作用域。",
          "执行 `cc hub sync-adapter social-zhihu --cookie-file <cookie.txt> --account-id <url_token>`。",
          "中台以受限 HTTPS GET 分页读取回答、关注和收藏夹；HTTP 鉴权、反爬、非 JSON 或未知响应都会明确失败或保留旧水位。",
        ],
        note: "部分知乎接口会要求轮换的 x-zse-96。命令行路径不会伪造签名；若当前会话仍被拒绝，请改用快照采集。Cookie 与原始 url_token 均不持久化。",
      },
    ],
  },

  "travel-12306": {
    summary:
      "采集 12306 已完成与待支付车票。稳定路径是 Android 采集快照或兼容 JSON；也可用单次临时 Cookie 从官方订单接口直采，Cookie 不写入账号库。",
    methods: [
      {
        label: "手机或快照文件采集（稳定路径）",
        recommended: true,
        steps: [
          "在已提供 12306 采集器的 Android 客户端生成 schemaVersion 1 车票快照，或准备已有兼容 JSON。",
          "在中台导入快照；采集器生成的临时文件会按其同步流程进入中台并清理。",
        ],
      },
      {
        label: "临时 Cookie 官方接口直采",
        steps: [
          "在浏览器登录 12306，从 kyfw.12306.cn 会话复制当前 Cookie，并保存到仅当前用户可读的文本文件。",
          "选择一个稳定的本地账号标识；它只会规范化并哈希为水位作用域。",
          "执行 `cc hub sync-adapter travel-12306 --cookie-file <cookie.txt> --account-id <本地账号标识>`。",
          "中台以受限 HTTPS 表单 POST 拉取已完成和待支付订单；HTTP、登录页、非 JSON 或超时会明确失败并保留旧水位。",
        ],
        note: "12306 Cookie 通常会过期，直采默认最多查询最近 90 天；凭据只用于本次命令，不持久化。",
      },
    ],
  },

  wechat: {
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
          '回到中台执行 `cc hub sync-adapter qq-pc --passphrase "<那串密钥>"`（或点该行「一键采集」并粘贴密钥）。',
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

  "social-bilibili": socialAdbGuide(
    "哔哩哔哩",
    "观看历史 / 收藏 / 动态 / 关注",
  ),
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

  weread: {
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

  "messaging-whatsapp": {
    summary:
      "导入 WhatsApp Android 本地聊天备份。支持明文 msgstore.db，也支持使用你自己的备份密钥直接解密 crypt14 / crypt15；密钥和聊天数据全程留在本机。",
    methods: [
      {
        label: "Android 自动拉取 crypt15 + 64 位备份密钥（推荐）",
        recommended: true,
        steps: [
          "WhatsApp → 设置 → 聊天 → 聊天备份 → 端到端加密备份，选择使用 64 位加密密钥并妥善保存。",
          "打开 Android 的 USB 调试并连接电脑；中台会从 Android/media/com.whatsapp/WhatsApp/Databases/ 自动拉取 msgstore.db.crypt15，无需 root。也可以手动选择该文件。",
          "采集时填写 64 个十六进制字符的备份密钥；中台会在本地认证解密、入库，并立即删除 ADB 拉取副本和临时明文数据库。",
          "CLI 可执行 cc hub sync-adapter messaging-whatsapp --key <密钥文件路径>；密钥文件可只包含 64 位十六进制密钥，避免把密钥留在 shell 历史中。",
        ],
        note: "仅支持用户主动提供自己的备份文件和密钥，不获取、不猜测也不上传密钥。",
      },
      {
        label: "crypt14 + rooted 设备 key 文件",
        steps: [
          "从你自己的 rooted Android 设备复制 /data/data/com.whatsapp/files/key。",
          "同时复制 WhatsApp/Databases/msgstore.db.crypt14。",
          "采集时选择 crypt14 和 key 文件；中台本地解密后直接读取聊天、联系人、会话和通话记录。",
        ],
      },
      {
        label: "已解密的 msgstore.db",
        steps: [
          "如果已有明文 msgstore.db，直接选择该文件采集，无需再提供密钥。",
        ],
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
  const base =
    CATEGORY_GUIDES[cat] || CATEGORY_GUIDES[READINESS_CATEGORY.LOCAL];
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
  if (ADAPTER_OVERRIDES[name] && name === "wechat")
    return READINESS_CATEGORY.DEVICE;
  if (
    /^(email-imap|finance-alipay|alipay-bill|ai-chat-history|weread|doc-wps|doc-baidu-netdisk|doc-camscanner|recruit-boss|social-csdn|social-douban|social-dongchedi|biz-tianyancha|gov-ixiamen|health-meiyou|gov-tax|bank-cmbc|bank-boc|bank-bankcomm|finance-dcep|gov-12123|bank-icbc)$/.test(
      name,
    )
  )
    return READINESS_CATEGORY.CREDENTIAL;
  if (
    /^(messaging-(telegram|whatsapp)|wechat|wechat-pc|messaging-qq|qq-pc|dingtalk-pc|feishu-pc|wework-pc|travel-amap)$/.test(
      name,
    )
  )
    return READINESS_CATEGORY.DEVICE;
  if (
    /^(browser-history-|meeting-tencent|vscode|vscodium|cursor|claude-code|jetbrains-ide|hbuilderx|win-recent|git-activity|shell-history|local-files|apple-health|doc-tencent-docs)/.test(
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
