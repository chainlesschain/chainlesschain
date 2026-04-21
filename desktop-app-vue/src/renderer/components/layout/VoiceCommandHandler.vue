<template>
  <div class="voice-feedback-container">
    <VoiceFeedbackWidget
      :show-panel="true"
      :enable-command-hints="true"
      @result="handleVoiceResult"
      @error="handleVoiceError"
      @command="handleVoiceCommand"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { logger } from "@/utils/logger";
import VoiceFeedbackWidget from "../VoiceFeedbackWidget.vue";
import { useAppStore } from "../../stores/app";
import { useSocialStore } from "../../stores/social";

const emit = defineEmits(["show-command-palette"]);

const router = useRouter();
const store = useAppStore();
const socialStore = useSocialStore();

const chatPanelVisible = computed({
  get: () => store.chatPanelVisible,
  set: (val) => store.setChatPanelVisible(val),
});

const sidebarCollapsed = computed({
  get: () => store.sidebarCollapsed,
  set: (val) => store.setSidebarCollapsed(val),
});

const voiceCommands = [
  {
    patterns: ["打开聊天", "开启聊天", "显示聊天", "聊天面板"],
    type: "open-chat",
  },
  { patterns: ["关闭聊天", "隐藏聊天", "收起聊天"], type: "close-chat" },

  {
    patterns: ["返回首页", "回到首页", "去首页", "主页", "知识首页"],
    type: "navigate",
    path: "/",
  },
  {
    patterns: ["我的项目", "打开项目", "项目列表"],
    type: "navigate",
    path: "/projects",
  },
  {
    patterns: ["我的知识", "知识列表", "打开知识", "笔记列表"],
    type: "navigate",
    path: "/knowledge/list",
  },
  {
    patterns: ["AI对话", "打开AI", "人工智能对话", "智能对话"],
    type: "navigate",
    path: "/ai/chat",
  },
  {
    patterns: ["工作区管理", "工作区", "管理工作区"],
    type: "navigate",
    path: "/projects/workspace",
  },

  {
    patterns: ["知识图谱", "打开图谱", "图谱"],
    type: "navigate",
    path: "/knowledge/graph",
  },
  {
    patterns: ["文件导入", "导入文件", "上传文件"],
    type: "navigate",
    path: "/file-import",
  },
  {
    patterns: ["图片上传", "上传图片", "导入图片"],
    type: "navigate",
    path: "/image-upload",
  },
  {
    patterns: ["提示词模板", "提示词", "模板管理"],
    type: "navigate",
    path: "/prompt-templates",
  },
  {
    patterns: ["知识付费", "付费知识", "知识商店"],
    type: "navigate",
    path: "/knowledge-store",
  },

  {
    patterns: ["音频导入", "导入音频", "语音导入", "上传音频"],
    type: "navigate",
    path: "/audio/import",
  },
  {
    patterns: ["多媒体处理", "多媒体", "视频处理"],
    type: "navigate",
    path: "/multimedia/demo",
  },
  {
    patterns: ["我的购买", "已购买", "购买记录"],
    type: "navigate",
    path: "/my-purchases",
  },

  {
    patterns: ["项目分类", "分类管理", "打开分类"],
    type: "navigate",
    path: "/projects/categories",
  },
  {
    patterns: ["项目列表管理", "管理项目列表"],
    type: "navigate",
    path: "/projects/management",
  },
  {
    patterns: ["模板管理", "项目模板"],
    type: "navigate",
    path: "/template-management",
  },
  {
    patterns: ["项目市场", "市场项目", "项目商城"],
    type: "navigate",
    path: "/projects/market",
  },
  {
    patterns: ["协作项目", "项目协作", "团队项目"],
    type: "navigate",
    path: "/projects/collaboration",
  },
  {
    patterns: ["已归档项目", "归档项目", "项目归档"],
    type: "navigate",
    path: "/projects/archived",
  },

  {
    patterns: ["DID身份", "打开DID", "身份管理", "去DID"],
    type: "navigate",
    path: "/did",
  },
  {
    patterns: ["可验证凭证", "凭证管理", "验证凭证"],
    type: "navigate",
    path: "/credentials",
  },
  {
    patterns: ["联系人", "打开联系人", "通讯录"],
    type: "navigate",
    path: "/contacts",
  },
  {
    patterns: ["好友管理", "我的好友", "好友列表", "打开好友"],
    type: "navigate",
    path: "/friends",
  },
  {
    patterns: ["动态广场", "社交动态", "朋友圈", "打开动态"],
    type: "navigate",
    path: "/posts",
  },
  {
    patterns: ["P2P消息", "加密消息", "P2P加密消息", "私聊"],
    type: "navigate",
    path: "/p2p-messaging",
  },
  {
    patterns: ["离线消息", "离线队列", "消息队列"],
    type: "navigate",
    path: "/offline-queue",
  },

  {
    patterns: ["交易中心", "打开交易", "去交易"],
    type: "navigate",
    path: "/trading",
  },
  {
    patterns: ["交易市场", "市场", "打开市场"],
    type: "navigate",
    path: "/marketplace",
  },
  {
    patterns: ["智能合约", "合约管理", "打开合约"],
    type: "navigate",
    path: "/contracts",
  },
  {
    patterns: ["信用评分", "我的信用", "信用分数"],
    type: "navigate",
    path: "/credit-score",
  },
  {
    patterns: ["钱包管理", "打开钱包", "我的钱包", "去钱包"],
    type: "navigate",
    path: "/wallet",
  },
  {
    patterns: ["跨链桥", "资产桥", "打开桥"],
    type: "navigate",
    path: "/bridge",
  },

  {
    patterns: ["Web IDE", "打开IDE", "代码编辑器", "去IDE"],
    type: "navigate",
    path: "/webide",
  },
  {
    patterns: ["设计编辑器", "打开设计", "设计工具"],
    type: "navigate",
    path: "/design/new",
  },
  {
    patterns: ["RSS订阅", "打开RSS", "订阅管理"],
    type: "navigate",
    path: "/rss/feeds",
  },
  {
    patterns: ["邮件管理", "打开邮件", "邮箱", "去邮件"],
    type: "navigate",
    path: "/email/accounts",
  },

  {
    patterns: ["组织管理", "打开组织", "企业管理"],
    type: "navigate",
    path: "/organizations",
  },
  {
    patterns: ["企业仪表板", "企业面板", "企业统计"],
    type: "navigate",
    path: "/enterprise/dashboard",
  },
  {
    patterns: ["权限管理", "打开权限", "权限设置"],
    type: "navigate",
    path: "/permissions",
  },

  {
    patterns: ["系统配置", "系统设置", "打开配置"],
    type: "navigate",
    path: "/settings/system",
  },
  {
    patterns: ["通用设置", "打开设置", "去设置", "设置页面"],
    type: "navigate",
    path: "/settings",
  },
  {
    patterns: ["插件管理", "打开插件", "管理插件"],
    type: "navigate",
    path: "/settings/plugins",
  },
  {
    patterns: ["插件市场", "插件商店", "安装插件"],
    type: "navigate",
    path: "/plugins/marketplace",
  },
  {
    patterns: ["插件发布", "发布插件", "上传插件"],
    type: "navigate",
    path: "/plugins/publisher",
  },
  {
    patterns: ["技能管理", "打开技能", "AI技能"],
    type: "navigate",
    path: "/settings/skills",
  },
  {
    patterns: ["工具管理", "打开工具", "AI工具管理"],
    type: "navigate",
    path: "/settings/tools",
  },
  {
    patterns: ["LLM配置", "大模型配置", "AI模型设置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "llm" },
  },
  {
    patterns: ["RAG配置", "知识检索配置", "向量配置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "rag" },
  },
  {
    patterns: ["Git同步", "同步设置", "Git配置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "git" },
  },
  {
    patterns: ["同步冲突", "冲突管理", "解决冲突"],
    type: "navigate",
    path: "/sync/conflicts",
  },
  {
    patterns: ["UKey安全", "硬件密钥", "安全设置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "ukey" },
  },
  {
    patterns: ["数据库性能", "数据库监控", "性能监控"],
    type: "navigate",
    path: "/database/performance",
  },

  { patterns: ["全局搜索", "搜索一下", "搜索", "查找"], type: "global-search" },
  {
    patterns: ["新建笔记", "创建笔记", "写笔记", "添加笔记"],
    type: "new-note",
  },
  { patterns: ["刷新页面", "刷新", "重新加载"], type: "refresh" },
  { patterns: ["返回", "后退", "上一页"], type: "go-back" },
  { patterns: ["前进", "下一页"], type: "go-forward" },
  { patterns: ["关闭标签", "关闭页面"], type: "close-tab" },
  {
    patterns: ["打开通知", "通知中心", "查看通知"],
    type: "open-notifications",
  },
  {
    patterns: ["折叠侧边栏", "收起菜单", "隐藏菜单"],
    type: "collapse-sidebar",
  },
  { patterns: ["展开侧边栏", "显示菜单", "打开菜单"], type: "expand-sidebar" },

  {
    patterns: ["保存", "保存文件", "Ctrl S"],
    type: "shortcut",
    key: "s",
    ctrl: true,
  },
  {
    patterns: ["复制", "复制内容", "Ctrl C"],
    type: "shortcut",
    key: "c",
    ctrl: true,
  },
  {
    patterns: ["粘贴", "粘贴内容", "Ctrl V"],
    type: "shortcut",
    key: "v",
    ctrl: true,
  },
  {
    patterns: ["剪切", "剪切内容", "Ctrl X"],
    type: "shortcut",
    key: "x",
    ctrl: true,
  },
  {
    patterns: ["撤销", "撤回", "Ctrl Z"],
    type: "shortcut",
    key: "z",
    ctrl: true,
  },
  {
    patterns: ["重做", "恢复", "Ctrl Y"],
    type: "shortcut",
    key: "y",
    ctrl: true,
  },
  {
    patterns: ["全选", "选择全部", "Ctrl A"],
    type: "shortcut",
    key: "a",
    ctrl: true,
  },
  {
    patterns: ["新建", "新建文件", "Ctrl N"],
    type: "shortcut",
    key: "n",
    ctrl: true,
  },
  {
    patterns: ["打印", "打印页面", "Ctrl P"],
    type: "shortcut",
    key: "p",
    ctrl: true,
  },
];

function parseVoiceCommand(text) {
  if (!text) {
    return null;
  }
  const lowerText = text.toLowerCase();

  for (const cmd of voiceCommands) {
    for (const pattern of cmd.patterns) {
      if (lowerText.includes(pattern)) {
        return { ...cmd, originalText: text };
      }
    }
  }
  return null;
}

function insertTextAtCursor(element, text) {
  if (element.isContentEditable) {
    document.execCommand("insertText", false, text);
  } else {
    const start = element.selectionStart || 0;
    const end = element.selectionEnd || 0;
    const value = element.value || "";
    element.value = value.substring(0, start) + text + value.substring(end);
    element.selectionStart = element.selectionEnd = start + text.length;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function simulateKeyboardShortcut(command) {
  const event = new KeyboardEvent("keydown", {
    key: command.key,
    ctrlKey: command.ctrl || false,
    shiftKey: command.shift || false,
    altKey: command.alt || false,
    metaKey: command.meta || false,
    bubbles: true,
  });

  const target = document.activeElement || document;
  target.dispatchEvent(event);

  const modifiers = [];
  if (command.ctrl) {
    modifiers.push("Ctrl");
  }
  if (command.shift) {
    modifiers.push("Shift");
  }
  if (command.alt) {
    modifiers.push("Alt");
  }
  modifiers.push(command.key.toUpperCase());

  message.success(`已执行快捷键: ${modifiers.join("+")}`);
}

function executeVoiceCommand(command) {
  logger.info("[VoiceCommandHandler] 执行语音命令:", command);

  switch (command.type) {
    case "open-chat":
      chatPanelVisible.value = true;
      message.success("已打开聊天面板");
      break;
    case "close-chat":
      chatPanelVisible.value = false;
      message.success("已关闭聊天面板");
      break;

    case "navigate":
      if (command.query) {
        router.push({ path: command.path, query: command.query });
      } else {
        router.push(command.path);
      }
      message.success("正在跳转...");
      break;

    case "global-search":
      emit("show-command-palette");
      message.success("已打开搜索");
      break;
    case "new-note":
      router.push("/knowledge/new");
      message.success("正在创建新笔记...");
      break;
    case "refresh":
      window.location.reload();
      break;
    case "go-back":
      router.back();
      message.success("后退");
      break;
    case "go-forward":
      router.forward();
      message.success("前进");
      break;
    case "close-tab":
      if (store.activeTabKey && store.activeTabKey !== "home") {
        store.removeTab(store.activeTabKey);
        message.success("已关闭标签页");
      } else {
        message.warning("无法关闭首页标签");
      }
      break;
    case "open-notifications":
      socialStore.toggleNotificationPanel(true);
      message.success("已打开通知中心");
      break;
    case "collapse-sidebar":
      sidebarCollapsed.value = true;
      message.success("已折叠侧边栏");
      break;
    case "expand-sidebar":
      sidebarCollapsed.value = false;
      message.success("已展开侧边栏");
      break;

    case "shortcut":
      simulateKeyboardShortcut(command);
      break;

    default:
      message.info(`未知命令: ${command.originalText}`);
  }
}

function handleVoiceResult(result) {
  logger.info("[VoiceCommandHandler] 语音识别结果:", result);

  const text = result.text?.trim();
  if (!text) {
    message.warning("未识别到有效语音内容");
    return;
  }

  const command = parseVoiceCommand(text);
  if (command) {
    executeVoiceCommand(command);
    return;
  }

  if (chatPanelVisible.value) {
    window.dispatchEvent(
      new CustomEvent("voice-input", {
        detail: { text },
      }),
    );
    message.success("语音已发送到聊天");
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable)
  ) {
    insertTextAtCursor(activeElement, text);
    message.success("语音已插入到输入框");
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    message.success(
      `已复制: "${text.substring(0, 20)}${text.length > 20 ? "..." : ""}"`,
    );
  });
}

function handleVoiceError(error) {
  logger.error("[VoiceCommandHandler] 语音识别错误:", error);
  message.error("语音识别失败: " + error.message);
}

function handleVoiceCommand(command) {
  logger.info("[VoiceCommandHandler] 收到语音命令:", command);
  executeVoiceCommand(command);
}
</script>

<style scoped>
.voice-feedback-container {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1000;
  transition: right 0.3s;
}
</style>
