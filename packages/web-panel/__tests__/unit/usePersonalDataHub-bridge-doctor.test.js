/**
 * Phase 6e — composable bridgeDoctor() routes to the right WS topic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 6e bridgeDoctor", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends bridge-doctor topic with empty payload + 60s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        results: {
          xhs: {
            ok: true,
            homepageUrl: "https://www.xiaohongshu.com/explore",
            warmUpMs: 3200,
            probeMs: 80,
            candidates: { _webmsxyw: true, webmsxyw: false },
            anyCandidatePresent: true,
          },
          toutiao: {
            ok: true,
            homepageUrl: "https://www.toutiao.com/",
            warmUpMs: 2900,
            probeMs: 70,
            candidates: { "byted_acrawler.sign": true },
            anyCandidatePresent: true,
          },
          kuaishou: {
            ok: true,
            homepageUrl: "https://www.kuaishou.com/new-reco",
            warmUpMs: 4500,
            probeMs: 120,
            candidates: { "__APP__.encryptParams": true },
            anyCandidatePresent: true,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bridgeDoctor();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.bridge-doctor");
    expect(timeout).toBe(60_000);
    expect(r.ok).toBe(true);
    expect(r.results.xhs.anyCandidatePresent).toBe(true);
    expect(r.results.toutiao.anyCandidatePresent).toBe(true);
    expect(r.results.kuaishou.anyCandidatePresent).toBe(true);
  });

  it("propagates MODULE_LOAD_FAILED (cli context, no Electron)", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "MODULE_LOAD_FAILED",
        message: "Cannot find module 'electron'",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bridgeDoctor();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MODULE_LOAD_FAILED");
  });

  it("propagates per-bridge failure (e.g. navigation timeout)", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        results: {
          xhs: {
            ok: false,
            homepageUrl: "https://www.xiaohongshu.com/explore",
            error: "warmUp did-finish-load timeout after 15000ms",
          },
          toutiao: {
            ok: true,
            homepageUrl: "https://www.toutiao.com/",
            warmUpMs: 2800,
            probeMs: 70,
            candidates: { "byted_acrawler.sign": true },
            anyCandidatePresent: true,
          },
          kuaishou: {
            ok: true,
            homepageUrl: "https://www.kuaishou.com/new-reco",
            warmUpMs: 4500,
            probeMs: 120,
            candidates: {
              "__APP__.encryptParams": false,
              "NS.sign": false,
              "GraphQL.fetch.sign": false,
              __SIGN__: false,
            },
            anyCandidatePresent: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bridgeDoctor();
    expect(r.ok).toBe(true);
    expect(r.results.xhs.ok).toBe(false);
    expect(r.results.kuaishou.anyCandidatePresent).toBe(false); // rotation
    expect(r.results.toutiao.anyCandidatePresent).toBe(true);
  });
});
