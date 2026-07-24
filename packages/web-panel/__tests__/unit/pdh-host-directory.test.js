import { describe, expect, it, vi } from "vitest";
import {
  chooseHostDirectory,
  hostDirectoryPrompt,
  isAbsoluteHostPath,
} from "../../src/utils/pdh-host-directory.js";

describe("PDH host directory selection", () => {
  it("uses a native selection without opening manual input", async () => {
    const prompt = vi.fn();
    await expect(
      chooseHostDirectory({
        pickDirectoryResult: vi
          .fn()
          .mockResolvedValue({ status: "selected", path: "C:\\Native" }),
        prompt,
        title: "选择目录",
        directoryKind: "扫描",
      }),
    ).resolves.toEqual({
      status: "selected",
      path: "C:\\Native",
      manual: false,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("does not reinterpret native cancellation as missing capability", async () => {
    const prompt = vi.fn();
    await expect(
      chooseHostDirectory({
        pickDirectoryResult: vi
          .fn()
          .mockResolvedValue({ status: "cancelled", path: null }),
        prompt,
        directoryKind: "配置",
      }),
    ).resolves.toEqual({
      status: "cancelled",
      path: null,
      manual: false,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("labels the fallback as a host path and preserves its exact value", async () => {
    const prompt = vi.fn().mockReturnValue("C:\\Data, Archive ");
    await expect(
      chooseHostDirectory({
        pickDirectoryResult: vi
          .fn()
          .mockResolvedValue({ status: "unavailable", path: null }),
        prompt,
        directoryKind: "扫描",
      }),
    ).resolves.toEqual({
      status: "selected",
      path: "C:\\Data, Archive ",
      manual: true,
    });
    expect(prompt).toHaveBeenCalledWith(hostDirectoryPrompt("扫描"));
    expect(prompt.mock.calls[0][0]).toContain("ChainlessChain 主机");
    expect(prompt.mock.calls[0][0]).toContain("不是浏览器所在设备的路径");
  });

  it("treats an empty manual host path as cancellation", async () => {
    await expect(
      chooseHostDirectory({
        pickDirectoryResult: vi
          .fn()
          .mockResolvedValue({ status: "unavailable", path: null }),
        prompt: vi.fn().mockReturnValue(""),
        directoryKind: "导出",
      }),
    ).resolves.toEqual({
      status: "cancelled",
      path: null,
      manual: true,
    });
  });

  it("rejects relative manual paths instead of resolving them on the host", async () => {
    expect(isAbsoluteHostPath("/srv/ChainlessChain Data ")).toBe(true);
    expect(isAbsoluteHostPath("C:\\ChainlessChain Data ")).toBe(true);
    expect(isAbsoluteHostPath("C:/ChainlessChain Data ")).toBe(true);
    expect(isAbsoluteHostPath("relative/data")).toBe(false);
    expect(isAbsoluteHostPath(" C:\\Data")).toBe(false);
    expect(isAbsoluteHostPath("\\\\server\\share")).toBe(false);

    await expect(
      chooseHostDirectory({
        pickDirectoryResult: vi
          .fn()
          .mockResolvedValue({ status: "unavailable", path: null }),
        prompt: vi.fn().mockReturnValue("relative/data"),
        directoryKind: "扫描",
      }),
    ).resolves.toEqual({
      status: "invalid",
      path: null,
      manual: true,
      reason: "HOST_ABSOLUTE_PATH_REQUIRED",
    });
  });
});
