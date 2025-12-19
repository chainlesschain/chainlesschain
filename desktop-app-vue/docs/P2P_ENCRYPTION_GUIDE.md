# P2P 端到端加密消息系统使用指南

## 概述

ChainlessChain 的 P2P 加密消息系统基于 **Signal 协议** 实现端到端加密通信,提供以下特性:

- **端到端加密**: 使用 Signal 协议 (X3DH + Double Ratchet) 确保消息安全
- **前向保密**: 即使密钥泄露,历史消息也无法解密
- **后向保密**: 丢失的消息密钥不影响未来消息
- **去中心化**: 基于 libp2p 实现 P2P 通信,无需中心服务器
- **自动密钥交换**: 首次通信时自动协商加密密钥

## 技术架构

### 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │           P2PMessaging.vue (UI)                  │   │
│  └──────────────────────────────────────────────────┘   │
│                        │ IPC                             │
└────────────────────────┼─────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────────┐
│                    Main Process                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              P2PManager                          │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │     SignalSessionManager                 │   │   │
│  │  │  - X3DH 密钥交换                         │   │   │
│  │  │  - Double Ratchet 加密                   │   │   │
│  │  │  - 身份密钥管理                          │   │   │
│  │  │  - 预密钥生成                            │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  │                                                   │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │        libp2p Network                    │   │   │
│  │  │  - TCP Transport                         │   │   │
│  │  │  - Noise Protocol (传输层加密)           │   │   │
│  │  │  - mDNS (本地发现)                       │   │   │
│  │  │  - Kad-DHT (网络发现)                    │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Signal 协议实现

#### 1. X3DH 密钥交换

X3DH (Extended Triple Diffie-Hellman) 用于初始密钥协商:

```javascript
// 生成预密钥包
const preKeyBundle = {
  registrationId: 12345,
  identityKey: <公钥>,
  signedPreKey: {
    keyId: 1,
    publicKey: <公钥>,
    signature: <签名>
  },
  preKey: {
    keyId: 100,
    publicKey: <公钥>
  }
};

// 处理预密钥包,建立会话
await signalManager.processPreKeyBundle(recipientId, deviceId, preKeyBundle);
```

#### 2. Double Ratchet 算法

用于持续的消息加密,提供前向保密和后向保密:

```javascript
// 加密消息
const ciphertext = await signalManager.encryptMessage(recipientId, deviceId, plaintext);
// ciphertext = {
//   type: 1 | 3,  // 1: PreKeyWhisperMessage, 3: WhisperMessage
//   body: <密文>,
//   registrationId: 12345
// }

// 解密消息
const plaintext = await signalManager.decryptMessage(senderId, deviceId, ciphertext);
```

## 快速开始

### 1. 启动应用

启动 ChainlessChain 后,P2P 网络会自动初始化:

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

### 2. 访问 P2P 消息界面

在顶部菜单栏点击 **消息图标** 或直接访问路由:

```javascript
router.push('/p2p-messaging');
```

### 3. 连接到对等节点

有两种方式发现和连接对等节点:

#### 方式 1: 本地网络自动发现 (mDNS)

在同一局域网内的节点会自动相互发现并连接。

#### 方式 2: 手动连接

输入对方的 Multiaddr 地址:

```
/ip4/192.168.1.100/tcp/9000/p2p/QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 4. 建立加密会话

连接到节点后,需要进行密钥交换才能发送加密消息:

1. 在节点列表中找到目标节点
2. 点击 **"建立加密"** 按钮
3. 等待密钥交换完成
4. 加密会话建立后,可以开始聊天

### 5. 发送加密消息

1. 点击 **"聊天"** 按钮打开聊天窗口
2. 输入消息内容
3. 按 Enter 或点击 **"发送"** 按钮
4. 消息会自动使用 Signal 协议加密后发送

## API 参考

### IPC 接口

#### 获取节点信息

```javascript
const nodeInfo = await window.electronAPI.p2p.getNodeInfo();
// 返回: {
//   peerId: "QmXXX...",
//   addresses: ["/ip4/..."],
//   connectedPeers: 3,
//   peers: [...]
// }
```

#### 连接到节点

```javascript
await window.electronAPI.p2p.connect(multiaddr);
```

#### 发起密钥交换

```javascript
await window.electronAPI.p2p.initiateKeyExchange(peerId);
```

#### 检查加密会话状态

```javascript
const hasSession = await window.electronAPI.p2p.hasEncryptedSession(peerId);
```

#### 发送加密消息

```javascript
await window.electronAPI.p2p.sendEncryptedMessage(peerId, message);
```

#### 监听消息事件

```javascript
// 接收加密消息
window.electronAPI.p2p.on('p2p:encrypted-message', (data) => {
  console.log('收到加密消息:', data.from, data.message);
});

