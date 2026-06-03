import "@/utils/ipc-shim";
import { logger } from "@/utils/logger";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router, { setV6ShellDefault } from "./router";
import i18n from "./locales";
import { registerPermissionDirective } from "./directives/permission";
// Ant Design Vue 已通过 unplugin-vue-components 自动按需导入
import "ant-design-vue/dist/reset.css";
import "prosemirror-view/style/prosemirror.css";
import "./shell/design-tokens.css";
import "./style.css";

// 导入优化组件
import SkeletonLoader from "@/components/common/SkeletonLoader.vue";
import LazyImage from "@/components/common/LazyImage.vue";
import AsyncComponent from "@/components/common/AsyncComponent.vue";
import CommandPalette from "@/components/common/CommandPalette.vue";
import PerformanceMonitor from "@/components/common/PerformanceMonitor.vue";

// 导入过渡组件
import FadeSlide from "@/components/common/transitions/FadeSlide.vue";
import ScaleTransition from "@/components/common/transitions/ScaleTransition.vue";
import CollapseTransition from "@/components/common/transitions/CollapseTransition.vue";

// 导入指令
import { createLazyLoadDirective } from "@/directives/lazy-load";
import { createContentVisibilityDirective } from "@/utils/content-visibility";

// 导入并初始化MediaStream处理器（用于P2P语音/视频通话）
import "@/utils/mediaStreamHandler";

// 导入并初始化主进程日志监听器（在 DevTools 中显示主进程日志）
import "@/utils/main-log-listener";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);
// Ant Design Vue 组件已通过 unplugin-vue-components 自动按需导入，无需全局注册

// 注册权限指令
registerPermissionDirective(app);

// 注册优化组件
app.component("SkeletonLoader", SkeletonLoader);
app.component("LazyImage", LazyImage);
app.component("AsyncComponent", AsyncComponent);
app.component("CommandPalette", CommandPalette);
app.component("PerformanceMonitor", PerformanceMonitor);
app.component("FadeSlide", FadeSlide);
app.component("ScaleTransition", ScaleTransition);
app.component("CollapseTransition", CollapseTransition);

// 注册懒加载指令
app.directive("lazy", createLazyLoadDirective());

// 注册 content-visibility 指令
app.directive("content-visibility", createContentVisibilityDirective());

logger.info("[App] Performance optimizations initialized");

// 启动前预读 V6 壳默认开关：让 router 守卫能在第一次导航时就生效
// Phase 3.4 硬翻：默认 V6；只有显式 ui.useV6ShellByDefault=false 才回退 V5。
// 配置读取失败、IPC 不可用、或 IPC 卡住时都保持 V6 默认，不阻塞挂载。
// 用 Promise.race 把 IPC 限制在 1.5s 内——超时直接走默认，避免主进程
// 没注册 handler 时整个 mount 被永久 await 卡住、splash 永远不消失。
try {
  const invoke = window.electronAPI?.invoke;
  if (typeof invoke === "function") {
    const raw = await Promise.race([
      invoke("config:get", "ui.useV6ShellByDefault"),
      new Promise((resolve) => setTimeout(() => resolve(true), 1500)),
    ]);
    setV6ShellDefault(raw !== false);
  }
} catch (err) {
  logger.warn("[App] 读取 V6 壳默认开关失败，保持 V6 默认", err);
}

app.mount("#app");

// Vue 挂载完成后淡出并移除页面加载动画。
// Belt-and-suspenders: 主路径 350ms 淡出 + 380ms 后 remove；保险路径
// 1500ms 后无条件再 remove 一次。已经被移除的 element parentNode 是
// null，第二次 remove 是 no-op，安全。这样即使 CSS 过渡因渲染压力
// 卡住、或者 setTimeout 被偶发延迟，splash 都会在 ~1.5s 内消失。
const pageLoading = document.getElementById("page-loading");
if (pageLoading) {
  pageLoading.classList.add("hide");
  // 立即停止吃事件，splash 即便残留也不挡 login 表单的点击
  pageLoading.style.pointerEvents = "none";
  setTimeout(() => {
    if (pageLoading.parentNode) {
      pageLoading.remove();
    }
  }, 380);
  setTimeout(() => {
    if (pageLoading.parentNode) {
      pageLoading.remove();
    }
  }, 1500);
}
