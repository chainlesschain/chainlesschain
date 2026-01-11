/**
 * Call History IPC Handler
 *
 * 处理通话历史记录相关的IPC请求
 */

import { ipcMain } from 'electron';

class CallHistoryIPC {
  constructor(callHistoryManager) {
    this.callHistoryManager = callHistoryManager;
    this.registered = false;
  }

  /**
   * 注册IPC处理器
   */
  register() {
    if (this.registered) {
      console.log('[CallHistoryIPC] IPC处理器已注册');
      return;
    }

    console.log('[CallHistoryIPC] 注册IPC处理器...');

    // 获取所有通话记录
    ipcMain.handle('call-history:get-all', async (event, options = {}) => {
      try {
        const history = await this.callHistoryManager.getCallHistory(options);
        return {
          success: true,
          history
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 获取通话记录失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取特定对等方的通话记录
    ipcMain.handle('call-history:get-by-peer', async (event, peerId, options = {}) => {
      try {
        const history = await this.callHistoryManager.getCallHistory({
          ...options,
          peerId
        });
        return {
          success: true,
          history
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 获取通话记录失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取单条通话记录
    ipcMain.handle('call-history:get-by-id', async (event, callId) => {
      try {
        const record = await this.callHistoryManager.getCallById(callId);
        return {
          success: true,
          record
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 获取通话记录失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 删除通话记录
    ipcMain.handle('call-history:delete', async (event, callId) => {
      try {
        await this.callHistoryManager.deleteCall(callId);
        return {
          success: true
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 删除通话记录失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 清空所有通话记录
    ipcMain.handle('call-history:clear-all', async (event) => {
      try {
        await this.callHistoryManager.clearAllCalls();
        return {
          success: true
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 清空通话记录失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取通话统计
    ipcMain.handle('call-history:get-stats', async (event, options = {}) => {
      try {
        const stats = await this.callHistoryManager.getCallStats(options);
        return {
          success: true,
          stats
        };
      } catch (error) {
        console.error('[CallHistoryIPC] 获取通话统计失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    this.registered = true;
    console.log('[CallHistoryIPC] IPC处理器注册完成');
  }

  /**
   * 注销IPC处理器
   */
  unregister() {
    if (!this.registered) {
      return;
    }

    console.log('[CallHistoryIPC] 注销IPC处理器...');

    ipcMain.removeHandler('call-history:get-all');
    ipcMain.removeHandler('call-history:get-by-peer');
    ipcMain.removeHandler('call-history:get-by-id');
    ipcMain.removeHandler('call-history:delete');
    ipcMain.removeHandler('call-history:clear-all');
    ipcMain.removeHandler('call-history:get-stats');

    this.registered = false;
    console.log('[CallHistoryIPC] IPC处理器注销完成');
  }
}

export default CallHistoryIPC;
