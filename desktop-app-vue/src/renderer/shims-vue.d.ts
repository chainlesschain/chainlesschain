/**
 * Vue 组件模块声明
 * 让 TypeScript 能够识别 .vue 文件
 */

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
