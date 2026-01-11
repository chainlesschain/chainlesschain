#!/usr/bin/env node

/**
 * STUN/TURN服务器连接测试脚本
 *
 * 测试本地coturn服务器的STUN和TURN功能
 */

const dgram = require('dgram');
const crypto = require('crypto');

// STUN消息类型
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;

// STUN属性类型
const STUN_ATTR_MAPPED_ADDRESS = 0x0001;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

// STUN Magic Cookie
const STUN_MAGIC_COOKIE = 0x2112A442;

// 配置
const STUN_SERVER = process.env.STUN_SERVER || 'localhost';
const STUN_PORT = parseInt(process.env.STUN_PORT || '3478');
const TURN_SERVER = process.env.TURN_SERVER || 'localhost';
const TURN_PORT = parseInt(process.env.TURN_PORT || '3478');
const TURN_USERNAME = process.env.TURN_USERNAME || 'chainlesschain';
const TURN_PASSWORD = process.env.TURN_PASSWORD || 'chainlesschain2024';

/**
 * 创建STUN Binding Request消息
 */
function createStunBindingRequest() {
  const transactionId = crypto.randomBytes(12);
  const buffer = Buffer.alloc(20);

  // Message Type (2 bytes)
  buffer.writeUInt16BE(STUN_BINDING_REQUEST, 0);

  // Message Length (2 bytes) - 不包含20字节头部
  buffer.writeUInt16BE(0, 2);

  // Magic Cookie (4 bytes)
  buffer.writeUInt32BE(STUN_MAGIC_COOKIE, 4);

  // Transaction ID (12 bytes)
  transactionId.copy(buffer, 8);

  return { buffer, transactionId };
}

/**
 * 解析STUN响应消息
 */
function parseStunResponse(buffer, transactionId) {
  if (buffer.length < 20) {
    throw new Error('响应消息太短');
  }

  const messageType = buffer.readUInt16BE(0);
  const messageLength = buffer.readUInt16BE(2);
  const magicCookie = buffer.readUInt32BE(4);
  const responseTransactionId = buffer.slice(8, 20);

  // 验证Magic Cookie
  if (magicCookie !== STUN_MAGIC_COOKIE) {
    throw new Error('无效的Magic Cookie');
  }

  // 验证Transaction ID
  if (!responseTransactionId.equals(transactionId)) {
    throw new Error('Transaction ID不匹配');
  }

  // 验证消息类型
  if (messageType !== STUN_BINDING_RESPONSE) {
    throw new Error(`意外的消息类型: 0x${messageType.toString(16)}`);
  }

  // 解析属性
  let offset = 20;
  const attributes = {};

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) break;

    const attrType = buffer.readUInt16BE(offset);
    const attrLength = buffer.readUInt16BE(offset + 2);
    offset += 4;

    if (offset + attrLength > buffer.length) break;

    const attrValue = buffer.slice(offset, offset + attrLength);

    if (attrType === STUN_ATTR_MAPPED_ADDRESS) {
      attributes.mappedAddress = parseMappedAddress(attrValue);
    } else if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS) {
      attributes.xorMappedAddress = parseXorMappedAddress(attrValue, transactionId);
    }

    // 属性值需要4字节对齐
    offset += attrLength;
    const padding = (4 - (attrLength % 4)) % 4;
    offset += padding;
  }

  return attributes;
}

/**
 * 解析MAPPED-ADDRESS属性
 */
function parseMappedAddress(buffer) {
  if (buffer.length < 8) {
    throw new Error('MAPPED-ADDRESS属性太短');
  }

  const family = buffer.readUInt8(1);
  const port = buffer.readUInt16BE(2);

  if (family === 0x01) { // IPv4
    const ip = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
    return { ip, port };
  } else if (family === 0x02) { // IPv6
    // IPv6解析（简化版）
    const parts = [];
    for (let i = 4; i < 20; i += 2) {
      parts.push(buffer.readUInt16BE(i).toString(16));
    }
    const ip = parts.join(':');
    return { ip, port };
  }

  throw new Error('不支持的地址族');
}

/**
 * 解析XOR-MAPPED-ADDRESS属性
 */
function parseXorMappedAddress(buffer, transactionId) {
  if (buffer.length < 8) {
    throw new Error('XOR-MAPPED-ADDRESS属性太短');
  }

  const family = buffer.readUInt8(1);
  const xorPort = buffer.readUInt16BE(2);
  const port = xorPort ^ (STUN_MAGIC_COOKIE >> 16);

  if (family === 0x01) { // IPv4
    const xorIp = buffer.readUInt32BE(4);
    const ip = xorIp ^ STUN_MAGIC_COOKIE;
    const ipStr = `${(ip >> 24) & 0xFF}.${(ip >> 16) & 0xFF}.${(ip >> 8) & 0xFF}.${ip & 0xFF}`;
    return { ip: ipStr, port };
  } else if (family === 0x02) { // IPv6
    // IPv6 XOR解析（简化版）
    const xorKey = Buffer.alloc(16);
    Buffer.from([
      (STUN_MAGIC_COOKIE >> 24) & 0xFF,
      (STUN_MAGIC_COOKIE >> 16) & 0xFF,
      (STUN_MAGIC_COOKIE >> 8) & 0xFF,
      STUN_MAGIC_COOKIE & 0xFF
    ]).copy(xorKey, 0);
    transactionId.copy(xorKey, 4);

    const ipBuffer = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      ipBuffer[i] = buffer[4 + i] ^ xorKey[i];
    }

    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(ipBuffer.readUInt16BE(i).toString(16));
    }
    const ip = parts.join(':');
    return { ip, port };
  }

  throw new Error('不支持的地址族');
}

