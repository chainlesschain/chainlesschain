/**
 * Pure helpers extracted from ConversationSearchPanel.vue (opportunistic split).
 * Match scoring, XSS-safe highlight, message category + role/type label/color,
 * and relative time formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: this module now owns the MessageType + escapeHtml deps (they were only
 * used by the moved helpers). handleSearch / filteredResults / highlightText's
 * callers stay in the SFC (they read the reactive search refs).
 */
// NOTE: the original SFC imported this from "../../../types/messageTypes",
// which resolves to a non-existent src/types/messageTypes (a latent bug hidden
// only because the component is currently unwired). The enum actually lives at
// src/renderer/utils/messageTypes — corrected here so getMessageCategory works.
import { MessageType } from "@/utils/messageTypes";
import { escapeHtml } from "@/utils/sanitizeHtml";

export const calculateMatchScore = (content, query) => {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // 完全匹配得分最高
  if (lowerContent === lowerQuery) {
    return 100;
  }

  // 开头匹配得分较高
  if (lowerContent.startsWith(lowerQuery)) {
    return 80;
  }

  // 单词匹配
  const words = lowerContent.split(/\s+/);
  if (words.includes(lowerQuery)) {
    return 60;
  }

  // 包含匹配
  const index = lowerContent.indexOf(lowerQuery);
  if (index === 0) {
    return 50;
  }
  if (index > 0) {
    return 30;
  }

  return 10;
};

// 转义正则表达式特殊字符
export const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// 高亮显示匹配文本 — escape text 防 XSS，escape query 防 regex 注入
export const highlightText = (text, query) => {
  if (!text) {
    return "";
  }
  const safeText = escapeHtml(text);
  if (!query) {
    return safeText;
  }
  const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
  return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
};

export const getMessageCategory = (type) => {
  if (type === MessageType.TASK_PLAN) {
    return "task";
  }
  if (type === MessageType.INTERVIEW) {
    return "interview";
  }
  if (
    type === MessageType.INTENT_CONFIRMATION ||
    type === MessageType.INTENT_RECOGNITION
  ) {
    return "intent";
  }
  return "normal";
};

export const getRoleName = (role) => {
  const roleNames = {
    user: "用户",
    assistant: "AI助手",
    system: "系统",
  };
  return roleNames[role] || role;
};

export const getTypeName = (type) => {
  const typeNames = {
    task: "任务计划",
    interview: "采访",
    intent: "意图识别",
    normal: "普通对话",
  };
  return typeNames[type] || type;
};

export const getTypeColor = (type) => {
  const typeColors = {
    task: "blue",
    interview: "green",
    intent: "purple",
    normal: "default",
  };
  return typeColors[type] || "default";
};

export const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 今天
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 本周
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return (
      days[date.getDay()] +
      " " +
      date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    );
  }

  // 更早
  return (
    date.toLocaleDateString("zh-CN") +
    " " +
    date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  );
};
