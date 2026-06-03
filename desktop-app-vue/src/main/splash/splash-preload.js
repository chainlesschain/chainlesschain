/**
 * Splash Window Preload Script
 * 启动画面预加载脚本
 *
 * 暴露最小化的 IPC 接口用于接收进度更新
 */

const { contextBridge, ipcRenderer } = require("electron");

// 暴露 splashAPI 到渲染进程
contextBridge.exposeInMainWorld("splashAPI", {
  // 监听进度更新
  onUpdateProgress: (callback) => {
    ipcRenderer.on("splash:update-progress", (event, data) => {
      callback(data);
    });
  },

  // 监听错误显示
  onShowError: (callback) => {
    ipcRenderer.on("splash:show-error", (event, data) => {
      callback(data);
    });
  },

  // 监听淡出信号
  onFadeOut: (callback) => {
    ipcRenderer.on("splash:fade-out", () => {
      callback();
    });
  },
});
