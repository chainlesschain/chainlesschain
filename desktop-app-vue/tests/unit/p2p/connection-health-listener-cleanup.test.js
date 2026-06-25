/**
 * P2PConnectionHealthManager — event-listener cleanup.
 *
 * Bug: _setupEventListeners attached anonymous arrow handlers for
 * peer:connected/disconnected/error on p2pManager, and cleanup() never removed
 * them (and couldn't — anonymous handlers have no stored reference). Since
 * cleanup() sets initialized=false, a later initialize() re-adds them, so each
 * init→cleanup→init cycle accumulates listeners: memory leak plus duplicate
 * _onPeer* dispatch (one peer:connected fires N handlers). Fix stores the bound
 * handlers and removes them in cleanup().
 */

import { describe, it, expect, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const P2PConnectionHealthManager = require("../../../src/main/p2p/connection-health-manager.js");

describe("P2PConnectionHealthManager listener cleanup", () => {
  it("removes peer listeners on cleanup and does not accumulate on re-setup", () => {
    const p2pManager = new EventEmitter();
    const mgr = new P2PConnectionHealthManager(p2pManager, {});

    mgr._setupEventListeners();
    expect(p2pManager.listenerCount("peer:connected")).toBe(1);
    expect(p2pManager.listenerCount("peer:disconnected")).toBe(1);
    expect(p2pManager.listenerCount("peer:error")).toBe(1);

    mgr.cleanup();
    expect(p2pManager.listenerCount("peer:connected")).toBe(0); // removed (fix)
    expect(p2pManager.listenerCount("peer:disconnected")).toBe(0);
    expect(p2pManager.listenerCount("peer:error")).toBe(0);

    // re-setup after cleanup must not double the listeners
    mgr._setupEventListeners();
    expect(p2pManager.listenerCount("peer:connected")).toBe(1); // not 2
  });
});
