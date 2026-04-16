/**
 * video-protocol.test.js — WebSocket video routes unit tests
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

describe("video-protocol", () => {
  let VIDEO_HANDLERS, VIDEO_STREAMING_HANDLERS, attachVideoRoutes;

  beforeEach(async () => {
    const mod = await import("../../src/gateways/ws/video-protocol.js");
    VIDEO_HANDLERS = mod.VIDEO_HANDLERS;
    VIDEO_STREAMING_HANDLERS = mod.VIDEO_STREAMING_HANDLERS;
    attachVideoRoutes = mod.attachVideoRoutes;
  });

  test("exports 1 request/response handler", () => {
    expect(Object.keys(VIDEO_HANDLERS)).toContain("video.assets.list");
    expect(Object.keys(VIDEO_HANDLERS)).toHaveLength(1);
  });

  test("exports 5 streaming handlers", () => {
    const keys = Object.keys(VIDEO_STREAMING_HANDLERS);
    expect(keys).toContain("video.deconstruct");
    expect(keys).toContain("video.plan");
    expect(keys).toContain("video.assemble");
    expect(keys).toContain("video.render");
    expect(keys).toContain("video.edit");
    expect(keys).toHaveLength(5);
  });

  test("all handlers are async functions", () => {
    for (const h of Object.values(VIDEO_HANDLERS)) {
      expect(typeof h).toBe("function");
    }
    for (const h of Object.values(VIDEO_STREAMING_HANDLERS)) {
      expect(typeof h).toBe("function");
    }
  });

  test("video.assets.list returns ok with empty array when no cache dir", async () => {
    const result = await VIDEO_HANDLERS["video.assets.list"]({});
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.assets)).toBe(true);
  });

  test("video.deconstruct fails without videoPath", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.deconstruct"](
      {},
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.plan fails without assetDir", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.plan"](
      {},
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.assemble fails without assetDir", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.assemble"](
      {},
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.assemble fails without shotPlan", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.assemble"](
      { assetDir: "/tmp" },
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.render fails without videoPath", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.render"](
      {},
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.render fails without shotPoint", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.render"](
      { videoPath: "/v.mp4" },
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("video.edit fails without videoPath", async () => {
    const sender = vi.fn();
    const result = await VIDEO_STREAMING_HANDLERS["video.edit"](
      {},
      sender,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  test("attachVideoRoutes adds routes to object", () => {
    const routes = {};
    const mockServer = {
      _send: vi.fn(),
      _cancelHandlers: new Map(),
    };
    attachVideoRoutes(routes, mockServer);
    expect(routes["video.assets.list"]).toBeDefined();
    expect(routes["video.edit"]).toBeDefined();
    expect(routes["video.deconstruct"]).toBeDefined();
    expect(Object.keys(routes)).toHaveLength(6);
  });
});

describe("message-dispatcher video integration", () => {
  test("message-dispatcher imports video protocol", async () => {
    const code = (await import("fs")).readFileSync(
      "src/gateways/ws/message-dispatcher.js",
      "utf-8",
    );
    expect(code).toContain("VIDEO_HANDLERS");
    expect(code).toContain("VIDEO_STREAMING_HANDLERS");
    expect(code).toContain("video-protocol");
  });
});

describe("web-panel router", () => {
  test("router includes video path", async () => {
    const fs = await import("fs");
    const routerCode = fs.readFileSync(
      "../web-panel/src/router/index.js",
      "utf-8",
    );
    expect(routerCode).toContain("video");
    expect(routerCode).toContain("VideoEditing");
  });
});

describe("AppLayout nav", () => {
  test("nav includes video menu item", async () => {
    const fs = await import("fs");
    const layout = fs.readFileSync(
      "../web-panel/src/components/AppLayout.vue",
      "utf-8",
    );
    expect(layout).toContain('key="video"');
    expect(layout).toContain("VideoCameraOutlined");
    expect(layout).toContain("视频剪辑");
  });
});
