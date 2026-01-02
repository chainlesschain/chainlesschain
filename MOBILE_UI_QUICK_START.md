# ChainlessChain 移动端UI快速开始指南

**版本**: v1.0.0
**更新日期**: 2026-01-03
**适用范围**: 移动端交易系统UI

---

## 🚀 5分钟快速上手

### 1. 环境准备

确保已安装：
- Node.js 16+
- npm 或 yarn

### 2. 安装依赖

```bash
cd mobile-app-uniapp
npm install
```

### 3. 启动开发服务器

```bash
# 微信小程序
npm run dev:mp-weixin

# H5（浏览器预览）
npm run dev:h5

# App
npm run dev:app
```

### 4. 在IDE中打开

- **微信小程序**: 使用微信开发者工具打开 `dist/dev/mp-weixin`
- **H5**: 浏览器访问 `http://localhost:8080`

---

## 📱 5个核心页面

### 1. 资产管理 (`/pages/trade/assets/index`)

**功能**:
- 查看所有资产（Token/NFT/Points/Bond）
- 创建新资产
- 转账
- 查看转账历史

**快速测试**:
1. 点击右上角"+"按钮
2. 选择资产类型（Token）
3. 填写：
   - 名称: Bitcoin
   - 符号: BTC
   - 总供应量: 21000000
   - 初始余额: 10
4. 点击"创建"

---

### 2. 市场交易 (`/pages/trade/market/index`)

**功能**:
- 查看买单/卖单列表
- 创建订单
- 匹配订单（购买/出售）
- 取消订单

**快速测试**:
1. 点击右上角"+"按钮
2. 选择订单类型（卖单）
3. 填写：
   - 标题: BTC出售
   - 资产: 选择之前创建的BTC
   - 单价: 50000
   - 数量: 1
4. 点击"创建"
5. 切换到买单标签，点击订单"购买"

---

### 3. 智能合约 (`/pages/trade/contracts/index`)

**功能**:
- 创建智能合约
- 多方签署
- 自动激活
- 执行合约

**快速测试**:
1. 点击右上角"+"按钮
2. 填写：
   - 标题: BTC/USDT交换合约
   - 合约类型: 简单交易
   - 托管类型: 简单托管
   - 参与方: did:example:alice,did:example:bob
   - 条款: `{"assetA":"asset_btc","amountA":1,"assetB":"asset_usdt","amountB":50000}`
3. 点击"创建"
4. 点击合约卡片，查看详情
5. 点击"签署合约"

---

### 4. 社交交易 (`/pages/trade/social/index`)

**功能**:
- 发布交易分享
- 点赞/评论
- 关注交易员
- 查看热门动态

**快速测试**:
1. 点击右上角"+"按钮
2. 选择类型（订单）
3. 填写：
   - 标题: 看涨BTC，突破关键阻力位
   - 描述: 技术面显示强势上涨信号
   - 入场价格: 50000
   - 目标价格: 55000
   - 止损价格: 48000
   - 标签: BTC,做多,日内
4. 点击"发布"
5. 点击❤️图标点赞
6. 点击💬图标评论

---

### 5. 用户中心 (`/pages/trade/user/index`)

**功能**:
- 查看用户等级和经验
- 每日签到
- 完成任务
- 查看里程碑
- 积分兑换

**快速测试**:
1. 点击右上角"签到"按钮
2. 切换到"任务"标签
3. 查看任务进度
4. 切换到"里程碑"标签
5. 查看成就进度
6. 切换到"奖励"标签
7. 查看可兑换奖励

---

## 🎨 UI设计说明

### 颜色主题

所有页面使用统一的紫色渐变主题：

```scss
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

**状态颜色**:
- 成功: `#52c41a` (绿色)
- 警告: `#fa8c16` (橙色)
- 错误: `#ff4d4f` (红色)
- 信息: `#1890ff` (蓝色)

### 布局结构

每个页面包含：
1. **Header** - 渐变色标题栏，右侧操作按钮
2. **Stats Card** - 统计数据卡片
3. **Tabs** - 标签页切换
4. **Content** - 滚动内容区（支持下拉刷新）
5. **Modals** - 模态弹窗（创建、详情等）

---

## 🔧 常见操作

### 创建资产

```javascript
// 页面：资产管理
// 步骤：
1. 点击右上角"+"按钮
2. 选择资产类型
3. 填写表单
4. 点击"创建"

// API调用：
await assetManager.createAsset({
  type: 'token',
  symbol: 'BTC',
  name: 'Bitcoin',
  totalSupply: 21000000,
  initialBalance: 10
})
```

### 创建订单

```javascript
// 页面：市场交易
// 步骤：
1. 点击右上角"+"按钮
2. 选择订单类型（买单/卖单）
3. 选择资产
4. 输入价格和数量
5. 点击"创建"

// API调用：
await marketplace.createOrder({
  type: 'sell',
  title: 'BTC出售',
  assetId: 'asset_xxx',
  priceAmount: 50000,
  quantity: 1
})
```

### 签署合约

```javascript
// 页面：智能合约
// 步骤：
1. 点击合约卡片查看详情
2. 点击"签署合约"按钮
3. 输入签名（可选）
4. 点击"确认签署"

// API调用：
await contractEngine.signContract(
  contractId,
  'signature-data'
)
```

### 发布动态

