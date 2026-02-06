import "@/utils/ipc-shim";
import { logger, createLogger } from '@/utils/logger';
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import i18n from "./locales";
import { registerPermissionDirective } from "./directives/permission";
// Ant Design Vue 已通过 unplugin-vue-components 自动按需导入
import "ant-design-vue/dist/reset.css";
import "prosemirror-view/style/prosemirror.css";
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

app.mount("#app");
