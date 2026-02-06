/**
 * 响应式布局系统
 * 提供统一的响应式断点和布局工具
 */

import { ref, computed, onMounted, onUnmounted } from "vue";
import type { Ref, ComputedRef, CSSProperties } from "vue";

// ==================== 类型定义 ====================

/**
 * 断点名称
 */
export type BreakpointName = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

/**
 * 设备类型
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

/**
 * 屏幕方向
 */
export type Orientation = "portrait" | "landscape";

/**
 * 布局模式
 */
export type LayoutMode = "stack" | "sidebar" | "split";

/**
 * 断点配置
 */
export type BreakpointConfig<T> = Record<BreakpointName, T>;

/**
 * 响应式网格选项
 */
export interface ResponsiveGridOptions {
  columns?: Partial<BreakpointConfig<number>>;
  gap?: Partial<BreakpointConfig<number>>;
}

/**
 * 响应式面板选项
 */
export interface ResponsivePanelOptions {
  defaultWidth?: Partial<BreakpointConfig<string>>;
  minWidth?: Partial<BreakpointConfig<number>>;
  maxWidth?: Partial<BreakpointConfig<string>>;
  collapsible?: boolean;
}

/**
 * 响应式字体选项
 */
export interface ResponsiveFontOptions {
  base?: Partial<BreakpointConfig<number>>;
  scale?: number;
}

/**
 * 响应式间距选项
 */
export interface ResponsiveSpacingOptions {
  padding?: Partial<BreakpointConfig<number>>;
  margin?: Partial<BreakpointConfig<number>>;
}

/**
 * 表格列配置
 */
export interface TableColumn {
  mobile?: boolean;
  tablet?: boolean;
  [key: string]: any;
}

// ==================== 常量 ====================

/**
 * 响应式断点定义
 */
export const BREAKPOINTS: BreakpointConfig<number> = {
  xs: 480,   // 手机
  sm: 576,   // 大手机
  md: 768,   // 平板
  lg: 992,   // 小桌面
  xl: 1200,  // 桌面
  xxl: 1600, // 大桌面
};

/**
 * 设备类型常量
 */
export const DEVICE_TYPES = {
  MOBILE: "mobile" as const,
  TABLET: "tablet" as const,
  DESKTOP: "desktop" as const,
};

// ==================== Composables ====================

/**
 * 响应式布局 Composable
 */
export function useResponsive() {
  const windowWidth = ref(window.innerWidth);
  const windowHeight = ref(window.innerHeight);

  // 当前断点
  const breakpoint: ComputedRef<BreakpointName> = computed(() => {
    const width = windowWidth.value;
    if (width < BREAKPOINTS.xs) return "xs";
    if (width < BREAKPOINTS.sm) return "sm";
    if (width < BREAKPOINTS.md) return "md";
    if (width < BREAKPOINTS.lg) return "lg";
    if (width < BREAKPOINTS.xl) return "xl";
    return "xxl";
  });

  // 设备类型
  const deviceType: ComputedRef<DeviceType> = computed(() => {
    const width = windowWidth.value;
    if (width < BREAKPOINTS.md) return DEVICE_TYPES.MOBILE;
    if (width < BREAKPOINTS.lg) return DEVICE_TYPES.TABLET;
    return DEVICE_TYPES.DESKTOP;
  });

  // 是否为移动设备
  const isMobile = computed(() => deviceType.value === DEVICE_TYPES.MOBILE);

  // 是否为平板
  const isTablet = computed(() => deviceType.value === DEVICE_TYPES.TABLET);

  // 是否为桌面
  const isDesktop = computed(() => deviceType.value === DEVICE_TYPES.DESKTOP);

  // 是否为小屏幕
  const isSmallScreen = computed(() => windowWidth.value < BREAKPOINTS.md);

  // 是否为中等屏幕
  const isMediumScreen = computed(
    () => windowWidth.value >= BREAKPOINTS.md && windowWidth.value < BREAKPOINTS.xl,
  );

  // 是否为大屏幕
  const isLargeScreen = computed(() => windowWidth.value >= BREAKPOINTS.xl);

  // 是否为竖屏
  const isPortrait = computed(() => windowHeight.value > windowWidth.value);

  // 是否为横屏
  const isLandscape = computed(() => windowWidth.value > windowHeight.value);

  // 屏幕方向
  const orientation: ComputedRef<Orientation> = computed(() =>
    isPortrait.value ? "portrait" : "landscape",
  );

  // 更新窗口尺寸
  const updateSize = () => {
    windowWidth.value = window.innerWidth;
    windowHeight.value = window.innerHeight;
  };

  // 防抖处理
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const handleResize = () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(updateSize, 150);
  };

  onMounted(() => {
    window.addEventListener("resize", handleResize);
    updateSize();
  });

  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
  });

  return {
    windowWidth,
    windowHeight,
    breakpoint,
    deviceType,
    isMobile,
    isTablet,
    isDesktop,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    isPortrait,
    isLandscape,
    orientation,
  };
}

