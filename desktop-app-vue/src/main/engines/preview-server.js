/**
 * 本地预览服务器
 * 提供Web项目的本地预览功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const express = require('express');
const path = require('path');
const fs = require('fs');

class PreviewServer {
  constructor() {
    this.app = null;
    this.server = null;
    this.port = 3000;
    this.currentProjectPath = null;
    this.isRunning = false;
  }

  /**
   * 启动预览服务器
   * @param {string} projectPath - 项目根路径
   * @param {number} port - 端口号(可选)
   * @returns {Promise<Object>} 服务器信息
   */
  async start(projectPath, port = 3000) {
    // 如果已经在运行,先停止
    if (this.isRunning) {
      await this.stop();
    }

    this.port = port;
    this.currentProjectPath = projectPath;

    return new Promise((resolve, reject) => {
      try {
        // 创建Express应用
        this.app = express();

        // 设置静态文件目录
        this.app.use(express.static(projectPath));

        // 添加CORS支持
        this.app.use((req, res, next) => {
          res.header('Access-Control-Allow-Origin', '*');
          res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
          next();
        });

        // 处理根路径
        this.app.get('/', (req, res) => {
          const indexPath = path.join(projectPath, 'index.html');

          if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
          } else {
            res.send(this.generateDirectoryListing(projectPath));
          }
        });

        // 处理所有HTML文件请求(不带.html后缀)
        this.app.get('*', (req, res, next) => {
          const requestPath = req.path;

          // 如果请求路径不包含扩展名,尝试查找对应的HTML文件
          if (!path.extname(requestPath)) {
            const htmlPath = path.join(projectPath, requestPath + '.html');

            if (fs.existsSync(htmlPath)) {
              res.sendFile(htmlPath);
              return;
            }
          }

          next();
        });

        // 错误处理
        this.app.use((req, res) => {
          res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>404 - 文件未找到</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: #f5f5f5;
                }
                .error-container {
                  text-align: center;
                  padding: 2rem;
                  background: white;
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                h1 { color: #ff4d4f; }
                p { color: #666; }
              </style>
            </head>
            <body>
              <div class="error-container">
                <h1>404</h1>
                <p>文件未找到: ${req.path}</p>
                <a href="/">返回首页</a>
              </div>
            </body>
            </html>
          `);
        });

        // 启动服务器
        this.server = this.app.listen(this.port, () => {
          this.isRunning = true;
          const url = `http://localhost:${this.port}`;

          logger.info(`[Preview Server] 预览服务器已启动: ${url}`);
          logger.info(`[Preview Server] 项目路径: ${projectPath}`);

          resolve({
            success: true,
            url,
            port: this.port,
            projectPath,
          });
        });

        // 处理服务器错误
        this.server.on('error', (error) => {
          logger.error('[Preview Server] 服务器错误:', error);
          this.isRunning = false;

          // 如果端口被占用,尝试使用其他端口
          if (error.code === 'EADDRINUSE') {
            logger.info(`[Preview Server] 端口 ${this.port} 被占用,尝试使用端口 ${this.port + 1}`);
            this.start(projectPath, this.port + 1)
              .then(resolve)
              .catch(reject);
          } else {
            reject(error);
          }
        });
      } catch (error) {
        logger.error('[Preview Server] 启动失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 停止预览服务器
   * @returns {Promise<Object>}
   */
  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.isRunning || !this.server) {
        resolve({
          success: true,
          message: '服务器未运行',
        });
        return;
      }

      try {
        this.server.close((error) => {
          if (error) {
            logger.error('[Preview Server] 停止失败:', error);
            reject(error);
          } else {
            logger.info('[Preview Server] 预览服务器已停止');
            this.isRunning = false;
            this.server = null;
            this.app = null;
            this.currentProjectPath = null;

            resolve({
              success: true,
              message: '服务器已停止',
            });
          }
        });
      } catch (error) {
        logger.error('[Preview Server] 停止失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 重启预览服务器
   * @param {string} projectPath - 项目路径(可选)
   * @returns {Promise<Object>}
   */
  async restart(projectPath = null) {
    logger.info('[Preview Server] 重启预览服务器...');

    await this.stop();

    const path = projectPath || this.currentProjectPath;

    if (!path) {
      throw new Error('未指定项目路径');
    }

    return await this.start(path, this.port);
  }

  /**
   * 生成目录列表HTML
   * @param {string} directoryPath - 目录路径
   * @returns {string} HTML内容
   * @private
   */
  generateDirectoryListing(directoryPath) {
    let files = [];

    try {
      files = fs.readdirSync(directoryPath);
    } catch (error) {
      logger.error('[Preview Server] 读取目录失败:', error);
    }

    const fileLinks = files
      .map(file => {
        const filePath = path.join(directoryPath, file);
        const stats = fs.statSync(filePath);
        const isDirectory = stats.isDirectory();
        const icon = isDirectory ? '📁' : '📄';

        return `
          <li>
            <a href="${file}${isDirectory ? '/' : ''}">
              ${icon} ${file}
            </a>
          </li>
        `;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>目录列表 - ${path.basename(directoryPath)}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background: #f5f5f5;
          }
          h1 {
            color: #333;
            border-bottom: 2px solid #667eea;
            padding-bottom: 0.5rem;
          }
          ul {
            list-style: none;
            padding: 0;
          }
          li {
            background: white;
            margin: 0.5rem 0;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          a {
            display: block;
            padding: 1rem;
            color: #333;
            text-decoration: none;
            transition: background 0.2s;
          }
          a:hover {
            background: #f0f5ff;
          }
        </style>
      </head>
      <body>
        <h1>📂 ${path.basename(directoryPath)}</h1>
        <ul>
          ${fileLinks}
        </ul>
      </body>
      </html>
    `;
  }

  /**
   * 获取服务器状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      url: this.isRunning ? `http://localhost:${this.port}` : null,
      projectPath: this.currentProjectPath,
    };
  }

  /**
   * 更改端口
   * @param {number} newPort - 新端口号
   * @returns {Promise<Object>}
   */
  async changePort(newPort) {
    if (this.isRunning) {
      const projectPath = this.currentProjectPath;
      await this.stop();
      return await this.start(projectPath, newPort);
    } else {
      this.port = newPort;
      return {
        success: true,
        message: `端口已设置为 ${newPort}`,
      };
    }
  }
}

module.exports = PreviewServer;