// 密钥交换成功
window.electronAPI.p2p.on('p2p:key-exchange-success', (data) => {
  console.log('密钥交换成功:', data.peerId);
});

// 消息发送成功
window.electronAPI.p2p.on('p2p:encrypted-message-sent', (data) => {
  console.log('消息已发送:', data.to);
});
```

### 主进程 API

#### SignalSessionManager

```javascript
const SignalSessionManager = require('./p2p/signal-session-manager');

// 初始化
const signalManager = new SignalSessionManager({
  userId: 'user-id',
  deviceId: 1,
  dataPath: '/path/to/data'
});

await signalManager.initialize();

// 获取预密钥包
const preKeyBundle = await signalManager.getPreKeyBundle();

// 处理预密钥包
await signalManager.processPreKeyBundle(recipientId, deviceId, preKeyBundle);

// 加密消息
const ciphertext = await signalManager.encryptMessage(recipientId, deviceId, plaintext);

// 解密消息
const plaintext = await signalManager.decryptMessage(senderId, deviceId, ciphertext);

// 检查会话
const hasSession = await signalManager.hasSession(recipientId, deviceId);

// 删除会话
await signalManager.deleteSession(recipientId, deviceId);
```

#### P2PManager (集成 Signal)

```javascript
const P2PManager = require('./p2p/p2p-manager');

// 初始化 (自动初始化 Signal 管理器)
const p2pManager = new P2PManager({
  port: 9000,
  enableMDNS: true,
  enableDHT: true,
  dataPath: '/path/to/data'
});

await p2pManager.initialize();

// 发送加密消息 (自动处理密钥交换)
await p2pManager.sendEncryptedMessage(peerId, message);

