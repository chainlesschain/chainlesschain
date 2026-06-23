/**
 * jsonrpc-id — needsRequestId 单元测试
 *
 * 回归：旧实现用 `!message.id` falsy 检查，会把 JSON-RPC 合法 id=0（及空串 id）
 * 当作缺失而重新分配 → 服务端按原 id=0 回包永远匹配不到被改写的 pending id。
 */
import { describe, it, expect } from "vitest";
import { needsRequestId } from "../jsonrpc-id.js";

describe("needsRequestId", () => {
  it("缺少 id 的带方法请求需要分配 id", () => {
    expect(needsRequestId({ jsonrpc: "2.0", method: "ping" })).toBe(true);
    expect(needsRequestId({ method: "ping", id: undefined })).toBe(true);
    expect(needsRequestId({ method: "ping", id: null })).toBe(true);
  });

  it("已有合法 id=0 不应被视为缺失（核心回归点）", () => {
    expect(needsRequestId({ method: "tools/call", id: 0 })).toBe(false);
  });

  it("已有空串 id 不应被视为缺失", () => {
    expect(needsRequestId({ method: "tools/call", id: "" })).toBe(false);
  });

  it("已有数字 / 字符串 id 不需要再分配", () => {
    expect(needsRequestId({ method: "tools/call", id: 1 })).toBe(false);
    expect(needsRequestId({ method: "tools/call", id: "abc" })).toBe(false);
  });

  it("没有 method 的消息（如响应）不分配 id", () => {
    expect(needsRequestId({ jsonrpc: "2.0", result: {} })).toBe(false);
    expect(needsRequestId({ jsonrpc: "2.0", result: {}, id: null })).toBe(
      false,
    );
  });

  it("空/无效输入安全返回 false", () => {
    expect(needsRequestId(null)).toBe(false);
    expect(needsRequestId(undefined)).toBe(false);
    expect(needsRequestId({})).toBe(false);
  });
});
