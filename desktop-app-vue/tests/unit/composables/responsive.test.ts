/**
 * useResponsive 测试 — src/renderer/composables/useResponsive.ts
 *
 * Pure breakpoint/device/orientation computeds derived from window size.
 * A host component is mounted so onMounted→updateSize() syncs windowWidth
 * from the (test-set) window.innerWidth.
 */

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useResponsive, BREAKPOINTS } from "@/composables/useResponsive";

function useAt(width: number, height = 800) {
  (window as any).innerWidth = width;
  (window as any).innerHeight = height;
  let r: any;
  const C = defineComponent({
    setup() {
      r = useResponsive();
      return () => h("div");
    },
  });
  mount(C);
  return r;
}

describe("useResponsive — breakpoint", () => {
  it("maps width to the breakpoint name", () => {
    expect(useAt(400).breakpoint.value).toBe("xs");
    expect(useAt(500).breakpoint.value).toBe("sm");
    expect(useAt(700).breakpoint.value).toBe("md");
    expect(useAt(900).breakpoint.value).toBe("lg");
    expect(useAt(1100).breakpoint.value).toBe("xl");
    expect(useAt(1700).breakpoint.value).toBe("xxl");
  });

  it("uses the documented BREAKPOINTS thresholds", () => {
    expect(BREAKPOINTS).toMatchObject({
      xs: 480,
      md: 768,
      xl: 1200,
      xxl: 1600,
    });
  });
});

describe("useResponsive — device type + flags", () => {
  it("classifies mobile / tablet / desktop", () => {
    const m = useAt(600);
    expect(m.deviceType.value).toBe("mobile");
    expect(m.isMobile.value).toBe(true);
    const t = useAt(800);
    expect(t.deviceType.value).toBe("tablet");
    expect(t.isTablet.value).toBe(true);
    const d = useAt(1300);
    expect(d.deviceType.value).toBe("desktop");
    expect(d.isDesktop.value).toBe(true);
  });

  it("screen-size flags", () => {
    expect(useAt(500).isSmallScreen.value).toBe(true);
    const med = useAt(1000);
    expect(med.isMediumScreen.value).toBe(true);
    expect(med.isSmallScreen.value).toBe(false);
    expect(useAt(1300).isLargeScreen.value).toBe(true);
  });
});

describe("useResponsive — orientation", () => {
  it("portrait when height > width, landscape otherwise", () => {
    const p = useAt(500, 900);
    expect(p.isPortrait.value).toBe(true);
    expect(p.orientation.value).toBe("portrait");
    const l = useAt(1200, 700);
    expect(l.isLandscape.value).toBe(true);
    expect(l.orientation.value).toBe("landscape");
  });
});
