/**
 * friendsHelpers — pure-function unit tests
 *
 * Covers:
 *  - formatDID truncation rule
 *  - resolveFriendStatus precedence: Map > friend.onlineStatus (object/string) > offline
 *  - getFriendGroups dedups + skips blank names
 *  - countOnlineFriends agrees with resolveFriendStatus on the same Map
 *  - filterFriendsByGroup: "all" / "online" / custom group name
 *  - matchFriendKeyword: nickname / did / notes, case-insensitive, empty query passthrough
 *  - friendStatusLabel + friendStatusColor for all 3 states + undefined
 */

import { describe, it, expect } from "vitest";
import {
  countOnlineFriends,
  filterFriendsByGroup,
  formatDID,
  friendStatusColor,
  friendStatusLabel,
  getFriendGroups,
  matchFriendKeyword,
  resolveFriendStatus,
  type FriendLike,
  type OnlineStatus,
} from "../friendsHelpers";

const f = (overrides: Partial<FriendLike>): FriendLike => ({
  friend_did: "did:cc:default",
  ...overrides,
});

describe("formatDID", () => {
  it("returns empty string for empty / null / undefined", () => {
    expect(formatDID("")).toBe("");
    expect(formatDID(null)).toBe("");
    expect(formatDID(undefined)).toBe("");
  });

  it("returns input unchanged when 20 chars or fewer", () => {
    expect(formatDID("did:cc:short")).toBe("did:cc:short");
    expect(formatDID("a".repeat(20))).toBe("a".repeat(20));
  });

  it("truncates with first10…last10 for longer DIDs", () => {
    const long = "did:cc:1234567890abcdefghijklmno";
    const result = formatDID(long);
    expect(result).toContain("…");
    expect(result.split("…")[0]).toHaveLength(10);
    expect(result.split("…")[1]).toHaveLength(10);
    expect(result.startsWith("did:cc:123")).toBe(true);
    expect(result.endsWith("fghijklmno")).toBe(true);
  });
});

describe("resolveFriendStatus", () => {
  it("uses Map override when present", () => {
    const map = new Map<string, OnlineStatus>([["did:a", "online"]]);
    const friend = f({ friend_did: "did:a", onlineStatus: "offline" });
    expect(resolveFriendStatus(friend, map)).toBe("online");
  });

  it("falls through to friend.onlineStatus.status (object form)", () => {
    const friend = f({ onlineStatus: { status: "away" } });
    expect(resolveFriendStatus(friend, null)).toBe("away");
  });

  it("accepts string form of onlineStatus", () => {
    const friend = f({ onlineStatus: "online" });
    expect(resolveFriendStatus(friend, undefined)).toBe("online");
  });

  it("defaults to offline for unknown / missing status", () => {
    expect(resolveFriendStatus(f({}), null)).toBe("offline");
    expect(
      resolveFriendStatus(f({ onlineStatus: "weird" as never }), null),
    ).toBe("offline");
    expect(
      resolveFriendStatus(
        f({ onlineStatus: { status: "weird" } as never }),
        null,
      ),
    ).toBe("offline");
  });
});

describe("getFriendGroups", () => {
  it("returns distinct group names", () => {
    const friends = [
      f({ friend_did: "did:1", group_name: "工作" }),
      f({ friend_did: "did:2", group_name: "工作" }),
      f({ friend_did: "did:3", group_name: "家人" }),
    ];
    const groups = getFriendGroups(friends);
    expect(groups).toHaveLength(2);
    expect(groups).toContain("工作");
    expect(groups).toContain("家人");
  });

  it("ignores empty / whitespace / missing group_name", () => {
    const friends = [
      f({ friend_did: "did:1" }),
      f({ friend_did: "did:2", group_name: "" }),
      f({ friend_did: "did:3", group_name: "   " }),
      f({ friend_did: "did:4", group_name: "朋友" }),
    ];
    expect(getFriendGroups(friends)).toEqual(["朋友"]);
  });
});

describe("countOnlineFriends", () => {
  it("counts only friends resolving to online", () => {
    const map = new Map<string, OnlineStatus>([
      ["did:a", "online"],
      ["did:b", "away"],
    ]);
    const friends = [
      f({ friend_did: "did:a" }),
      f({ friend_did: "did:b" }),
      f({ friend_did: "did:c", onlineStatus: "online" }),
      f({ friend_did: "did:d", onlineStatus: "offline" }),
    ];
    expect(countOnlineFriends(friends, map)).toBe(2);
  });

  it("returns 0 when no friends are online", () => {
    expect(countOnlineFriends([f({}), f({})], null)).toBe(0);
  });
});

describe("filterFriendsByGroup", () => {
  const friends = [
    f({ friend_did: "did:a", group_name: "工作", onlineStatus: "online" }),
    f({ friend_did: "did:b", group_name: "家人", onlineStatus: "offline" }),
    f({ friend_did: "did:c", group_name: "工作", onlineStatus: "away" }),
  ];

  it("'all' returns the input array", () => {
    expect(filterFriendsByGroup(friends, "all")).toEqual(friends);
  });

  it("'online' filters via resolveFriendStatus", () => {
    expect(
      filterFriendsByGroup(friends, "online").map((x) => x.friend_did),
    ).toEqual(["did:a"]);
  });

  it("custom group key matches group_name exactly", () => {
    expect(
      filterFriendsByGroup(friends, "工作").map((x) => x.friend_did),
    ).toEqual(["did:a", "did:c"]);
  });
});

describe("matchFriendKeyword", () => {
  const friends = [
    f({ friend_did: "did:cc:alice", nickname: "Alice", notes: "同事" }),
    f({ friend_did: "did:cc:bob", nickname: "Bob", notes: "前同事" }),
    f({ friend_did: "did:cc:caroline", nickname: "Caroline" }),
  ];

  it("returns input unchanged for empty query", () => {
    expect(matchFriendKeyword(friends, "")).toEqual(friends);
    expect(matchFriendKeyword(friends, "   ")).toEqual(friends);
  });

  it("matches nickname (case-insensitive)", () => {
    expect(matchFriendKeyword(friends, "alice").map((x) => x.nickname)).toEqual(
      ["Alice"],
    );
    expect(matchFriendKeyword(friends, "BOB").map((x) => x.nickname)).toEqual([
      "Bob",
    ]);
  });

  it("matches did substring", () => {
    expect(
      matchFriendKeyword(friends, "caroline").map((x) => x.friend_did),
    ).toEqual(["did:cc:caroline"]);
  });

  it("matches notes substring", () => {
    expect(matchFriendKeyword(friends, "同事").map((x) => x.nickname)).toEqual([
      "Alice",
      "Bob",
    ]);
  });
});

describe("friendStatusLabel + friendStatusColor", () => {
  it("maps each known status", () => {
    expect(friendStatusLabel("online")).toBe("在线");
    expect(friendStatusLabel("away")).toBe("离开");
    expect(friendStatusLabel("offline")).toBe("离线");
    expect(friendStatusColor("online")).toBe("green");
    expect(friendStatusColor("away")).toBe("orange");
    expect(friendStatusColor("offline")).toBe("default");
  });

  it("undefined falls back to offline / default", () => {
    expect(friendStatusLabel(undefined)).toBe("离线");
    expect(friendStatusColor(undefined)).toBe("default");
  });
});
