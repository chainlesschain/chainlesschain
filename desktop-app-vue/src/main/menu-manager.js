/**
 * 应用菜单管理器
 * 创建和管理Electron应用菜单
 */

const { Menu, shell, app } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

class MenuManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelProcess = null;
    this.controlPanelPort = 3001;
  }

  /**
   * 创建应用菜单
   */
  createMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
      // macOS应用菜单
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about', label: '关于' },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '显示全部' },
          { type: 'separator' },
          { role: 'quit', label: '退出' }
        ]
      }] : []),

      // 文件菜单
      {
        label: '文件',
        submenu: [
          {
            label: '新建笔记',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              this.sendToRenderer('create-new-note');
            }
          },
          {
            label: '导入文件',
            accelerator: 'CmdOrCtrl+I',
            click: () => {
              this.sendToRenderer('import-file');
            }
          },
          { type: 'separator' },
          {
            label: '保存',
            accelerator: 'CmdOrCtrl+S',
            click: () => {
              this.sendToRenderer('save-current');
            }
          },
          { type: 'separator' },
          isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
        ]
      },

      // 编辑菜单
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'delete', label: '删除' },
          { type: 'separator' },
          { role: 'selectAll', label: '全选' }
        ]
      },

      // 查看菜单
      {
        label: '查看',
        submenu: [
          {
            label: '刷新',
            accelerator: 'F5',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.reload();
              }
            }
          },
          {
            label: '强制刷新',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.reloadIgnoringCache();
              }
            }
          },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
          { type: 'separator' },
          {
            label: '开发者工具',
            accelerator: 'F12',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.toggleDevTools();
              }
            }
          }
        ]
      },

      // 工具菜单 (新增)
      {
        label: '工具',
        submenu: [
          {
            label: '🚀 高级特性控制面板',
            accelerator: 'CmdOrCtrl+Shift+A',
            click: () => {
              this.openControlPanel();
            }
          },
          { type: 'separator' },
          {
            label: '📊 性能监控',
            click: () => {
              this.openControlPanelTab('threshold');
            }
          },
          {
            label: '🧠 在线学习',
            click: () => {
              this.openControlPanelTab('learning');
            }
          },
          {
            label: '⚡ 高级优化器',
            click: () => {
              this.openControlPanelTab('optimizer');
            }
          },
          { type: 'separator' },
          {
            label: '全局设置',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              this.sendToRenderer('show-global-settings');
            }
          },
          {
            label: '系统设置',
            click: () => {
              this.sendToRenderer('navigate-to-settings');
            }
          }
        ]
      },

      // 窗口菜单
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          ...(isMac ? [
            { type: 'separator' },
            { role: 'front', label: '前置所有窗口' },
            { type: 'separator' },
            { role: 'window', label: '窗口' }
          ] : [
            { role: 'close', label: '关闭' }
          ])
        ]
      },

      // 帮助菜单
      {
        role: 'help',
        label: '帮助',
        submenu: [
          {
            label: '使用文档',
            click: async () => {
              await shell.openExternal('https://github.com/chainlesschain/chainlesschain');
            }
          },
          {
            label: '控制面板使用指南',
            click: () => {
              this.openControlPanelGuide();
            }
          },
          { type: 'separator' },
          {
            label: '检查更新',
            click: () => {
              this.checkForUpdates();
            }
          },
          { type: 'separator' },
          {
            label: '关于 ChainlessChain',
            click: () => {
              this.showAbout();
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    console.log('✓ 应用菜单已创建');
  }

  /**
   * 打开控制面板
   */
  async openControlPanel() {
    console.log('打开高级特性控制面板...');

    try {
      // 检查API服务是否运行
      const isRunning = await this.checkControlPanelRunning();

      if (!isRunning) {
        // 启动API服务
        await this.startControlPanelAPI();
        // 等待服务启动
        await this.waitForService(2000);
      }

      // 打开浏览器
      await shell.openExternal(`http://localhost:${this.controlPanelPort}`);

      console.log('✓ 控制面板已打开');
    } catch (error) {
      console.error('打开控制面板失败:', error);
      this.showError('无法打开控制面板', error.message);
    }
  }

  /**
   * 打开控制面板特定标签页
   */
  async openControlPanelTab(tab) {
    try {
      const isRunning = await this.checkControlPanelRunning();

      if (!isRunning) {
        await this.startControlPanelAPI();
        await this.waitForService(2000);
      }

      // 打开特定标签页
      await shell.openExternal(`http://localhost:${this.controlPanelPort}#${tab}`);
    } catch (error) {
      console.error('打开控制面板标签页失败:', error);
    }
  }

  /**
   * 检查控制面板API是否运行
   */
  async checkControlPanelRunning() {
    return new Promise((resolve) => {
      const http = require('http');

      const req = http.get(`http://localhost:${this.controlPanelPort}/api/overview`, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 启动控制面板API服务
   */
  async startControlPanelAPI() {
    if (this.controlPanelProcess) {
      console.log('控制面板API已在运行');
      return;
    }

    const scriptPath = path.join(__dirname, '..', '..', 'control-panel-api.js');

    console.log(`启动控制面板API: ${scriptPath}`);

    this.controlPanelProcess = spawn('node', [scriptPath, this.controlPanelPort], {
      cwd: path.dirname(scriptPath),
      detached: false,
      stdio: 'ignore'
    });

    this.controlPanelProcess.on('error', (error) => {
      console.error('控制面板API启动失败:', error);
      this.controlPanelProcess = null;
    });

    this.controlPanelProcess.on('exit', (code) => {
      console.log(`控制面板API退出，代码: ${code}`);
      this.controlPanelProcess = null;
    });

    console.log('✓ 控制面板API已启动');
  }

  /**
   * 等待服务启动
   */
  async waitForService(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 打开控制面板使用指南
   */
  openControlPanelGuide() {
    const guidePath = path.join(__dirname, '..', '..', 'CONTROL_PANEL_GUIDE.md');

    if (require('fs').existsSync(guidePath)) {
      shell.openPath(guidePath);
    } else {
      this.showError('文档未找到', '控制面板使用指南文档不存在');
    }
  }

  /**
   * 检查更新
   */
  checkForUpdates() {
    // 这里可以集成auto-updater
    this.sendToRenderer('check-for-updates');
  }

  /**
   * 显示关于对话框
   */
  showAbout() {
    const { dialog } = require('electron');

    dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: '关于 ChainlessChain',
      message: 'ChainlessChain',
      detail: `版本: ${app.getVersion()}\n\n个人AI知识库管理系统\n\n© 2024 ChainlessChain Team`,
      buttons: ['确定']
    });
  }

  /**
   * 显示错误对话框
   */
  showError(title, message) {
    const { dialog } = require('electron');

    dialog.showErrorBox(title, message);
  }

  /**
   * 发送消息到渲染进程
   */
  sendToRenderer(channel, ...args) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  /**
   * 停止控制面板API服务
   */
  stopControlPanelAPI() {
    if (this.controlPanelProcess) {
      console.log('停止控制面板API...');
      this.controlPanelProcess.kill();
      this.controlPanelProcess = null;
    }
  }

  /**
   * 清理资源
   */
  destroy() {
    this.stopControlPanelAPI();
  }
}

module.exports = MenuManager;
