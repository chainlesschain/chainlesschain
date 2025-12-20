# DID身份系统 - 快速入门

## 🚀 快速开始

### 1. 安装依赖
```bash
cd mobile-app-uniapp
npm install
```

### 2. 运行项目

**H5模式：**
```bash
npm run dev:h5
```
访问：http://localhost:8080

**微信小程序：**
```bash
npm run dev:mp-weixin
```
使用微信开发者工具打开 `dist/dev/mp-weixin`

**App模式：**
```bash
npm run dev:app
```
使用HBuilderX打开项目

---

## 📱 使用DID功能

### 方式一：直接访问身份管理页面

在浏览器中打开：
```
http://localhost:8080/#/pages/identity/list
```

### 方式二：从"我的"页面进入

1. 打开应用
2. 点击底部 "我的" 标签
3. 找到"我的身份"入口（需要在mine页面添加）
4. 进入身份管理

---

## 🎯 功能演示

### 创建第一个DID身份

1. **进入创建页面**
   ```
   http://localhost:8080/#/pages/identity/create
   ```

2. **填写信息**
   - 昵称：`Alice`
   - 个人简介：`区块链爱好者`（可选）
   - PIN码：`123456`
   - 确认PIN码：`123456`

3. **点击"生成DID"**
   - 等待2-3秒
   - 生成成功后会显示完整DID
   - 格式：`did:chainlesschain:5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty`

4. **查看身份列表**
   - 点击"查看我的身份"
   - 或返回 `/pages/identity/list`

### 查看身份详情

1. 在身份列表中点击任意身份卡片
2. 弹出详情弹窗，显示：
   - 完整DID标识符
   - 昵称
   - 个人简介
   - 签名公钥
   - 加密公钥

### 设置默认身份

1. 打开身份详情
2. 点击"设为默认"按钮
3. 该身份会标记为默认（显示"默认"徽章）

### 导出身份备份

1. 打开身份详情
2. 点击"导出身份"
3. H5模式：自动下载JSON文件
4. App模式：复制到剪贴板

---

## 🧪 测试DID核心功能

### 在浏览器控制台测试

打开浏览器开发者工具（F12），在Console中执行：

```javascript
// 1. 导入服务
const didService = require('@/services/did.js').default
const database = require('@/services/database.js').default

// 2. 初始化数据库
await database.init('123456')

// 3. 生成DID
const result = await didService.generateDID('Bob', '123456', '测试用户')
console.log('生成的DID:', result.did)

// 4. 签名测试
const data = { message: 'Hello World', timestamp: Date.now() }
const signature = await didService.signData(result.did, data, '123456')
console.log('签名:', signature)

// 5. 验证签名
const isValid = await didService.verifySignature(result.did, data, signature)
console.log('签名验证:', isValid) // 应该输出 true

// 6. 查看所有身份
const identities = await database.getAllIdentities()
console.log('所有身份:', identities)
```

---

## 🔐 DID使用场景

### 场景1：添加好友

```javascript
// 生成DID二维码数据
const qrData = await didService.generateQRCode(myDID)
console.log('二维码数据:', JSON.stringify(qrData))

// 对方扫码后解析
const friendInfo = didService.parseDIDFromQR(qrData)
console.log('好友信息:', friendInfo)
```

### 场景2：加密消息

```javascript
// Alice给Bob发送加密消息
const aliceDID = 'did:chainlesschain:Alice...'
const bobDID = 'did:chainlesschain:Bob...'

// Alice加密
const encrypted = await didService.encryptFor(
  bobDID,
  '这是一条秘密消息',
  aliceDID,
  '123456' // Alice的PIN码
)

console.log('加密后:', encrypted)

// Bob解密
const decrypted = await didService.decrypt(
  encrypted,
  bobDID,
  '123456' // Bob的PIN码
)

console.log('解密后:', decrypted) // '这是一条秘密消息'
```

### 场景3：数字签名文档

```javascript
// 签名一个知识条目
const knowledge = {
  id: 'k123',
  title: '我的笔记',
  content: '这是笔记内容',
  author: myDID,
  timestamp: Date.now()
}

// 签名
const signature = await didService.signData(myDID, knowledge, '123456')

// 附加签名到文档
const signedKnowledge = {
  ...knowledge,
  signature
}

// 其他人验证
const isAuthentic = await didService.verifySignature(
  signedKnowledge.author,
  {
    id: signedKnowledge.id,
    title: signedKnowledge.title,
    content: signedKnowledge.content,
    author: signedKnowledge.author,
    timestamp: signedKnowledge.timestamp
  },
  signedKnowledge.signature
)

console.log('文档真实性:', isAuthentic)
```

---

## 📊 数据库查询

### 查看数据库内容（H5模式）

在浏览器控制台：

```javascript
// 查看localStorage中的所有DID数据
const dbData = uni.getStorageSync('chainlesschain_db')
const parsed = JSON.parse(dbData)
console.log('DID身份:', parsed.identities)
console.log('DID服务:', parsed.did_services)
```

### 数据库操作示例

```javascript
// 获取特定DID
const identity = await database.getIdentity('did:chainlesschain:...')
console.log(identity)

// 获取默认身份
const defaultIdentity = await database.getDefaultIdentity()
console.log('默认身份:', defaultIdentity)

// 更新昵称
await database.updateIdentity('did:chainlesschain:...', {
  nickname: '新昵称',
  bio: '更新后的简介'
})

// 删除身份（软删除）
await database.deleteIdentity('did:chainlesschain:...')
```

---

## 🛠 开发提示

### 调试模式

在 `services/did.js` 中已添加详细日志：
- ✅ DID生成成功
- ❌ DID生成失败
- 🔐 加密/解密操作

查看控制台即可看到详细信息。

### 常见问题

**Q: PIN码忘记了怎么办？**
A: 目前无法找回，建议：
- 定期导出备份
- 使用助记词（待实现）
- 启用生物识别（待实现）

**Q: H5和App数据能同步吗？**
A: 不能自动同步，需要：
- 方案1：导出/导入身份
- 方案2：使用云同步（待实现）

**Q: 可以有多个身份吗？**
A: 可以！每个身份独立管理，可设置默认身份。

---

## 📚 API文档

详见：`services/did.js` 中的JSDoc注释

核心方法：
- `generateDID(nickname, pin, bio, avatarPath)` - 生成DID
- `signData(did, data, pin)` - 数字签名
- `verifySignature(did, data, signature)` - 验证签名
- `encryptFor(recipientDID, data, senderDID, pin)` - 加密
- `decrypt(encryptedData, recipientDID, pin)` - 解密
- `exportDID(did, pin)` - 导出备份
- `importDID(encryptedData, pin)` - 导入备份
- `generateQRCode(did)` - 生成二维码数据
- `parseDIDFromQR(qrData)` - 解析二维码

---

## 🎉 下一步

- [ ] 集成到"我的"页面
- [ ] 添加好友时扫描DID二维码
- [ ] 使用DID签名知识条目
- [ ] 使用DID加密私密消息
- [ ] 实现助记词恢复
- [ ] 添加生物识别认证

---

**文档更新：** 2025-12-20
**维护者：** ChainlessChain Team
