/**
 * ClipboardHandler 单元测试
 * 测试剪贴板同步功能
 *
 * 注意：这些测试需要 electron 原生模块，在 Vitest 中无法正确模拟
 */

import { describe, it } from "vitest";

// 跳过需要 electron 原生模块的测试
// 这些测试依赖 electron clipboard 和 nativeImage 模块，无法在 Node.js 环境中正确模拟
describe.skip("ClipboardHandler", () => {
  it("需要 electron 原生模块支持", () => {});
});