```javascript
// 页面：社交交易
// 步骤：
1. 点击右上角"+"按钮
2. 选择动态类型
3. 填写标题和描述
4. 如果是交易类型，填写价格信息
5. 添加标签
6. 点击"发布"

// API调用：
await socialTrading.createShare({
  type: 'order',
  title: '看涨BTC',
  description: '突破关键阻力位',
  price: 50000,
  targetPrice: 55000,
  stopLoss: 48000,
  tags: ['BTC', '做多', '日内']
})
```

### 每日签到

```javascript
// 页面：用户中心
// 步骤：
1. 点击右上角"签到"按钮
2. 查看签到奖励

// API调用：
const result = await incentiveManager.checkIn(userDid)
// result: { consecutiveDays: 3, rewardPoints: 30 }
```

---

## ⚠️ 常见问题

### Q1: 页面无法加载数据？

**原因**: 后端服务未初始化

**解决**:
1. 检查数据库服务是否启动
2. 检查DIDManager是否正确初始化
3. 查看控制台错误日志

```javascript
// 在浏览器控制台查看
console.log('[PageName] 服务初始化成功')
```

### Q2: 创建资产/订单失败？

**原因**: 参数验证失败

**解决**:
1. 检查所有必填字段是否填写
2. 检查数值类型是否正确（不能为负数）
3. 检查DID格式是否正确

### Q3: 合约无法激活？

**原因**: 签名数量不足

**解决**:
1. 检查所有参与方是否都已签署
2. 合约需要所有参与方签署后才能自动激活

### Q4: 点赞/评论失败？

**原因**: 网络请求失败

**解决**:
1. 检查网络连接
2. 查看API响应错误信息
3. 重试操作

---

## 🐛 调试技巧

### 启用调试日志

所有Manager都有详细的日志输出：

```javascript
console.log('[AssetManager] ✓ 资产已创建:', asset.id)
console.log('[MarketplaceManager] ✓ 订单已创建:', order.id)
console.log('[ContractEngine] 创建合约:', contract.id)
```

在浏览器控制台搜索这些日志即可追踪操作流程。

### 查看网络请求

打开浏览器开发者工具 → Network标签，查看：
- 请求URL
- 请求参数
- 响应数据
- 错误信息

### 数据库查看

```javascript
// 在控制台执行
const db = await getDatabase()
const result = await db.executeSql('SELECT * FROM assets', [])
console.log(result)
```

---

## 📊 性能优化建议

### 1. 列表优化

使用虚拟滚动处理长列表：

```vue
<scroll-view
  scroll-y
  enable-back-to-top
  :show-scrollbar="false"
>
  <view v-for="item in list" :key="item.id">
    ...
  </view>
</scroll-view>
```

### 2. 图片优化

使用懒加载和压缩：

```vue
<image
  :src="imageUrl"
  mode="aspectFill"
  lazy-load
/>
```

### 3. 数据缓存

使用uni-app的storage缓存数据：

```javascript
// 保存
uni.setStorageSync('cache_key', data)

// 读取
const data = uni.getStorageSync('cache_key')
```

---

## 🔗 相关文档

### 官方文档
- [uni-app文档](https://uniapp.dcloud.io/)
- [Vue3文档](https://v3.vuejs.org/)

### 项目文档
- `MOBILE_UI_SESSION_2026-01-03.md` - 会话完成报告
- `/tmp/mobile_ui_summary.md` - UI实现总结
- `QUICK_REFERENCE_MOBILE_TRADE.md` - 后端API快速参考

### 后端API
- `mobile-app-uniapp/src/services/trade/` - 6个Manager源码
- `mobile-app-uniapp/test/integration-test-real.js` - 集成测试参考

---

## 📞 获取帮助

### 遇到问题？

1. **查看控制台日志**: 大部分问题都会有详细的错误日志
2. **检查网络请求**: 查看API调用是否成功
3. **查看文档**: 参考上面的相关文档
4. **测试API**: 运行集成测试验证后端功能

### 快速测试后端

```bash
cd mobile-app-uniapp
node test/integration-test-real.js
```

如果所有测试通过，说明后端功能正常。

---

## 🎯 下一步

### 推荐学习路径

1. **了解基础**: 阅读uni-app和Vue3文档
2. **熟悉API**: 查看6个Manager的源码
3. **运行测试**: 执行集成测试了解API用法
4. **修改UI**: 尝试修改颜色、布局等
5. **添加功能**: 基于现有页面添加新功能

### 实战任务

- [ ] 修改主题颜色为蓝色系
- [ ] 添加资产搜索功能
- [ ] 添加订单筛选功能
- [ ] 优化加载动画
- [ ] 添加错误提示优化

---

## 🌟 快速命令参考

```bash
# 开发
npm run dev:h5              # H5开发
npm run dev:mp-weixin       # 微信小程序开发
npm run dev:app             # App开发

# 构建
npm run build:h5            # H5构建
npm run build:mp-weixin     # 微信小程序构建
npm run build:app           # App构建

# 测试
node test/integration-test-real.js  # 运行集成测试

# 调试
npm run dev:h5 -- --debug   # 启用调试模式
```

---

**快速开始指南版本**: v1.0.0
**最后更新**: 2026-01-03
**状态**: ✅ 可用

🎊 **祝你使用愉快！** 🎊
