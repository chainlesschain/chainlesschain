/**
 * Friends panel helpers — pure functions extracted for unit testing.
 * Used by `shell/FriendsPanel.vue`.
 *
 * Online status comes from the social store's `onlineStatus: Map<did, status>`
 * which always wins over `friend.onlineStatus` (object or string), so callers
 * pass the live Map and we resolve effective status here.
 */

export type OnlineStatus = "online" | "offline" | "away";

export interface FriendLike {
  friend_did: string;
  nickname?: string;
  avatar?: string;
  group_name?: string;
  notes?: string;
  onlineStatus?: { status?: OnlineStatus } | OnlineStatus | string;
  [key: string]: unknown;
}

/**
 * Truncate a DID to "first10…last10" so list rows stay legible.
 * Returns the original string when shorter than 20 chars.
 */
export function formatDID(did: string | undefined | null): string {
  if (!did) {
    return "";
  }
  if (did.length <= 20) {
    return did;
  }
  return `${did.slice(0, 10)}…${did.slice(-10)}`;
}

/**
 * Effective online status: store Map wins, then friend.onlineStatus
 * (which can be a string or an object with a `.status` field), then
 * "offline" as fallback so the badge always renders.
 */
export function resolveFriendStatus(
  friend: FriendLike,
  onlineStatusMap?: Map<string, OnlineStatus> | null,
): OnlineStatus {
  const fromMap = onlineStatusMap?.get(friend.friend_did);
  if (fromMap) {
    return fromMap;
  }
  const raw = friend.onlineStatus;
  if (raw && typeof raw === "object" && "status" in raw) {
    const s = (raw as { status?: string }).status;
    if (s === "online" || s === "offline" || s === "away") {
      return s;
    }
  }
  if (raw === "online" || raw === "offline" || raw === "away") {
    return raw;
  }
  return "offline";
}

/**
 * Distinct group names extracted from `friend.group_name`. Used to
 * render dynamic group tabs alongside the fixed "全部 / 在线" tabs.
 */
export function getFriendGroups(friends: FriendLike[]): string[] {
  const set = new Set<string>();
  for (const f of friends) {
    if (typeof f.group_name === "string" && f.group_name.trim()) {
      set.add(f.group_name);
    }
  }
  return Array.from(set);
}

/**
 * Count online friends. Mirrors the social store's `onlineFriends` getter
 * but also accepts an explicit Map so the panel can pass `store.onlineStatus`.
 */
export function countOnlineFriends(
  friends: FriendLike[],
  onlineStatusMap?: Map<string, OnlineStatus> | null,
): number {
  let n = 0;
  for (const f of friends) {
    if (resolveFriendStatus(f, onlineStatusMap) === "online") {
      n += 1;
    }
  }
  return n;
}

/**
 * Filter friends by tab key. Special keys:
 *  - "all"    → all friends
 *  - "online" → only online
 * Any other key is treated as a group name; matches `friend.group_name`.
 */
export function filterFriendsByGroup(
  friends: FriendLike[],
  groupKey: string,
  onlineStatusMap?: Map<string, OnlineStatus> | null,
): FriendLike[] {
  if (groupKey === "all") {
    return friends;
  }
  if (groupKey === "online") {
    return friends.filter(
      (f) => resolveFriendStatus(f, onlineStatusMap) === "online",
    );
  }
  return friends.filter((f) => f.group_name === groupKey);
}

/**
 * Case-insensitive substring search across nickname / did / notes.
 * Returns the input unchanged when the query is empty.
 */
export function matchFriendKeyword(
  friends: FriendLike[],
  keyword: string,
): FriendLike[] {
  const q = keyword?.trim().toLowerCase();
  if (!q) {
    return friends;
  }
  return friends.filter((f) => {
    const nickname = f.nickname?.toLowerCase() ?? "";
    const did = f.friend_did?.toLowerCase() ?? "";
    const notes = (typeof f.notes === "string" ? f.notes : "").toLowerCase();
    return nickname.includes(q) || did.includes(q) || notes.includes(q);
  });
}

/**
 * Chinese label for the online-status badge.
 */
export function friendStatusLabel(status: OnlineStatus | undefined): string {
  switch (status) {
    case "online":
      return "在线";
    case "away":
      return "离开";
    default:
      return "离线";
  }
}

/**
 * Color hint for the badge (matches Ant Design Vue's tag colors).
 */
export function friendStatusColor(status: OnlineStatus | undefined): string {
  switch (status) {
    case "online":
      return "green";
    case "away":
      return "orange";
    default:
      return "default";
  }
}
