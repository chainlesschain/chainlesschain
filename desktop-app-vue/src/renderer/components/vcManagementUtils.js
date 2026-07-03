/**
 * Pure helpers extracted from VCManagement.vue (opportunistic split).
 * Credential type/status name+color, DID shortening, and date/JSON formatting.
 * No reactive state — unit-testable in isolation.
 */

// 凭证类型名称
export function getTypeName(type) {
  const names = {
    SelfDeclaration: "自我声明",
    SkillCertificate: "技能证书",
    TrustEndorsement: "信任背书",
    EducationCredential: "教育凭证",
    WorkExperience: "工作经历",
  };
  return names[type] || type;
}

// 状态标签
export function getStatusLabel(status) {
  const labels = {
    active: "有效",
    revoked: "已撤销",
    expired: "已过期",
  };
  return labels[status] || status;
}

// 状态颜色
export function getStatusColor(status) {
  const colors = {
    active: "success",
    revoked: "error",
    expired: "default",
  };
  return colors[status] || "default";
}

// 缩短 DID（保留 method + 前 8 / 后 6 位标识）
export function shortenDID(did) {
  if (!did) {
    return "";
  }
  const parts = did.split(":");
  if (parts.length === 3) {
    const identifier = parts[2];
    return `did:${parts[1]}:${identifier.substring(0, 8)}...${identifier.substring(
      identifier.length - 6,
    )}`;
  }
  return did;
}

// 格式化日期
export function formatDate(timestamp) {
  if (!timestamp) {
    return "未知";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

// 美化 JSON（解析失败原样返回）
export function formatJSON(jsonString) {
  try {
    return JSON.stringify(JSON.parse(jsonString), null, 2);
  } catch {
    return jsonString;
  }
}
