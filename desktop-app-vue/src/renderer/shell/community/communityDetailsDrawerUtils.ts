/**
 * Pure helpers extracted from CommunityDetailsDrawer.vue (opportunistic split).
 * Role / status / channel-type label+color maps, DID shortening, and time
 * formatting. No reactive state — unit-testable in isolation.
 */

export const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "geekblue",
  moderator: "blue",
  member: "green",
};
export const ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  moderator: "版主",
  member: "成员",
};
export function roleColor(role?: string): string {
  if (!role) {
    return "default";
  }
  return ROLE_COLORS[role] || "default";
}
export function roleLabel(role?: string): string {
  if (!role) {
    return "";
  }
  return ROLE_LABELS[role] || role;
}

export const STATUS_COLORS: Record<string, string> = {
  active: "green",
  archived: "orange",
  banned: "red",
};
export function statusColor(status?: string): string {
  if (!status) {
    return "default";
  }
  return STATUS_COLORS[status] || "default";
}
export function statusLabel(status?: string): string {
  if (status === "active") {
    return "活跃";
  }
  if (status === "archived") {
    return "已归档";
  }
  if (status === "banned") {
    return "已封禁";
  }
  return status ?? "—";
}

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  announcement: "公告",
  discussion: "讨论",
  readonly: "只读",
  subscription: "订阅",
};
export const CHANNEL_TYPE_COLORS: Record<string, string> = {
  announcement: "red",
  discussion: "blue",
  readonly: "default",
  subscription: "purple",
};
export function channelTypeLabel(type?: string): string {
  if (!type) {
    return "—";
  }
  return CHANNEL_TYPE_LABELS[type] || type;
}
export function channelTypeColor(type?: string): string {
  if (!type) {
    return "default";
  }
  return CHANNEL_TYPE_COLORS[type] || "default";
}

export function shortDid(did?: string): string {
  if (!did) {
    return "—";
  }
  if (did.length <= 24) {
    return did;
  }
  return `${did.slice(0, 16)}…${did.slice(-6)}`;
}

export function formatTime(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleString("zh-CN");
}
