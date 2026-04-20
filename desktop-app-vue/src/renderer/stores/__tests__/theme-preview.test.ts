/**
 * useThemePreviewStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state defaults to "dark"
 *  - apply() sets active theme + document attribute + localStorage
 *  - apply() ignores invalid theme values
 *  - restore() reads last-saved value from localStorage
 *  - restore() falls back to default when storage is empty or invalid
 *  - clear() removes attribute + storage + resets state
 *  - PREVIEW_THEMES exposes the 4 expected keys in order
 */

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

  it("exposes 4 preview themes in canonical order", () => {
    const keys = PREVIEW_THEMES.map((t) => t.key);
    expect(keys).toEqual(["dark", "light", "blue", "green"]);
  });

  it("initializes with dark theme", () => {
    const store = useThemePreviewStore();
    expect(store.active).toBe("dark");
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
    store.apply("light");
    store.apply("purple" as PreviewTheme);
    expect(store.active).toBe("light");
    expect(document.documentElement.dataset.themePreview).toBe("light");
  });

  it("apply() accepts each of the 4 valid themes", () => {
    const store = useThemePreviewStore();
    for (const t of PREVIEW_THEMES) {
      store.apply(t.key);
      expect(store.active).toBe(t.key);
      expect(document.documentElement.dataset.themePreview).toBe(t.key);
    }
  });

  it("restore() reads saved value from localStorage", () => {
    localStorage.setItem("cc.theme-preview", "green");
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("green");
    expect(document.documentElement.dataset.themePreview).toBe("green");
  });

  it("restore() falls back to dark when storage is empty", () => {
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("dark");
    expect(document.documentElement.dataset.themePreview).toBe("dark");
  });

  it("restore() falls back to dark when storage holds invalid value", () => {
    localStorage.setItem("cc.theme-preview", "orange");
    const store = useThemePreviewStore();
    store.restore();
    expect(store.active).toBe("dark");
  });

  it("clear() resets state + removes attribute + clears storage", () => {
    const store = useThemePreviewStore();
    store.apply("blue");
    expect(localStorage.getItem("cc.theme-preview")).toBe("blue");
    store.clear();
    expect(store.active).toBe("dark");
    expect(localStorage.getItem("cc.theme-preview")).toBeNull();
    expect(document.documentElement.dataset.themePreview).toBeUndefined();
  });

  it("apply() is stable under repeated calls with same theme", () => {
    const store = useThemePreviewStore();
    store.apply("light");
    store.apply("light");
    store.apply("light");
    expect(store.active).toBe("light");
    expect(localStorage.getItem("cc.theme-preview")).toBe("light");
  });

  it("distinct stores share localStorage-backed restore", () => {
    const first = useThemePreviewStore();
    first.apply("green");
    setActivePinia(createPinia());
    const second = useThemePreviewStore();
    expect(second.active).toBe("dark");
    second.restore();
    expect(second.active).toBe("green");
  });
});