// 监听加密消息
p2pManager.on('encrypted-message:received', (data) => {
  console.log('收到加密消息:', data.from, data.message);
});
```

## 安全性

### 加密强度

- **算法**: Signal 协议 (X3DH + Double Ratchet)
- **密钥长度**: Ed25519 (256-bit)
- **传输层**: Noise Protocol (额外的传输层加密)

### 身份验证

当前版本使用简化的信任模型。生产环境建议:

1. **验证身份密钥指纹**: 首次连接时通过其他可信渠道验证对方的公钥指纹
2. **实现 TOFU (Trust On First Use)**: 记录首次见到的公钥,后续连接时检测密钥变化
3. **集成 DID 系统**: 使用去中心化身份进行身份验证

### 数据存储

- 身份密钥和会话数据存储在 `{dataPath}/signal-identity.json`
- 建议使用 **SQLCipher** 加密存储敏感数据
- 定期备份密钥文件

## 故障排除

### 无法发现节点

**问题**: 同一局域网内的节点无法相互发现

**解决方案**:
1. 检查防火墙设置,允许 TCP 端口 9000
2. 确认 mDNS 已启用: `enableMDNS: true`
3. 某些网络环境可能阻止 mDNS,使用手动连接

### 密钥交换失败

**问题**: 提示 "密钥交换失败"

**解决方案**:
1. 确认双方节点都已正常初始化
2. 检查网络连接是否稳定
3. 重启应用重新尝试

### 消息发送失败

**问题**: 消息无法发送

**解决方案**:
1. 检查是否已建立加密会话
2. 确认目标节点在线
3. 查看控制台日志获取详细错误信息

### Signal 协议库加载失败

**问题**: 提示 "Failed to load Signal protocol library"

**解决方案**:
```bash
# 重新安装依赖
npm install @privacyresearch/libsignal-protocol-typescript --save
```

## 示例代码

### 完整的聊天应用示例

```vue
<template>
  <div>
    <div v-for="peer in peers" :key="peer.peerId">
      <button @click="chatWithPeer(peer)">
        Chat with {{ peer.peerId }}
      </button>
    </div>

    <div v-if="currentChat">
      <input v-model="messageText" @keyup.enter="sendMessage" />
      <button @click="sendMessage">Send</button>

      <div v-for="msg in messages" :key="msg.id">
        <p>{{ msg.content }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const peers = ref([]);
const currentChat = ref(null);
const messageText = ref('');
const messages = ref([]);

onMounted(async () => {
  // 加载节点列表
  peers.value = await window.electronAPI.p2p.getPeers();

  // 监听消息
  window.electronAPI.p2p.on('p2p:encrypted-message', (data) => {
    if (data.from === currentChat.value) {
      messages.value.push({
        id: Date.now(),
        content: data.message,
        isSent: false
      });
    }
  });
});

const chatWithPeer = async (peer) => {
  currentChat.value = peer.peerId;

  // 检查加密会话
  const hasSession = await window.electronAPI.p2p.hasEncryptedSession(peer.peerId);

  if (!hasSession) {
    // 建立加密会话
    await window.electronAPI.p2p.initiateKeyExchange(peer.peerId);
  }
};

const sendMessage = async () => {
  if (!messageText.value.trim()) return;

  await window.electronAPI.p2p.sendEncryptedMessage(
    currentChat.value,
    messageText.value
  );

  messages.value.push({
    id: Date.now(),
    content: messageText.value,
    isSent: true
  });

  messageText.value = '';
};
</script>
```

## 性能优化

### 预密钥管理

系统默认生成 100 个一次性预密钥。当预密钥数量不足时,自动生成新的:

```javascript
// 检查预密钥数量
const preKeyCount = signalManager.preKeys.size;

if (preKeyCount < 20) {
  // 生成新的预密钥
  await signalManager.generatePreKeys();
}
```

### 会话缓存

建立的 Signal 会话会自动缓存,避免重复密钥交换:

```javascript
// 会话会持久化到文件系统
// 下次启动时自动加载
```

## 开发与测试

### 本地测试

1. 启动两个应用实例:

```bash
# 终端 1: 端口 9000
npm run dev

# 终端 2: 端口 9001
PORT=9001 npm run dev
```

2. 使用 mDNS 自动发现或手动连接
3. 测试密钥交换和消息发送

### 单元测试

```javascript
// test/signal-session-manager.test.js
describe('SignalSessionManager', () => {
  it('should initialize successfully', async () => {
    const manager = new SignalSessionManager({
      userId: 'test-user',
      deviceId: 1
    });

    await manager.initialize();
    expect(manager.initialized).toBe(true);
  });

  it('should encrypt and decrypt messages', async () => {
    const alice = new SignalSessionManager({ userId: 'alice' });
    const bob = new SignalSessionManager({ userId: 'bob' });

    await alice.initialize();
    await bob.initialize();

    // Alice 获取 Bob 的预密钥包
    const bobPreKeyBundle = await bob.getPreKeyBundle();

    // Alice 建立会话
    await alice.processPreKeyBundle('bob', 1, bobPreKeyBundle);

    // Alice 发送消息
    const plaintext = 'Hello, Bob!';
    const ciphertext = await alice.encryptMessage('bob', 1, plaintext);

    // Bob 解密消息
    const decrypted = await bob.decryptMessage('alice', 1, ciphertext);

    expect(decrypted).toBe(plaintext);
  });
});
```

## 未来改进

- [ ] 群组消息支持 (Sender Keys)
- [ ] 离线消息队列
- [ ] 文件传输加密
- [ ] 视频/语音通话加密
- [ ] 与 DID 系统深度集成
- [ ] 消息持久化到数据库
- [ ] 消息已读回执
- [ ] 消息撤回功能
- [ ] Safety Number (安全码) 验证

## 参考资料

- [Signal Protocol 官方文档](https://signal.org/docs/)
- [libsignal-protocol-typescript](https://github.com/privacyresearch/libsignal-protocol-typescript)
- [libp2p 文档](https://docs.libp2p.io/)
- [X3DH 规范](https://signal.org/docs/specifications/x3dh/)
- [Double Ratchet 算法](https://signal.org/docs/specifications/doubleratchet/)

## 许可证

MIT License

## 技术支持

如有问题或建议,请联系:
- Email: zhanglongfa@chainlesschain.com
- GitHub: https://github.com/chainlesschain/chainlesschain
