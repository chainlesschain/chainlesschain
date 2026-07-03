/**
 * Pure helpers extracted from EmailReader.vue (opportunistic split).
 * Relative/absolute time + size formatting. Self-contained: extends dayjs with
 * the relativeTime plugin and the zh-cn locale on load (idempotent singleton),
 * so callers no longer wire dayjs themselves.
 */
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

export const formatFullTime = (timestamp) => {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
};

export const formatSize = (bytes) => {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
};
