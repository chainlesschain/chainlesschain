/**
 * Pure helpers extracted from RecordingTimeline.vue (opportunistic split).
 * Event color (static map), mm:ss(.cs) time + duration formatting, and string
 * truncation. No reactive state — unit-testable in isolation.
 *
 * NOTE: getTickInterval / getEventPosition read reactive duration/zoom/events
 * refs; getEventIcon returns ant icon components; getEventTooltip stays in the
 * SFC (it calls the imported truncate). All stay in the SFC.
 */

export const getEventColor = (type) => {
  const colors = {
    click: "green",
    type: "blue",
    input: "blue",
    navigate: "purple",
    scroll: "orange",
    key: "cyan",
    hover: "default",
  };
  return colors[type] || "default";
};

export const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
};

export const formatDuration = (ms) => {
  if (!ms) {
    return "0:00";
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export const truncate = (str, maxLen) => {
  if (!str) {
    return "";
  }
  return str.length > maxLen ? str.substring(0, maxLen) + "..." : str;
};
