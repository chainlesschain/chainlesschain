/**
 * ChainlessChain Native Messaging HTTP Server
 * 为 Native Messaging Host 提供 HTTP API，用于接收浏览器扩展的剪藏请求
 */

const http = require('http');

const DEFAULT_PORT = 23456;

class NativeMessagingHTTPServer {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
    this.server = null;
    this.port = DEFAULT_PORT;
  }

  /**
   * 启动服务器
   */
  start(port = DEFAULT_PORT) {
    this.port = port;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, 'localhost', () => {
        console.log(`[NativeMessagingHTTPServer] 服务器已启动: http://localhost:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[NativeMessagingHTTPServer] 端口 ${this.port} 已被占用`);
        } else {
          console.error('[NativeMessagingHTTPServer] 服务器错误:', error);
        }
        reject(error);
      });
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[NativeMessagingHTTPServer] 服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理请求
   */
  async handleRequest(req, res) {
    // 设置 CORS 头（仅允许本地）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 仅接受 POST 请求
    if (req.method !== 'POST') {
      this.sendError(res, 405, 'Method Not Allowed');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // 路由
    if (url.pathname === '/api/clip') {
      await this.handleClipRequest(req, res);
    } else if (url.pathname === '/api/ping') {
      this.handlePingRequest(req, res);
    } else {
      this.sendError(res, 404, 'Not Found');
    }
  }

  /**
   * 处理 Ping 请求
   */
  handlePingRequest(req, res) {
    this.sendSuccess(res, { message: 'pong' });
  }

  /**
   * 处理剪藏请求
   */
  async handleClipRequest(req, res) {
    try {
      // 读取请求体
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      console.log('[NativeMessagingHTTPServer] 收到剪藏请求:', data.title);

      // 验证数据
      if (!data.title || !data.content) {
        this.sendError(res, 400, '缺少必要字段: title, content');
        return;
      }

      // 保存到数据库
      const knowledgeItem = {
        title: data.title,
        content: data.content,
        type: data.type || 'web_clip',
        tags: data.tags || [],
        source_url: data.url || '',
        author: data.author || '',
        published_date: data.date || new Date().toISOString(),
        metadata: JSON.stringify({
          domain: data.domain || '',
          excerpt: data.excerpt || '',
          clipped_at: new Date().toISOString(),
        }),
      };

      const savedItem = await this.database.addKnowledgeItem(knowledgeItem);

      console.log('[NativeMessagingHTTPServer] 知识库项已保存:', savedItem.id);

      // 添加到 RAG 索引
      if (data.autoIndex && this.ragManager) {
        try {
          await this.ragManager.addToIndex(savedItem);
          console.log('[NativeMessagingHTTPServer] 已添加到 RAG 索引');
        } catch (error) {
          console.error('[NativeMessagingHTTPServer] 添加到 RAG 索引失败:', error);
          // 不抛出错误，因为保存已成功
        }
      }

      // 返回成功响应
      this.sendSuccess(res, {
        id: savedItem.id,
        title: savedItem.title,
      });

    } catch (error) {
      console.error('[NativeMessagingHTTPServer] 处理剪藏请求失败:', error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 读取请求体
   */
  readRequestBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        resolve(body);
      });

      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 发送成功响应
   */
  sendSuccess(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data,
    }));
  }

  /**
   * 发送错误响应
   */
  sendError(res, statusCode, error) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error,
    }));
  }
}

module.exports = NativeMessagingHTTPServer;
