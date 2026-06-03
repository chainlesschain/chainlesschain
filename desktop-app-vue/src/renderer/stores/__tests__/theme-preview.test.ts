import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  useThemePreviewStore,
  PREVIEW_THEMES,
  type PreviewTheme,
} from "../theme-preview";

describe("useThemePreviewStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete document.documentElement.dataset.themePreview;
  });

  it("exposes 4 preview themes in the intended order", () => {
    const keys = PREVIEW_THEMES.map((theme) => theme.key);
    expect(keys).toEqual(["light", "dark", "blue", "green"]);
  });

  it("initializes with light theme", () => {
    const store = useThemePreviewStore();
    expect(store.active).toBe("light");
  });

  it("apply() updates state, document attribute, and localStorage", () => {
    const store = useThemePreviewStore();
    store.apply("blue");
    expect(store.active).toBe("blue");
    expect(document.documentElement.dataset.themePreview).toBe("blue");
    expect(localStorage.getItem("cc.theme-preview")).toBe("blue");
  });

  it("apply() is a no-op for invalid theme names", () => {
    const store = useThemePreviewStore();
    store.apply("dark");
    store.apply("purple" as PreviewTheme);
    expect(store.active).toBe("dark");
    expect(document.documentElement.dataset.themePreview).toBe("dark");
  });

  it("apply() accepts each valid theme", () => {
    const store = useThemePreviewStore();
    for (const theme of PREVIEW_THEMES) {
      store.apply(theme.key);
      expect(store.active).toBe(theme.key);
      expect(document.documentElement.dataset.themePreview).toBe(theme.key);
    }
  });

  it("restore() reads the last saved value from localStorage", () => {
    localStorage.setItem("cc.theme-preview", "green");
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("green");
    expect(document.documentElement.dataset.themePreview).toBe("green");
  });

  it("restore() falls back to light when storage is empty", () => {
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("light");
    expect(document.documentElement.dataset.themePreview).toBe("light");
  });

  it("restore() falls back to light when storage is invalid", () => {
    localStorage.setItem("cc.theme-preview", "orange");
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("light");
  });

  it("clear() resets state, removes storage, and clears the dataset", () => {
    const store = useThemePreviewStore();
    store.apply("blue");
    store.clear();
    expect(store.active).toBe("light");
    expect(localStorage.getItem("cc.theme-preview")).toBeNull();
    expect(document.documentElement.dataset.themePreview).toBeUndefined();
  });

  it("distinct stores share localStorage-backed restore", () => {
    const first = useThemePreviewStore();
    first.apply("green");

    setActivePinia(createPinia());
    const second = useThemePreviewStore();
    expect(second.active).toBe("light");
    second.restore();
    expect(second.active).toBe("green");
  });
});