/**
 * 响应式网格系统
 */
export function useResponsiveGrid(options: ResponsiveGridOptions = {}) {
  const {
    columns = { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, xxl: 6 },
    gap = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 24 },
  } = options;

  const { breakpoint } = useResponsive();

  // 当前列数
  const currentColumns = computed(
    () => columns[breakpoint.value] || columns.md || 3,
  );

  // 当前间距
  const currentGap = computed(() => gap[breakpoint.value] || gap.md || 16);

  // 网格样式
  const gridStyle: ComputedRef<CSSProperties> = computed(() => ({
    display: "grid",
    gridTemplateColumns: `repeat(${currentColumns.value}, 1fr)`,
    gap: `${currentGap.value}px`,
  }));

  return {
    currentColumns,
    currentGap,
    gridStyle,
  };
}

/**
 * 响应式面板系统
 */
export function useResponsivePanel(options: ResponsivePanelOptions = {}) {
  const {
    defaultWidth = {
      xs: "100%",
      sm: "100%",
      md: "300px",
      lg: "350px",
      xl: "400px",
      xxl: "450px",
    },
    minWidth = { xs: 0, sm: 0, md: 200, lg: 250, xl: 300, xxl: 350 },
    maxWidth = {
      xs: "100%",
      sm: "100%",
      md: "50%",
      lg: "40%",
      xl: "35%",
      xxl: "30%",
    },
    collapsible = true,
  } = options;

  const { breakpoint, isMobile } = useResponsive();
  const isCollapsed = ref(isMobile.value);

  // 当前宽度
  const currentWidth = computed(() => {
    if (isCollapsed.value) return "0px";
    return defaultWidth[breakpoint.value] || defaultWidth.md || "300px";
  });

  // 当前最小宽度
  const currentMinWidth = computed(
    () => minWidth[breakpoint.value] || minWidth.md || 200,
  );

  // 当前最大宽度
  const currentMaxWidth = computed(
    () => maxWidth[breakpoint.value] || maxWidth.md || "50%",
  );

  // 面板样式
  const panelStyle: ComputedRef<CSSProperties> = computed(() => ({
    width: currentWidth.value,
    minWidth: isCollapsed.value ? "0px" : `${currentMinWidth.value}px`,
    maxWidth: isCollapsed.value ? "0px" : currentMaxWidth.value,
    transition: "all 0.3s ease",
    overflow: isCollapsed.value ? "hidden" : "auto",
  }));

  // 切换折叠状态
  const toggleCollapse = () => {
    if (collapsible) {
      isCollapsed.value = !isCollapsed.value;
    }
  };

  // 展开
  const expand = () => {
    if (collapsible) {
      isCollapsed.value = false;
    }
  };

  // 折叠
  const collapse = () => {
    if (collapsible) {
      isCollapsed.value = true;
    }
  };

  return {
    isCollapsed,
    currentWidth,
    currentMinWidth,
    currentMaxWidth,
    panelStyle,
    toggleCollapse,
    expand,
    collapse,
  };
}

/**
 * 响应式字体大小
 */
