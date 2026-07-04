/**
 * Pure helpers extracted from KnowledgeVersionHistory.vue (opportunistic split).
 * DID display-name shortening, hash/CID shortening, content preview stripping,
 * and date formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: getVersionColor / getVersionIcon stay in the SFC — getVersionIcon
 * returns ant icon *components*, and getVersionColor's sibling keeps them
 * together. copyToClipboard stays (touches navigator + message).
 */

export function getUserName(did) {
  if (!did) {
    return "未知";
  }
  // 缩短DID显示
  if (did.length > 20) {
    return `${did.slice(0, 10)}...${did.slice(-6)}`;
  }
  return did;
}

export function shortenHash(hash) {
  if (!hash) {
    return "";
  }
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

export function shortenCID(cid) {
  if (!cid) {
    return "";
  }
  return cid.length > 20 ? `${cid.slice(0, 10)}...${cid.slice(-10)}` : cid;
}

export function getContentPreview(content) {
  if (!content) {
    return "暂无内容";
  }
  const text = content.replace(/<[^>]*>/g, "").trim();
  return text.length > 200 ? text.substring(0, 200) + "..." : text;
}

export function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
