import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd from 'ant-design-vue';
import App from './App.vue';
import router from './router';
import i18n from './locales';
import { registerPermissionDirective } from './directives/permission';
import 'ant-design-vue/dist/reset.css';
import 'prosemirror-view/style/prosemirror.css';
import './style.css';

// 导入优化组件
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import LazyImage from '@/components/common/LazyImage.vue';
import AsyncComponent from '@/components/common/AsyncComponent.vue';
import CommandPalette from '@/components/common/CommandPalette.vue';
import PerformanceMonitor from '@/components/common/PerformanceMonitor.vue';

// 导入过渡组件
import FadeSlide from '@/components/common/transitions/FadeSlide.vue';
import ScaleTransition from '@/components/common/transitions/ScaleTransition.vue';
import CollapseTransition from '@/components/common/transitions/CollapseTransition.vue';

// 导入指令
import { createLazyLoadDirective } from '@/directives/lazy-load';
import { createContentVisibilityDirective } from '@/utils/content-visibility';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);
app.use(Antd);

// 注册权限指令
registerPermissionDirective(app);

// 注册优化组件
app.component('SkeletonLoader', SkeletonLoader);
app.component('LazyImage', LazyImage);
app.component('AsyncComponent', AsyncComponent);
app.component('CommandPalette', CommandPalette);
app.component('PerformanceMonitor', PerformanceMonitor);
app.component('FadeSlide', FadeSlide);
app.component('ScaleTransition', ScaleTransition);
app.component('CollapseTransition', CollapseTransition);

// 注册懒加载指令
app.directive('lazy', createLazyLoadDirective());

// 注册 content-visibility 指令
app.directive('content-visibility', createContentVisibilityDirective());

console.log('[App] Performance optimizations initialized');

app.mount('#app');
