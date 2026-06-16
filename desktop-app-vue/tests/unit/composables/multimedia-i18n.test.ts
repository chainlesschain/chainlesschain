/**
 * useMultimediaI18n 测试 — src/renderer/composables/useMultimediaI18n.ts
 *
 * Nested-key translation + default-locale fallback, interpolation, plural,
 * locale switching. The i18n data module is mocked for deterministic keys.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/i18n/multimedia", () => ({
  multimediaI18n: {
    "zh-CN": {
      multimedia: {
        common: { upload: "上传" },
        greet: "你好 {name}",
        files: "{count} 个文件",
      },
    },
    "en-US": { multimedia: { common: { upload: "Upload" } } },
  },
}));

import {
  useMultimediaI18n,
  initMultimediaI18n,
} from "@/composables/useMultimediaI18n";

let i: ReturnType<typeof useMultimediaI18n>;
beforeEach(() => {
  localStorage.clear();
  i = useMultimediaI18n();
  i.setLocale("zh-CN"); // normalize the shared singleton
  localStorage.clear();
});

describe("useMultimediaI18n — t()", () => {
  it("resolves a nested key in the current locale", () => {
    expect(i.t("common.upload")).toBe("上传");
    i.setLocale("en-US");
    expect(i.t("common.upload")).toBe("Upload");
  });

  it("falls back to the default locale when the key is missing", () => {
    i.setLocale("en-US"); // en lacks 'greet'
    expect(i.t("greet")).toBe("你好 {name}");
  });

  it("returns the fallback text or key when missing everywhere", () => {
    expect(i.t("no.such.key", "FB")).toBe("FB");
    expect(i.t("no.such.key")).toBe("no.such.key");
  });
});

describe("useMultimediaI18n — interpolation + plural", () => {
  it("ti substitutes placeholders", () => {
    expect(i.ti("greet", { name: "张三" })).toBe("你好 张三");
  });

  it("tp injects count", () => {
    expect(i.tp("files", 5)).toBe("5 个文件");
  });
});

describe("useMultimediaI18n — locale management", () => {
  it("setLocale switches a supported locale and persists", () => {
    i.setLocale("en-US");
    expect(i.locale.value).toBe("en-US");
    expect(localStorage.getItem("multimedia-locale")).toBe("en-US");
  });

  it("setLocale ignores an unsupported locale", () => {
    i.setLocale("zh-CN");
    i.setLocale("xx-YY" as any);
    expect(i.locale.value).toBe("zh-CN");
  });

  it("isLocaleSupported + supportedLocales", () => {
    expect(i.isLocaleSupported("zh-CN")).toBe(true);
    expect(i.isLocaleSupported("xx")).toBe(false);
    expect(i.supportedLocales.value).toEqual(["zh-CN", "en-US"]);
  });
});

describe("initMultimediaI18n", () => {
  it("restores a saved locale from localStorage", () => {
    localStorage.setItem("multimedia-locale", "en-US");
    initMultimediaI18n();
    expect(useMultimediaI18n().locale.value).toBe("en-US");
  });
});