export function useResponsiveFontSize(options: ResponsiveFontOptions = {}) {
  const {
    base = { xs: 12, sm: 13, md: 14, lg: 14, xl: 15, xxl: 16 },
    scale = 1,
  } = options;

  const { breakpoint } = useResponsive();

  // 当前字体大小
  const fontSize = computed(() => {
    const baseSize = base[breakpoint.value] || base.md || 14;
    return Math.round(baseSize * scale);
  });

  // 字体样式
  const fontStyle: ComputedRef<CSSProperties> = computed(() => ({
    fontSize: `${fontSize.value}px`,
  }));

  return {
    fontSize,
    fontStyle,
  };
}

/**
 * 响应式间距
 */
export function useResponsiveSpacing(options: ResponsiveSpacingOptions = {}) {
  const {
    padding = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 24 },
    margin = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 24 },
  } = options;

  const { breakpoint } = useResponsive();

  // 当前内边距
  const currentPadding = computed(
    () => padding[breakpoint.value] || padding.md || 16,
  );

  // 当前外边距
  const currentMargin = computed(
    () => margin[breakpoint.value] || margin.md || 16,
  );

  // 间距样式
  const spacingStyle: ComputedRef<CSSProperties> = computed(() => ({
    padding: `${currentPadding.value}px`,
    margin: `${currentMargin.value}px`,
  }));

  return {
    currentPadding,
    currentMargin,
    spacingStyle,
  };
}

/**
 * 媒体查询工具
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  let mediaQuery: MediaQueryList | null = null;

  const updateMatches = (e: MediaQueryListEvent) => {
    matches.value = e.matches;
  };

  onMounted(() => {
    mediaQuery = window.matchMedia(query);
    matches.value = mediaQuery.matches;
    mediaQuery.addEventListener("change", updateMatches);
  });

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener("change", updateMatches);
    }
  });

  return matches;
}

/**
 * 响应式表格列配置
 */
export function useResponsiveTableColumns(columns: TableColumn[]) {
  const { isMobile, isTablet } = useResponsive();

  // 响应式列配置
  const responsiveColumns = computed(() => {
    if (isMobile.value) {
      // 移动端只显示关键列
      return columns.filter((col) => col.mobile !== false);
    }
    if (isTablet.value) {
      // 平板端显示重要列
      return columns.filter((col) => col.tablet !== false);
    }
    // 桌面端显示所有列
    return columns;
  });

  return {
    responsiveColumns,
  };
}

/**
 * 响应式布局模式
 */
export function useResponsiveLayout() {
  const { isMobile, isTablet } = useResponsive();

  // 布局模式: stack(堆叠), sidebar(侧边栏), split(分栏)
  const layoutMode: ComputedRef<LayoutMode> = computed(() => {
    if (isMobile.value) return "stack";
    if (isTablet.value) return "sidebar";
    return "split";
  });

  // 是否显示侧边栏
  const showSidebar = computed(() => layoutMode.value !== "stack");

  // 是否使用堆叠布局
  const useStackLayout = computed(() => layoutMode.value === "stack");

  // 是否使用分栏布局
  const useSplitLayout = computed(() => layoutMode.value === "split");

  return {
    layoutMode,
    showSidebar,
    useStackLayout,
    useSplitLayout,
  };
}

/**
 * 响应式导航
 */
export function useResponsiveNavigation() {
  const { isMobile } = useResponsive();
  const isMenuOpen = ref(false);

  // 切换菜单
  const toggleMenu = () => {
    isMenuOpen.value = !isMenuOpen.value;
  };

  // 关闭菜单
  const closeMenu = () => {
    isMenuOpen.value = false;
  };

  // 是否显示汉堡菜单
  const showHamburger = computed(() => isMobile.value);

  return {
    isMenuOpen,
    showHamburger,
    toggleMenu,
    closeMenu,
  };
}

export default {
  BREAKPOINTS,
  DEVICE_TYPES,
  useResponsive,
  useResponsiveGrid,
  useResponsivePanel,
  useResponsiveFontSize,
  useResponsiveSpacing,
  useMediaQuery,
  useResponsiveTableColumns,
  useResponsiveLayout,
  useResponsiveNavigation,
};
