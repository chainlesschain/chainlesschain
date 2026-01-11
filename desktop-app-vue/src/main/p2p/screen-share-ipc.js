/**
 * 屏幕共享IPC处理器
 *
 * 提供屏幕共享相关的IPC通道
 */

const { ipcMain, desktopCapturer } = require('electron');

class ScreenShareIPC {
  constructor() {
    this.registered = false;
  }

  /**
   * 注册IPC处理器
   */
  register() {
    if (this.registered) {
      console.log('[ScreenShareIPC] IPC处理器已注册');
      return;
    }

    console.log('[ScreenShareIPC] 注册IPC处理器...');

    // 获取屏幕源列表
    ipcMain.handle('screen-share:get-sources', async (event, options = {}) => {
      try {
        const { types = ['screen', 'window'], thumbnailSize = { width: 150, height: 150 } } = options;

        const sources = await desktopCapturer.getSources({
          types,
          thumbnailSize
        });

        return {
          success: true,
          sources: sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            display_id: source.display_id,
            appIcon: source.appIcon ? source.appIcon.toDataURL() : null
          }))
        };
      } catch (error) {
        console.error('[ScreenShareIPC] 获取屏幕源失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取特定屏幕源的详细信息
    ipcMain.handle('screen-share:get-source-info', async (event, sourceId) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 300, height: 300 }
        });

        const source = sources.find(s => s.id === sourceId);
        if (!source) {
          return {
            success: false,
            error: '未找到指定的屏幕源'
          };
        }

        return {
          success: true,
          source: {
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            display_id: source.display_id,
            appIcon: source.appIcon ? source.appIcon.toDataURL() : null
          }
        };
      } catch (error) {
        console.error('[ScreenShareIPC] 获取屏幕源信息失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    this.registered = true;
    console.log('[ScreenShareIPC] IPC处理器注册完成');
  }

  /**
   * 注销IPC处理器
   */
  unregister() {
    if (!this.registered) {
      return;
    }

    console.log('[ScreenShareIPC] 注销IPC处理器...');

    ipcMain.removeHandler('screen-share:get-sources');
    ipcMain.removeHandler('screen-share:get-source-info');

    this.registered = false;
    console.log('[ScreenShareIPC] IPC处理器注销完成');
  }
}

module.exports = ScreenShareIPC;
