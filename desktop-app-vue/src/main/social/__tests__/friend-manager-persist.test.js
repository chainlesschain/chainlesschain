/**
 * FriendManager — persistence flush (saveToFile)
 *
 * Regression: friend mutation methods wrote via this.database.db.prepare().run()
 * but never called this.database.saveToFile(). On better-sqlite3 that is a no-op
 * (auto-persist), but under the sql.js fallback the changes were never flushed
 * to disk, so friend data (requests, friendships, nicknames, trust) was lost on
 * restart. Sibling community-manager calls saveToFile after every write.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { FriendManager } = require("../friend-manager.js");

function makeMgr() {
  const db = {
    db: {
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 1 })),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
    },
    saveToFile: vi.fn(),
  };
  const didManager = { getCurrentIdentity: () => ({ did: "did:me" }) };
  return { mgr: new FriendManager(db, didManager, null), db };
}

describe("FriendManager — persistence flush", () => {
  it("flushes to disk after updating a friend nickname", async () => {
    const { mgr, db } = makeMgr();
    await mgr.updateFriendNickname("did:friend", "Buddy");
    expect(db.saveToFile).toHaveBeenCalled();
  });

  it("flushes to disk after updating a friend group", async () => {
    const { mgr, db } = makeMgr();
    await mgr.updateFriendGroup("did:friend", "Work");
    expect(db.saveToFile).toHaveBeenCalled();
  });
});