/**
 * 测试STUN服务器
 */
async function testStunServer() {
  console.log('\n=== 测试STUN服务器 ===');
  console.log(`服务器: ${STUN_SERVER}:${STUN_PORT}`);

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('STUN请求超时'));
    }, 5000);

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.close();
      reject(err);
    });

    socket.on('message', (msg) => {
      clearTimeout(timeout);

      try {
        const { buffer, transactionId } = createStunBindingRequest();
        const attributes = parseStunResponse(msg, transactionId);

        console.log('✓ STUN服务器响应成功');

        if (attributes.mappedAddress) {
          console.log(`  映射地址: ${attributes.mappedAddress.ip}:${attributes.mappedAddress.port}`);
        }

        if (attributes.xorMappedAddress) {
          console.log(`  XOR映射地址: ${attributes.xorMappedAddress.ip}:${attributes.xorMappedAddress.port}`);
        }

        socket.close();
        resolve(attributes);
      } catch (err) {
        socket.close();
        reject(err);
      }
    });

    const { buffer } = createStunBindingRequest();
    socket.send(buffer, STUN_PORT, STUN_SERVER, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        reject(err);
      }
    });
  });
}

/**
 * 测试TURN服务器（简化版）
 */
async function testTurnServer() {
  console.log('\n=== 测试TURN服务器 ===');
  console.log(`服务器: ${TURN_SERVER}:${TURN_PORT}`);
  console.log(`用户名: ${TURN_USERNAME}`);

  // 注意：完整的TURN测试需要实现TURN协议的认证机制
  // 这里只做基本的连接测试

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('TURN请求超时'));
    }, 5000);

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.close();
      reject(err);
    });

    socket.on('message', (msg) => {
      clearTimeout(timeout);

      // 简单验证：如果收到响应，说明TURN服务器在运行
      console.log('✓ TURN服务器响应成功');
      console.log(`  响应长度: ${msg.length} 字节`);

      socket.close();
      resolve(true);
    });

    // 发送STUN Binding Request到TURN端口
    const { buffer } = createStunBindingRequest();
    socket.send(buffer, TURN_PORT, TURN_SERVER, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        reject(err);
      }
    });
  });
}

/**
 * 测试WebRTC ICE连接
 */
async function testWebRTCConnection() {
  console.log('\n=== 测试WebRTC ICE配置 ===');

  const iceServers = [
    {
      urls: `stun:${STUN_SERVER}:${STUN_PORT}`
    },
    {
      urls: `turn:${TURN_SERVER}:${TURN_PORT}`,
      username: TURN_USERNAME,
      credential: TURN_PASSWORD
    }
  ];

  console.log('ICE服务器配置:');
  console.log(JSON.stringify(iceServers, null, 2));

  // 注意：完整的WebRTC测试需要浏览器环境或node-webrtc库
  console.log('\n提示: 完整的WebRTC测试需要在浏览器环境中进行');
  console.log('可以访问 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/');
  console.log('使用上述配置进行测试');

  return iceServers;
}

/**
 * 主函数
 */
async function main() {
  console.log('ChainlessChain STUN/TURN服务器测试');
  console.log('=====================================');

  try {
    // 测试STUN服务器
    await testStunServer();

    // 测试TURN服务器
    await testTurnServer();

    // 显示WebRTC配置
    await testWebRTCConnection();

    console.log('\n✓ 所有测试通过！');
    console.log('\n下一步:');
    console.log('1. 确保Docker容器正在运行: docker-compose up -d coturn');
    console.log('2. 在桌面应用中配置STUN/TURN服务器');
    console.log('3. 测试P2P连接功能');

    process.exit(0);
  } catch (err) {
    console.error('\n✗ 测试失败:', err.message);
    console.error('\n故障排查:');
    console.error('1. 检查coturn容器是否运行: docker ps | grep coturn');
    console.error('2. 查看coturn日志: docker logs chainlesschain-coturn');
    console.error('3. 验证端口是否开放: netstat -an | grep 3478');
    console.error('4. 检查防火墙设置');

    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  main();
}

module.exports = {
  testStunServer,
  testTurnServer,
  testWebRTCConnection
};
