#!/usr/bin/env node

/**
 * ChainlessChain Native Messaging Host
 * 浏览器扩展通过 Native Messaging 与桌面应用通信的桥梁
 */

const fs = require('fs');
const path = require('path');

// 日志文件路径
const LOG_FILE = path.join(process.env.APPDATA || process.env.HOME, 'chainlesschain-native-host.log');

/**
 * 写日志
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * 读取消息
 * Chrome Native Messaging 使用特殊的消息格式：
 * - 前 4 字节：消息长度（32位小端整数）
 * - 后续字节：JSON 消息内容
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    const lengthBuffer = Buffer.alloc(4);

    // 读取长度
    process.stdin.read(4, (error, buffer) => {
      if (error) {
        reject(error);
        return;
      }

      if (!buffer || buffer.length === 0) {
        resolve(null); // EOF
        return;
      }

      const length = buffer.readUInt32LE(0);

      // 读取消息内容
      const messageBuffer = Buffer.alloc(length);
      let bytesRead = 0;

      function readChunk() {
        const remaining = length - bytesRead;
        const chunk = process.stdin.read(remaining);

        if (chunk) {
          chunk.copy(messageBuffer, bytesRead);
          bytesRead += chunk.length;

          if (bytesRead === length) {
            try {
              const message = JSON.parse(messageBuffer.toString('utf8'));
              resolve(message);
            } catch (error) {
              reject(error);
            }
          } else {
            // 继续读取
            setImmediate(readChunk);
          }
        } else {
          // 等待更多数据
          process.stdin.once('readable', readChunk);
        }
      }

      readChunk();
    });
  });
}

/**
 * 发送消息
 */
function sendMessage(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf8');

  // 写入长度
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(buffer.length, 0);
  process.stdout.write(lengthBuffer);

  // 写入消息
  process.stdout.write(buffer);
}

/**
 * 处理消息
 */
async function handleMessage(message) {
  log(`收到消息: ${JSON.stringify(message)}`);

  try {
    const { action, data } = message;

    if (action === 'ping') {
      // 心跳检测
      return {
        success: true,
        type: 'pong',
      };
    }

    if (action === 'clipPage') {
      // 剪藏页面
      // 这里需要与 Electron 主进程通信
      // 可以通过 IPC Socket 或 HTTP 请求实现

      // 简化版：直接调用桌面应用的 API
      const result = await clipPageToApp(data);

      return {
        success: true,
        type: 'clipResult',
        data: result,
      };
    }

    return {
      success: false,
      error: '未知操作',
    };

  } catch (error) {
    log(`处理消息失败: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 剪藏页面到桌面应用
 * 通过 HTTP 请求或 IPC Socket 与主进程通信
 */
async function clipPageToApp(data) {
  // 方案1: 通过 HTTP 请求（需要桌面应用启动本地 HTTP 服务器）
  // 方案2: 通过 IPC Socket（需要桌面应用启动 IPC 服务器）
  // 方案3: 通过文件系统（写入临时文件，主进程监听文件变化）

  // 这里使用方案1：HTTP 请求
  const axios = require('axios');

  try {
    const response = await axios.post('http://localhost:23456/api/clip', {
      title: data.title,
      type: data.type || 'web_clip',
      content: data.content,
      url: data.url,
      tags: data.tags || [],
      excerpt: data.excerpt || '',
      author: data.author || '',
      date: data.date || new Date().toISOString(),
      domain: data.domain || '',
      autoIndex: data.autoIndex !== false,
    }, {
      timeout: 10000,
    });

    if (response.data && response.data.success) {
      return {
        id: response.data.data.id,
        title: response.data.data.title,
      };
    } else {
      throw new Error(response.data?.error || '剪藏失败');
    }

  } catch (error) {
    log(`剪藏失败: ${error.message}`);

    // 如果 HTTP 请求失败，可能是桌面应用未运行
    if (error.code === 'ECONNREFUSED') {
      throw new Error('无法连接到 ChainlessChain，请确保桌面应用正在运行');
    }

    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  log('Native Messaging Host 启动');

  // 设置为二进制模式
  if (process.platform === 'win32') {
    require('child_process').execSync('chcp 65001'); // UTF-8
  }

  process.stdin.setEncoding('utf8');
  process.stdout.setEncoding('utf8');

  try {
    while (true) {
      // 读取消息
      const message = await readMessage();

      if (message === null) {
        // EOF，退出
        log('收到 EOF，退出');
        break;
      }

      // 处理消息
      const response = await handleMessage(message);

      // 发送响应
      sendMessage(response);
    }

  } catch (error) {
    log(`错误: ${error.message}`);
    log(error.stack);
  }

  log('Native Messaging Host 退出');
  process.exit(0);
}

// 启动
main();
