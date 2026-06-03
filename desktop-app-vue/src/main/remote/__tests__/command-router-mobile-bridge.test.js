/**
 * CommandRouter + Mobile Bridge gate 集成测试（M4 D2）
 *
 * 验证 whitelist 闸 + approval 通道与 command-router 的交互：
 *  1. desktop 内部调用（context.source 不是 'mobile'）不受影响
 *  2. 'mobile' 来源调用走白名单：不在 whitelist 的 → PERMISSION_DENIED
 *  3. 在 whitelist 但需要 approval 的 method → 通过 channel 异步等待回复
 *  4. approval 拒绝 → PERMISSION_DENIED；approval 通过 → handler 正常执行
 *  5. whitelist 配 approval 但未注入 channel → fail-safe 拒绝
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CommandRouter, ERROR_CODES } from "../command-router";
import { MobileSkillWhitelist } from "../handlers/mobile-skill-whitelist";
import { MobileApprovalChannel } from "../handlers/mobile-approval-channel";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("CommandRouter + Mobile Bridge gate", () => {
  let handler;

  beforeEach(() => {
    handler = { handle: vi.fn().mockResolvedValue({ ok: true }) };
  });

  describe("desktop 内部调用 (context.source !== 'mobile') — 不受 gate 影响", () => {
    it("即使 whitelist 配置严格也不 gate", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: [], // 空白名单 = 拒绝一切（对 mobile）
        }),
      });
      router.registerHandler("ai", handler);

      const res = await router.route(
        { id: 1, method: "ai.chat", params: {} },
        { source: "desktop" }, // 非 mobile
      );

      expect(res.result).toEqual({ ok: true });
      expect(handler.handle).toHaveBeenCalledOnce();
    });

    it("context 完全未设 source 字段 也不 gate（向后兼容）", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: [],
        }),
      });
      router.registerHandler("ai", handler);

      const res = await router.route({ id: 2, method: "ai.chat" });

      expect(res.result).toEqual({ ok: true });
    });
  });

  describe("mobile 来源 — 白名单 gate", () => {
    it("白名单允许 → handler 执行", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["ai.*"],
        }),
      });
      router.registerHandler("ai", handler);

      const res = await router.route(
        { id: 3, method: "ai.chat" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.result).toEqual({ ok: true });
      expect(handler.handle).toHaveBeenCalled();
    });

    it("白名单拒绝 → PERMISSION_DENIED + handler 不调用", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["ai.*"],
        }),
      });
      router.registerHandler("system", handler);

      const res = await router.route(
        { id: 4, method: "system.shutdown" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(res.error.message).toMatch(/not allowed for mobile peers/);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("空 whitelist + mobile context → 一律拒绝", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: [],
        }),
      });
      router.registerHandler("ai", handler);

      const res = await router.route(
        { id: 5, method: "ai.chat" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(res.error.message).toMatch(/exposeRemoteSkills is empty/);
    });

    it("未注入 whitelist → 不 gate（向后兼容）", async () => {
      const router = new CommandRouter({ enableLogging: false });
      router.registerHandler("system", handler);

      const res = await router.route(
        { id: 6, method: "system.shutdown" },
        { source: "mobile" },
      );

      expect(res.result).toEqual({ ok: true });
    });
  });

  describe("mobile 来源 + approval 通道", () => {
    it("approval 通过 → handler 执行 + context.mobileApproval 填入签名", async () => {
      const approvalChannel = new MobileApprovalChannel({ timeoutMs: 200 });
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["marketplace.*"],
          approvalChannelsForMobile: ["marketplace.purchase"],
        }),
        mobileApprovalChannel: approvalChannel,
      });
      router.registerHandler("marketplace", handler);

      // 自动 approve 注入：拿到 onRequest 回调立刻 resolve
      approvalChannel.setOnRequest((payload) => {
        approvalChannel.resolveApproval(payload.requestId, {
          approved: true,
          signature: "sig-xyz",
        });
      });

      const res = await router.route(
        { id: 7, method: "marketplace.purchase", params: { itemId: "X" } },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.result).toEqual({ ok: true });
      // handler 拿到的 context 应有 mobileApproval
      const handlerCallContext = handler.handle.mock.calls[0][2];
      expect(handlerCallContext.mobileApproval).toBeDefined();
      expect(handlerCallContext.mobileApproval.signature).toBe("sig-xyz");
    });

    it("approval 拒绝 → PERMISSION_DENIED + handler 不调用", async () => {
      const approvalChannel = new MobileApprovalChannel({ timeoutMs: 200 });
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["marketplace.*"],
          approvalChannelsForMobile: ["marketplace.purchase"],
        }),
        mobileApprovalChannel: approvalChannel,
      });
      router.registerHandler("marketplace", handler);

      approvalChannel.setOnRequest((payload) => {
        approvalChannel.resolveApproval(payload.requestId, {
          approved: false,
          deniedReason: "user-rejected",
        });
      });

      const res = await router.route(
        { id: 8, method: "marketplace.purchase" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(res.error.message).toMatch(/user-rejected/);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("approval 超时 → PERMISSION_DENIED with timeout reason", async () => {
      const approvalChannel = new MobileApprovalChannel({ timeoutMs: 50 });
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["did.*"],
          approvalChannelsForMobile: ["did.delegate"],
        }),
        mobileApprovalChannel: approvalChannel,
      });
      router.registerHandler("did", handler);

      approvalChannel.setOnRequest(() => {}); // 不主动回复 → 触发 timeout

      const res = await router.route(
        { id: 9, method: "did.delegate" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(res.error.message).toMatch(/timeout/);
    });

    it("requires approval but channel not configured → fail-safe 拒绝", async () => {
      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["marketplace.*"],
          approvalChannelsForMobile: ["marketplace.purchase"],
        }),
        // mobileApprovalChannel 故意不传
      });
      router.registerHandler("marketplace", handler);

      const res = await router.route(
        { id: 10, method: "marketplace.purchase" },
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(res.error.message).toMatch(/no approval channel is configured/);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("白名单内但不需要 approval → 跳过 channel 直接执行", async () => {
      const approvalCb = vi.fn();
      const approvalChannel = new MobileApprovalChannel({ timeoutMs: 200 });
      approvalChannel.setOnRequest(approvalCb);

      const router = new CommandRouter({
        enableLogging: false,
        mobileBridgeWhitelist: new MobileSkillWhitelist({
          exposeRemoteSkills: ["marketplace.*"],
          approvalChannelsForMobile: ["marketplace.purchase"],
        }),
        mobileApprovalChannel: approvalChannel,
      });
      router.registerHandler("marketplace", handler);

      const res = await router.route(
        { id: 11, method: "marketplace.browse" }, // 不在 approval 列表
        { source: "mobile", peerId: "android-1" },
      );

      expect(res.result).toEqual({ ok: true });
      expect(approvalCb).not.toHaveBeenCalled();
    });
  });
});
