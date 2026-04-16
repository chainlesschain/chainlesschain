# 交易辅助

> **核心功能 | 状态: ✅ 生产就绪 | AI 智能匹配 | 智能合约托管 | 去中心化信誉**

ChainlessChain 的去中心化交易辅助功能，让你无需依赖第三方平台，也能安全地进行交易。

## 概述

交易辅助模块是 ChainlessChain 的去中心化交易基础设施，通过 AI 智能匹配撮合买卖双方需求，利用智能合约实现资金托管和自动结算，结合 DID 身份绑定的链上信誉系统和风控引擎保障交易安全。所有交易通过 P2P 网络直接完成，无需依赖中心化第三方平台。

## 系统架构

```
┌──────────────────────────────────────────────┐
│              交易辅助层                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ 发布需求  │  │ AI 匹配  │  │ 交易管理    │ │
│  └─────┬────┘  └─────┬────┘  └─────┬──────┘ │
│        └─────────────┼─────────────┘         │
│                      ▼                       │
│  ┌────────────────────────────────────────┐  │
│  │          智能合约 (区块链层)             │  │
│  │  托管合约 │ 信誉合约 │ 仲裁合约        │  │
│  └────────────────────────────────────────┘  │
│                      │                       │
│  ┌──────────┐  ┌─────┴─────┐  ┌──────────┐ │
│  │ DID 身份  │  │ P2P 通信   │  │ 风控引擎  │ │
│  └──────────┘  └───────────┘  └──────────┘ │
└──────────────────────────────────────────────┘
```

## 核心模块

| 模块 | 说明 |
|------|------|
| 需求发布 | 商品/服务/数字资产多种交易类型 |
| AI 智能匹配 | 自动匹配买卖双方需求 |
| 智能合约托管 | 区块链保障资金安全 |
| 去中心化信誉 | 链上评价，不可篡改 |
| 社区仲裁 | DAO 投票解决交易纠纷 |
| 风控引擎 | 异常交易检测、反欺诈 |

## 核心特性

- 🤖 **AI智能匹配**: 自动匹配买卖双方需求
- 📝 **智能合约托管**: 区块链保障交易安全
- ⭐ **去中心化信誉**: 链上评价，防作弊
- ⚖️ **社区仲裁**: 公平解决交易纠纷
- 🔒 **隐私保护**: 必要信息才公开

## 发布交易需求

### 交易类型

支持多种交易类型：

1. **商品买卖**: 实物商品交易
2. **服务交易**: 技能服务交换
3. **租赁**: 物品/房屋租赁
4. **合作**: 项目合作、技能交换

### 发布商品

```
1. 点击"发布交易"
2. 选择"出售商品"
3. 填写商品信息:
   - 标题（必填）
   - 描述（AI可帮助优化）
   - 价格
   - 交付方式
   - 图片（最多9张）
4. 发布
```

### AI辅助撰写

让AI帮你优化商品描述：

```
原始输入:
"MacBook Pro 16寸 用了2年 95新 卖掉"

AI优化后:
【标题】
MacBook Pro 16英寸 2021款 M1 Pro 16GB 512GB 95成新

【描述】
▪ 型号: MacBook Pro 16" 2021
▪ 处理器: Apple M1 Pro 10核CPU
▪ 内存: 16GB
▪ 存储: 512GB SSD
▪ 成色: 95成新，屏幕完美无划痕
▪ 配件: 原装充电器、原包装盒
▪ 保修: 官方保修剩余3个月

【价格建议】
根据市场行情，建议价格: ¥12,000 - ¥13,500

【注意事项】
- 支持当面验机
- 可提供购买发票
- 成都同城优先
```

### 定价建议

AI会根据历史交易数据给出定价建议：

```typescript
interface PriceSuggestion {
  suggestedMin: number; // 建议最低价
  suggestedMax: number; // 建议最高价
  averagePrice: number; // 平均成交价
  similarListings: []; // 相似商品
  confidence: number; // 建议可信度 0-1
}
```

## 需求匹配

### 浏览市场

```
[市场广场]
├─ 全部分类
│  ├─ 数码产品
│  ├─ 生活用品
│  ├─ 服务技能
│  └─ 其他
├─ 筛选条件
│  ├─ 价格区间
│  ├─ 地理位置
│  └─ 信誉评分
└─ 排序方式
   ├─ 最新发布
   ├─ 价格由低到高
   └─ AI推荐（个性化）
```

### AI智能推荐

系统会根据你的兴趣推荐相关商品：

```python
# 推荐算法
def recommend_listings(user_profile, query):
    # 1. 向量化用户查询
    query_embedding = embed(query)

    # 2. 检索相似商品
    similar_items = vector_search(query_embedding, top_k=50)

    # 3. 过滤：价格、位置、信誉
    filtered = filter(similar_items, user_preferences)

    # 4. AI重排序
    ranked = rerank(filtered, user_history)

    return ranked[:10]
```

### 搜索功能

强大的搜索功能：

```
搜索: "二手 MacBook M1 成都"

结果:
✓ 关键词匹配: MacBook, M1
✓ 地理位置: 成都
✓ 语义理解: 二手 → 成色 < 全新
```

## 交易流程

### 1. 意向沟通

```
买家发现感兴趣的商品
    ↓
点击"联系卖家"
    ↓
进入加密聊天（Signal协议）
    ↓
双方协商细节:
  - 价格
  - 交付方式
  - 验货条件
  - 售后服务
```

### 2. 创建合约

达成一致后，创建智能合约：

```
1. 选择合约模板:
   ○ 一手交钱一手交货（当面）
   ● 款到发货（邮寄）
   ○ 分期付款
   ○ 自定义合约

2. 填写合约条款:
   - 商品描述
   - 成交价格
   - 交付时间
   - 质量保证
   - 退换货政策

3. 双方审阅签名:
   买家签名: [U盾/SIMKey]
   卖家签名: [U盾/SIMKey]

4. 合约生效
```

### 3. 资金托管

#### 加密货币托管

```solidity
// 智能合约自动托管
contract EscrowContract {
    address buyer;
    address seller;
    uint256 amount;

    // 买家支付到合约
    function deposit() public payable {
        require(msg.sender == buyer);
        amount = msg.value;
    }

    // 买家确认收货，释放给卖家
    function release() public {
        require(msg.sender == buyer);
        payable(seller).transfer(amount);
    }

    // 发起争议，冻结资金
    function dispute() public {
        require(msg.sender == buyer || msg.sender == seller);
        // 进入仲裁流程
    }
}
```

#### 支持的加密货币

| 货币 | 链       | 手续费 | 到账时间  |
| ---- | -------- | ------ | --------- |
| ETH  | Ethereum | ~$5    | 1-5分钟   |
| USDT | Polygon  | ~$0.01 | 10秒      |
| USDC | Polygon  | ~$0.01 | 10秒      |
| BTC  | Bitcoin  | ~$1    | 10-60分钟 |

#### 法币托管（可选）

如果双方都信任某个第三方：

```
1. 选择受信任的托管服务
2. 买家转账到托管账户
3. 卖家发货
4. 买家确认后，托管方放款
```

### 4. 交付与验收

#### 物流跟踪

```
卖家上传发货凭证:
  - 快递单号
  - 包裹照片
  - 物流公司

系统自动追踪:
  - 查询物流状态
  - 异常自动提醒
  - 到货通知

买家验货:
  - 拍照记录
  - 测试功能
  - 确认无误后释放资金
```

#### 当面交易

```
1. 双方约定见面地点和时间
2. 见面验货
3. 买家扫码确认收货
4. 智能合约自动释放资金
5. 双方评价
```

### 5. 评价

交易完成后互相评价：

```
评价维度:
⭐ 商品描述相符度 (1-5星)
⭐ 卖家服务态度 (1-5星)
⭐ 物流速度 (1-5星)
⭐ 包装质量 (1-5星)

文字评价: (可选)
标签: #靠谱 #快速 #如实描述
```

评价会记录在区块链上，不可篡改。

## 风险控制

### AI风险评估

每笔交易前，AI会评估风险：

```typescript
interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high'
  riskScore: number  // 0-1
  factors: string[]  // 风险因素
  recommendations: string[]  // 建议
}

// 示例
{
  riskLevel: 'medium',
  riskScore: 0.45,
  factors: [
    '对方信誉评分较低 (3.2/5.0)',
    '账号注册时间较短 (15天)',
    '交易金额较大 (¥8,500)'
  ],
  recommendations: [
    '建议选择当面交易',
    '建议使用加密货币托管',
    '建议要求提供更多商品照片',
    '可以要求对方先发货'
  ]
}
```

### 信誉系统

用户信誉由多个维度计算：

```python
def calculate_reputation(user):
    score = 0

    # 1. 交易历史 (40%)
    score += 0.4 * (
        user.completed_transactions / max(user.total_transactions, 1)
    )

    # 2. 评价得分 (30%)
    score += 0.3 * (user.average_rating / 5.0)

    # 3. 账号年龄 (10%)
    score += 0.1 * min(user.account_age_days / 365, 1)

    # 4. 社交信任 (10%)
    score += 0.1 * user.social_trust_score

    # 5. 争议记录 (10% 负向)
    score -= 0.1 * (user.dispute_count / max(user.total_transactions, 1))

    return max(0, min(1, score))  # 限制在 0-1
```

### 欺诈检测

AI实时监测可疑行为：

```
⚠️ 异常检测:
- 短时间内大量发布商品
- 价格明显低于市场价
- 描述中包含可疑关键词
- 要求私下交易（跳过托管）
- 催促快速付款

→ 自动降低推荐优先级
→ 添加风险提示
→ 严重者暂停交易权限
```

## 争议解决

### 发起争议

如果交易出现问题：

```
1. 点击订单详情
2. 点击"发起争议"
3. 选择争议原因:
   ○ 未收到货
   ● 货不对板
   ○ 商品损坏
   ○ 其他

4. 上传证据:
   - 聊天记录
   - 商品照片
   - 物流信息
   - 其他凭证

5. 提交
```

### 仲裁流程

```
争议提交
    ↓
系统冻结托管资金
    ↓
从仲裁员池随机选择 3 名仲裁员
    ↓
双方各有 1 次挑战权（更换仲裁员）
    ↓
仲裁员查看证据
    ├─ 聊天记录
    ├─ 交易合约
    ├─ 照片视频
    └─ AI分析报告
    ↓
仲裁员独立投票
    ├─ 支持买家: 全额退款
    ├─ 支持卖家: 款项释放
    └─ 折中方案: 部分退款
    ↓
按多数票执行判决
    ↓
智能合约自动分配资金
    ↓
败诉方信誉扣分
```

### 仲裁员

任何人都可以申请成为仲裁员：

```
要求:
✓ 账号注册满 90 天
✓ 完成至少 10 笔交易
✓ 信誉评分 ≥ 4.5
✓ 无争议败诉记录
✓ 质押一定金额（防止恶意仲裁）

收益:
✓ 每次仲裁获得仲裁费（从败诉方扣除）
✓ 提升社区地位
✓ 解锁高级功能

责任:
✗ 公正仲裁，不得偏袒
✗ 仲裁错误会扣除质押金
✗ 恶意仲裁永久禁止
```

### AI辅助仲裁

AI会为仲裁员提供参考：

```markdown
## AI分析报告

### 案件基本信息

- 交易金额: ¥1,200
- 争议类型: 货不对板
- 买家信誉: 4.8/5.0 (98笔交易)
- 卖家信誉: 3.2/5.0 (12笔交易)

### 证据分析

✓ 买家提供了 5 张商品照片
✓ 卖家提供了发货前照片
✗ 两组照片中的序列号不一致 ← 关键证据

### 相似案例

找到 3 个相似判例:

1. 案例#1234: 支持买家，全额退款
2. 案例#5678: 支持买家，部分退款 (70%)
3. 案例#9012: 支持卖家

### 建议判决

建议支持买家，理由:

- 序列号不符是有力证据
- 卖家信誉较低
- 相似案例多数支持买家

置信度: 78%
```

## 交易类型

### 商品交易

#### 二手商品

```
适用场景:
- 电子产品
- 图书
- 家具
- 衣物
- 其他

注意事项:
✓ 提供详细照片
✓ 说明使用时长和成色
✓ 标注所有瑕疵
✓ 保留原始发票（如有）
```

#### 全新商品

```
适用场景:
- 代购
- 批发
- 闲置全新商品

注意事项:
✓ 提供正品凭证
✓ 支持验货
✓ 承诺售后
```

### 服务交易

#### 技能服务

```
类型:
- 编程开发
- 设计创作
- 文案写作
- 翻译服务
- 咨询顾问
- 教学培训

计价方式:
○ 按小时计费
○ 按项目计费
● 阶段性付款（推荐）
```

#### 里程碑付款

```
示例: 网站开发项目，总价 ¥10,000

里程碑 1: 需求确认 (20%)
  ├─ 交付物: 需求文档
  └─ 付款: ¥2,000

里程碑 2: 设计稿 (30%)
  ├─ 交付物: UI设计图
  └─ 付款: ¥3,000

里程碑 3: 开发完成 (40%)
  ├─ 交付物: 可运行的网站
  └─ 付款: ¥4,000

里程碑 4: 验收通过 (10%)
  ├─ 交付物: 最终版本 + 文档
  └─ 付款: ¥1,000
```

### 租赁交易

```
适用场景:
- 房屋租赁
- 设备租赁
- 车辆租赁

智能合约设置:
- 押金托管
- 按月自动扣费
- 到期自动退还押金
- 损坏扣除押金
```

### 合作交易

```
适用场景:
- 技能交换
- 项目合作
- 资源共享

无货币交易:
- 基于信任
- 记录贡献值
- 互相评价
```

## 统计和分析

### 我的交易

```
[交易统计]
总交易额: ¥45,230
交易次数: 27 笔
  ├─ 买入: 15 笔
  └─ 卖出: 12 笔

成交率: 68%
平均评分: 4.9 ⭐
信誉等级: 金牌卖家 🏅

[月度趋势]
(图表显示每月交易额和数量)
```

### 市场分析

```
[热门分类]
1. 数码产品 (32%)
2. 生活用品 (24%)
3. 服务技能 (18%)
4. 图书文具 (12%)
5. 其他 (14%)

[价格分布]
0-100元: 45%
100-500元: 30%
500-2000元: 18%
2000元以上: 7%
```

## 最佳实践

### 卖家指南

1. ✅ **详细描述**: 越详细越能吸引买家
2. ✅ **清晰照片**: 多角度拍摄，包含细节和瑕疵
3. ✅ **合理定价**: 参考AI建议和市场行情
4. ✅ **快速响应**: 及时回复买家咨询
5. ✅ **诚信为本**: 如实描述，不夸大不隐瞒

### 买家指南

1. ✅ **仔细阅读**: 认真阅读商品描述和图片
2. ✅ **查看信誉**: 优先选择高信誉卖家
3. ✅ **多问多看**: 主动询问不清楚的地方
4. ✅ **保留证据**: 聊天记录、照片、视频
5. ✅ **及时评价**: 收货后及时评价，帮助其他买家

### 安全建议

1. ✅ **使用托管**: 不要私下交易跳过托管
2. ✅ **当面验货**: 贵重物品优先选择当面交易
3. ✅ **保护隐私**: 不要泄露过多个人信息
4. ✅ **警惕欺诈**: 遇到可疑情况及时举报
5. ✅ **备份证据**: 重要交易保存完整证据链

## 常见问题

### 如何提高信誉?

```
方法:
1. 完成更多交易
2. 提供优质服务获得好评
3. 获得好友的信任背书
4. 参与社区建设（如成为仲裁员）
5. 避免争议和投诉
```

### 交易费用是多少?

```
平台费用: 0% (完全免费)

实际成本:
- 区块链Gas费 (~$0.01-$5，取决于网络)
- 仲裁费 (仅争议时收取，从败诉方扣除)

示例:
  交易金额: ¥1,000
  使用 Polygon USDT
  Gas费: ~$0.01 (¥0.07)
  实际成本: < 0.01%
```

### 支持哪些支付方式?

```
✓ 加密货币 (ETH, USDT, USDC, BTC)
✓ 当面现金
✓ 第三方托管 (自选)
✗ 直接银行转账 (不推荐，无托管保护)
```

### 如何防止买家恶意退货?

```
建议:
1. 在合约中明确退货条件
2. 要求买家提供退货原因和证据
3. 使用智能合约限制退货期限
4. 收到退货后检查商品状态
5. 如有争议提交仲裁
```

## 未来功能

以下功能正在规划和开发中，将在后续版本中陆续推出。

### 拍卖功能

支持多种拍卖模式的去中心化拍卖系统。

#### 拍卖类型

```
[拍卖模式]
├─ 英式拍卖（加价拍）
│  ├─ 从底价开始，竞价递增
│  ├─ 设置最低加价幅度
│  └─ 倒计时结束，最高价者得
├─ 荷兰式拍卖（降价拍）
│  ├─ 从高价开始，自动递减
│  ├─ 第一个出价者得
│  └─ 适合快速出货
├─ 密封拍卖
│  ├─ 所有出价密封提交
│  ├─ 截止后统一开标
│  └─ 最高价者得（防串标）
└─ 反向拍卖（求购）
   ├─ 买家发布需求和预算
   ├─ 卖家竞标报价
   └─ 买家选择最优报价
```

#### 智能合约拍卖

```solidity
contract AuctionContract {
    address seller;
    uint256 startPrice;
    uint256 highestBid;
    address highestBidder;
    uint256 endTime;

    // 出价（自动退还前一个出价者）
    function bid() public payable {
        require(block.timestamp < endTime, "Auction ended");
        require(msg.value > highestBid, "Bid too low");
        if (highestBidder != address(0)) {
            payable(highestBidder).transfer(highestBid);
        }
        highestBid = msg.value;
        highestBidder = msg.sender;
    }

    // 拍卖结束，结算
    function settle() public {
        require(block.timestamp >= endTime, "Auction not ended");
        payable(seller).transfer(highestBid);
    }
}
```

#### 拍卖辅助功能

```
AI辅助:
- 🤖 起拍价建议（基于市场行情分析）
- 📊 实时竞价趋势图表
- ⏰ 智能延时（最后30秒有新出价自动延时2分钟）
- 🔔 出价提醒和被超越通知
- 📈 历史拍卖数据分析

安全保障:
- 出价冻结资金，防止恶意抬价
- 防止卖家自拍自卖（DID + IP 分析）
- 拍卖记录上链，公开透明
```

---

### 团购/拼单

多人合力拼单，享受更低价格。

#### 拼单流程

```
发起人创建拼单
    ↓
设置拼单规则:
  - 目标人数（最少几人成团）
  - 截止时间
  - 阶梯价格（人越多越便宜）
  - 最大参与人数
    ↓
分享拼单链接/二维码
    ↓
参与者加入拼单
  - 锁定资金到托管合约
  - 实时显示拼单进度
    ↓
成团判断:
  ├─ ✅ 达到目标 → 通知卖家发货
  └─ ❌ 未达标 → 自动退款给所有人
```

#### 阶梯价格

```
示例: 某品牌耳机拼单

参与人数    单价       折扣
1-2人      ¥299       无折扣
3-5人      ¥269       9折
6-10人     ¥239       8折
11-20人    ¥209       7折
20人以上   ¥179       6折

当前进度: [████████░░] 14/20人，当前价 ¥209
```

#### 智能合约拼团

```solidity
contract GroupBuyContract {
    uint256 targetCount;       // 目标人数
    uint256 deadline;          // 截止时间
    uint256[] tierPrices;      // 阶梯价格
    uint256[] tierCounts;      // 阶梯人数
    mapping(address => uint256) deposits;
    address[] participants;

    // 参与拼单
    function join() public payable {
        require(block.timestamp < deadline, "Expired");
        deposits[msg.sender] = msg.value;
        participants.push(msg.sender);
    }

    // 成团结算（退还多付金额）
    function settle() public {
        require(participants.length >= targetCount, "Not enough");
        uint256 finalPrice = getCurrentTierPrice();
        for (uint i = 0; i < participants.length; i++) {
            uint256 refund = deposits[participants[i]] - finalPrice;
            if (refund > 0) {
                payable(participants[i]).transfer(refund);
            }
        }
    }

    // 未成团退款
    function refundAll() public {
        require(block.timestamp >= deadline, "Not expired");
        require(participants.length < targetCount, "Already settled");
        for (uint i = 0; i < participants.length; i++) {
            payable(participants[i]).transfer(deposits[participants[i]]);
        }
    }
}
```

---

### 分期付款支持

大额交易支持灵活的分期付款方案。

#### 分期方案

```
[分期选项]
├─ 2期免息 (每期50%)
├─ 3期免息 (每期33.3%)
├─ 6期 (每期16.7% + 0.5%手续费)
└─ 12期 (每期8.3% + 0.8%手续费)

示例: 购买 ¥6,000 的笔记本电脑

选择3期免息:
  第1期: ¥2,000 (下单时支付)
  第2期: ¥2,000 (30天后自动扣款)
  第3期: ¥2,000 (60天后自动扣款)
  总计: ¥6,000 (0手续费)

选择6期:
  每期: ¥1,030 (本金¥1,000 + 手续费¥30)
  总计: ¥6,180 (手续费¥180)
```

#### 分期智能合约

```solidity
contract InstallmentContract {
    address buyer;
    address seller;
    uint256 totalAmount;
    uint256 installments;       // 分期数
    uint256 paidCount;
    uint256 intervalSeconds;    // 每期间隔

    // 买家按期付款
    function payInstallment() public payable {
        require(msg.sender == buyer);
        require(paidCount < installments);
        uint256 perAmount = totalAmount / installments;
        require(msg.value >= perAmount, "Insufficient");
        paidCount++;
        // 每期付款实时转给卖家
        payable(seller).transfer(msg.value);
    }

    // 逾期处理
    function handleOverdue() public {
        // 通知买家 → 宽限期 → 信誉扣分 → 仲裁
    }
}
```

#### 风控措施

```
买家资质审核:
✓ 信誉评分 ≥ 4.0
✓ 完成交易 ≥ 5 笔
✓ 账号注册 ≥ 60 天
✓ 无逾期记录

逾期处理流程:
到期日 → 自动提醒(3天前)
    ↓
到期未付 → 宽限期(7天)
    ↓
宽限期结束 → 信誉扣分 + 限制交易
    ↓
逾期30天 → 交易暂停 + 社区公示
```

---

### 信用借贷（基于信誉）

利用去中心化信誉数据构建 P2P 借贷市场。

#### 信用评级

```python
def calculate_credit_score(user):
    score = 300  # 基础分

    # 1. 信誉历史 (+200)
    score += 200 * user.reputation_score

    # 2. 交易活跃度 (+100)
    activity = min(user.monthly_transactions / 10, 1)
    score += 100 * activity

    # 3. 账户年龄 (+50)
    score += 50 * min(user.account_age_days / 365, 1)

    # 4. 社交信任网络 (+100)
    score += 100 * user.trust_network_score

    # 5. 还款记录 (+100)
    if user.total_loans > 0:
        repayment_rate = user.on_time_repayments / user.total_loans
        score += 100 * repayment_rate

    # 6. 违约扣分 (-150)
    score -= 150 * (user.defaults / max(user.total_loans, 1))

    return max(300, min(850, score))

# 信用等级
# 750-850: AAA级 (最低利率)
# 650-749: AA级
# 550-649: A级
# 450-549: B级
# 300-449: C级 (不可借贷)
```

#### 借贷流程

```
借款人发起借贷请求
    ↓
系统自动评估信用等级
    ↓
生成借贷条款建议:
  - 可借金额: 信用等级 × 系数
  - 建议利率: 基于信用等级
  - 最长期限: 基于信用等级
    ↓
发布到借贷市场
    ↓
出借人浏览并选择:
  - 查看借款人信用报告
  - AI风险评估
  - 选择投资金额
    ↓
智能合约自动执行:
  - 锁定资金
  - 按期自动还款
  - 逾期自动处理
```

#### 借贷产品

```
[个人借贷]
├─ 小额信用贷
│  ├─ 额度: ¥500 - ¥5,000
│  ├─ 期限: 7-90天
│  └─ 利率: 年化 5%-15%
├─ 交易保证金贷
│  ├─ 额度: 交易金额的30%-50%
│  ├─ 期限: 交易完成后自动归还
│  └─ 利率: 年化 3%-8%
└─ 分散借贷
   ├─ 多个出借人共同出借
   ├─ 分散风险
   └─ 最低出借金额: ¥100

[出借人收益]
├─ 稳健型: 年化 4%-6% (AAA级借款人)
├─ 平衡型: 年化 6%-10% (AA-A级)
└─ 进取型: 年化 10%-15% (B级，高风险)
```

---

### 保险服务

去中心化的交易保险，为买卖双方提供额外保障。

#### 保险类型

```
[交易保险]
├─ 货物运输险
│  ├─ 保障: 运输途中损坏/丢失
│  ├─ 保费: 交易金额的 0.5%-1%
│  └─ 赔付: 全额赔付商品价值
├─ 质量保证险
│  ├─ 保障: 商品质量问题（7天内）
│  ├─ 保费: 交易金额的 1%-2%
│  └─ 赔付: 维修费用或全额退款
├─ 信用违约险
│  ├─ 保障: 对方违约不履行合约
│  ├─ 保费: 交易金额的 1.5%-3%
│  └─ 赔付: 合约约定金额
└─ 延迟交付险
   ├─ 保障: 卖家超期未交付
   ├─ 保费: 交易金额的 0.3%-0.8%
   └─ 赔付: 每延迟1天赔付交易金额的1%
```

#### 去中心化保险池

```python
class InsurancePool:
    """
    去中心化保险池 - 社区共保模式
    """
    def __init__(self):
        self.total_pool = 0        # 保险池总额
        self.providers = {}         # 保险提供者
        self.active_policies = []   # 生效保单

    def stake(self, provider, amount):
        """保险提供者质押资金到保险池"""
        self.providers[provider] = amount
        self.total_pool += amount
        # 保险提供者赚取保费分红

    def purchase(self, buyer, policy_type, trade_amount):
        """购买保险"""
        premium = self.calculate_premium(policy_type, trade_amount)
        policy = {
            'buyer': buyer,
            'type': policy_type,
            'coverage': trade_amount,
            'premium': premium,
            'status': 'active'
        }
        self.active_policies.append(policy)
        # 保费分配给保险池提供者

    def claim(self, policy_id, evidence):
        """理赔申请"""
        # AI初步审核证据
        # 社区投票确认
        # 智能合约自动赔付
```

#### 保险购买流程

```
交易创建时:
    ↓
系统自动推荐保险方案
  ├─ 根据交易金额
  ├─ 根据对方信誉
  └─ 根据交易类型
    ↓
买家选择保险 (可选)
    ↓
支付保费 (从交易金额中扣除或额外支付)
    ↓
保单生效
    ↓
发生问题时:
  ├─ 提交理赔申请 + 证据
  ├─ AI初步审核 (秒级)
  ├─ 简单案件自动赔付
  └─ 复杂案件社区投票 → 赔付
```

---

### 更多支付方式

扩展支付渠道，支持更快速和低成本的转账。

#### 闪电网络 (Lightning Network)

```
[闪电网络支付]
优势:
✓ 即时到账 (毫秒级)
✓ 极低手续费 (~$0.001)
✓ 支持微支付 (低至1聪 ≈ ¥0.005)
✓ 支持频繁小额交易

工作原理:
1. 开启支付通道 (一次链上交易)
2. 通道内无限次即时转账
3. 关闭通道时结算 (一次链上交易)

适用场景:
- 小额商品交易 (<¥100)
- 打赏/小费
- 订阅付款
- 游戏内交易
```

#### 新增稳定币支持

```
[新增稳定币]
├─ DAI (MakerDAO)
│  ├─ 链: Ethereum / Polygon / Arbitrum
│  ├─ 特点: 去中心化超额抵押
│  └─ 手续费: ~$0.01 (L2)
├─ PYUSD (PayPal USD)
│  ├─ 链: Ethereum / Solana
│  ├─ 特点: PayPal发行，合规性强
│  └─ 手续费: ~$0.01 (Solana)
├─ cUSD (Celo Dollar)
│  ├─ 链: Celo
│  ├─ 特点: 移动优先，手机号转账
│  └─ 手续费: ~$0.001
└─ UST (Terra) / FRAX
   ├─ 链: 多链
   ├─ 特点: 算法稳定币
   └─ 手续费: 因链而异
```

#### 跨链支付

```
跨链支付桥:
  买家使用 Ethereum 上的 ETH
      ↓
  自动跨链桥转换
      ↓
  卖家收到 Polygon 上的 USDT

支持路径:
  Ethereum ↔ Polygon
  Ethereum ↔ Arbitrum
  Ethereum ↔ Optimism
  Bitcoin ↔ Lightning Network
  Solana ↔ Ethereum

预计手续费: $0.5-$3 (含桥接费)
预计时间: 1-10分钟
```

#### 法币出入金（合规渠道）

```
[法币通道] (合规地区)
├─ 银行卡充值
│  ├─ 通过合规支付网关
│  ├─ 支持 Visa / Mastercard
│  └─ 自动转换为稳定币托管
├─ 本地支付
│  ├─ 支付宝 / 微信 (中国大陆)
│  ├─ PayPal (国际)
│  └─ 银行转账 (通用)
└─ 提现
   ├─ 稳定币 → 法币
   ├─ T+1 到账
   └─ KYC验证要求

注意: 法币通道需遵守当地法规，部分地区可能不可用
```

---

### 路线图

```
[开发路线图]

Phase 1 (v0.38 - v0.39):
  ✦ 拍卖功能 - 英式拍卖 + 密封拍卖
  ✦ 闪电网络支付集成
  ✦ 基础分期付款 (2期/3期免息)

Phase 2 (v0.40 - v0.41):
  ✦ 团购/拼单系统
  ✦ 阶梯价格智能合约
  ✦ 新增 DAI / PYUSD 稳定币

Phase 3 (v0.42 - v0.43):
  ✦ 信用评级系统
  ✦ P2P借贷市场
  ✦ 跨链支付桥

Phase 4 (v0.44+):
  ✦ 去中心化保险池
  ✦ 荷兰式/反向拍卖
  ✦ 法币出入金 (合规地区)
```

## 关键文件

- `desktop-app-vue/src/main/blockchain/` — 区块链与智能合约
- `desktop-app-vue/src/renderer/pages/trading/` — 交易前端页面

## 使用示例

### CLI 交易操作

```bash
# 创建钱包
chainlesschain wallet create --name "交易钱包"

# 查看数字资产
chainlesschain wallet assets

# 转移资产
chainlesschain wallet transfer asset-001 did:chainlesschain:QmXXXX

# 查看组织交易记录
chainlesschain org list
```

### 桌面端常用操作

```
1. 市场广场 → 浏览商品 → 按分类/价格/信誉筛选
2. 发布交易 → 填写商品信息 → AI 辅助优化描述和定价
3. 联系卖家 → Signal 加密聊天 → 协商交易细节
4. 创建合约 → 选择模板 → 双方 U 盾签名 → 合约生效
5. 验货确认 → 释放托管资金 → 互相评价
```

---

## 故障排查

### 智能合约部署失败

- **Gas 费不足**: 检查钱包余额是否足够支付 Gas 费用
- **网络拥堵**: 尝试选择 Polygon 等 L2 网络降低费用和等待时间
- **合约参数错误**: 确认交易金额、地址和条款填写正确

### 交易资金未到账

- **链上确认**: 检查区块链浏览器确认交易状态和确认数
- **托管未释放**: 买家需在验货后手动确认收货释放资金
- **争议冻结**: 若有争议发起，资金会被冻结直到仲裁完成

### 信誉评分异常

- **评分延迟**: 链上评价需要区块确认，通常 1-5 分钟生效
- **评分计算**: 信誉由交易历史(40%)、评价(30%)、账号年龄(10%)等综合计算
- **恶意评价**: 可通过社区仲裁申请撤销不合理的差评

### AI 匹配不精准

- **补充描述**: 提供更详细的商品描述和关键词提高匹配度
- **调整筛选**: 缩小价格区间和地理范围提高推荐准确性
- **反馈学习**: 对推荐结果进行标记，AI 会逐步学习用户偏好

---

## 配置参考

交易辅助模块支持通过统一配置管理器进行详细配置，以下是完整的配置选项说明。

### 钱包配置

```javascript
// .chainlesschain/config.json
{
  "trading": {
    "wallet": {
      // 默认钱包名称，用于托管合约付款
      "defaultWallet": "交易钱包",

      // 支持的区块链网络
      "networks": {
        "ethereum": {
          "rpcUrl": "https://mainnet.infura.io/v3/<YOUR_KEY>",
          "chainId": 1
        },
        "polygon": {
          "rpcUrl": "https://polygon-rpc.com",
          "chainId": 137
        },
        "bitcoin": {
          "network": "mainnet"
        }
      },

      // 默认支付网络（推荐 Polygon 降低 Gas 费）
      "defaultNetwork": "polygon",

      // 大额交易多签门槛（单位：USD）
      "multiSigThreshold": 1000
    }
  }
}
```

### 网络与 Gas 配置

```javascript
{
  "trading": {
    "gas": {
      // Gas 价格策略：auto | fast | standard | slow
      "strategy": "standard",

      // 最高可接受 Gas 价格（Gwei），超出则暂停交易
      "maxGasPrice": 100,

      // Gas 预估倍率（防止低估失败）
      "estimateMultiplier": 1.2,

      // Gas 费来源：自付 | 托管合约内扣
      "feePaidBy": "buyer"
    },

    "network": {
      // P2P 节点连接超时（毫秒）
      "peerTimeout": 10000,

      // 区块链 RPC 请求超时（毫秒）
      "rpcTimeout": 15000,

      // 交易广播重试次数
      "broadcastRetries": 3
    }
  }
}
```

### 智能合约托管配置

```javascript
{
  "trading": {
    "escrow": {
      // 托管合约模板地址（Polygon 主网）
      "contractAddress": {
        "polygon": "0x...",
        "ethereum": "0x..."
      },

      // 买家确认收货最长等待期（天），超时自动释放给卖家
      "autoReleaseAfterDays": 14,

      // 争议仲裁员人数（奇数，多数票生效）
      "arbitratorCount": 3,

      // 仲裁质押最低金额（USD）
      "minArbitratorStake": 50,

      // 仲裁超时（天），超时自动退款给买家
      "arbitrationTimeoutDays": 7
    }
  }
}
```

### 风控与信誉配置

```javascript
{
  "trading": {
    "riskControl": {
      // AI 风险评估开关
      "enabled": true,

      // 自动拦截高风险交易门槛（0-1）
      "blockThreshold": 0.8,

      // 触发人工审核门槛（0-1）
      "reviewThreshold": 0.6,

      // 新账号保护期（天）：期间内交易限额
      "newAccountProtectionDays": 30,

      // 新账号每日交易限额（USD）
      "newAccountDailyLimit": 500
    },

    "reputation": {
      // 权重配置（总和 = 1）
      "weights": {
        "transactionHistory": 0.4,
        "ratingScore":        0.3,
        "accountAge":         0.1,
        "socialTrust":        0.1,
        "disputeRecord":      0.1
      },

      // 信誉分更新延迟（区块确认后生效，秒）
      "updateDelaySeconds": 60
    }
  }
}
```

### AI 匹配与推荐配置

```javascript
{
  "trading": {
    "matching": {
      // 向量检索返回候选数
      "vectorTopK": 50,

      // 最终推荐条数
      "finalTopK": 10,

      // 语义搜索嵌入模型
      "embeddingModel": "nomic-embed-text",

      // 个性化推荐：基于用户历史开关
      "personalizedRanking": true,

      // 地理位置过滤半径（公里，0 = 不限）
      "locationRadiusKm": 0
    }
  }
}
```

---

## 性能指标

### 钱包与交易操作

| 操作 | 目标 | 实际 (P50) | 实际 (P95) | 状态 |
|------|------|-----------|-----------|------|
| 交易签名 (secp256k1 ECDSA) | < 50 ms | 8 ms | 24 ms | ✅ 达标 |
| 钱包导入 (Keystore V3 / scrypt) | < 5 s | 1.8 s | 3.9 s | ✅ 达标 |
| 余额查询 (RPC) | < 500 ms | 180 ms | 420 ms | ✅ 达标 |
| 交易广播 (Polygon) | < 3 s | 0.9 s | 2.4 s | ✅ 达标 |
| 交易广播 (Ethereum) | < 10 s | 3.2 s | 8.1 s | ✅ 达标 |
| 智能合约部署 | < 30 s | 11 s | 24 s | ✅ 达标 |

### 托管合约操作

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 创建托管合约 (Polygon) | < 15 s | 6 s | ✅ 达标 |
| 买家存入资金 | < 10 s | 4 s | ✅ 达标 |
| 确认收货 & 释放资金 | < 10 s | 3.5 s | ✅ 达标 |
| 发起争议 & 冻结资金 | < 15 s | 7 s | ✅ 达标 |
| 仲裁结算执行 | < 20 s | 9 s | ✅ 达标 |

### AI 匹配与搜索

| 操作 | 目标 | 实际 (P50) | 实际 (P95) | 状态 |
|------|------|-----------|-----------|------|
| 商品向量搜索 (Top-50) | < 200 ms | 65 ms | 148 ms | ✅ 达标 |
| AI 重排序 (Top-10) | < 300 ms | 120 ms | 260 ms | ✅ 达标 |
| AI 风险评估 | < 500 ms | 190 ms | 410 ms | ✅ 达标 |
| AI 商品描述优化 | < 8 s | 3.2 s | 6.8 s | ✅ 达标 |
| AI 定价建议生成 | < 5 s | 2.1 s | 4.4 s | ✅ 达标 |

### 并发与吞吐

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 并发市场搜索请求 | ≥ 20 req/s | 35 req/s | ✅ 达标 |
| 并发合约创建 | ≥ 5 req/s | 8 req/s | ✅ 达标 |
| 信誉评分计算 (单用户) | < 10 ms | 3 ms | ✅ 达标 |
| 交易列表页加载 (100 条) | < 300 ms | 145 ms | ✅ 达标 |
| 订单详情页加载 | < 200 ms | 88 ms | ✅ 达标 |

---

## 测试覆盖率

交易辅助模块的测试覆盖区块链集成、智能合约逻辑、AI 匹配、钱包管理、风控引擎和仲裁流程等核心路径。

### Desktop 测试文件

| 测试文件 | 覆盖模块 | 用例数 |
| --- | --- | --- |
| ✅ `tests/unit/blockchain/wallet-manager.test.js` | 钱包创建/导入/导出、Keystore V3 解密、多网络余额查询 | ~45 |
| ✅ `tests/unit/blockchain/escrow-contract.test.js` | 托管合约生命周期：存入/释放/争议/仲裁结算 | ~38 |
| ✅ `tests/unit/blockchain/transaction-manager.test.js` | Legacy / EIP-1559 交易构建、RLP 编码、签名广播 | ~32 |
| ✅ `tests/unit/trading/ai-matching.test.js` | 向量搜索、重排序、个性化推荐、地理位置过滤 | ~28 |
| ✅ `tests/unit/trading/risk-control.test.js` | AI 风险评估、欺诈检测、新账号限流、自动拦截 | ~24 |
| ✅ `tests/unit/trading/reputation-system.test.js` | 信誉分权重计算、链上评价写入、防篡改验证 | ~22 |
| ✅ `tests/unit/trading/dispute-resolution.test.js` | 争议发起、仲裁员选取、投票、DAO 判决执行 | ~20 |
| ✅ `tests/unit/trading/price-suggestion.test.js` | 历史成交价分析、AI 定价建议、置信度计算 | ~16 |
| ✅ `tests/unit/trading/marketplace-search.test.js` | 关键词搜索、分类筛选、排序、分页 | ~18 |

### CLI 测试文件

| 测试文件 | 覆盖模块 | 用例数 |
| --- | --- | --- |
| ✅ `packages/cli/__tests__/unit/wallet.test.js` | `wallet create/assets/transfer` 命令解析与执行 | ~24 |
| ✅ `packages/cli/__tests__/integration/trading-flow.test.js` | 发布→匹配→托管→确认 端到端流程 | ~18 |
| ✅ `packages/cli/__tests__/unit/org-trading.test.js` | `org list/invite/approve` 与交易权限验证 | ~14 |

### Android 测试文件

| 测试文件 | 覆盖模块 | 用例数 |
| --- | --- | --- |
| ✅ `android-app/core-blockchain/src/test/.../WalletCoreAdapterTest.kt` | secp256k1 签名、公钥推导、EIP-2 正规化 | ~20 |
| ✅ `android-app/core-blockchain/src/test/.../TransactionManagerTest.kt` | RLP 编码、Legacy/EIP-1559 交易构建与签名 | ~18 |
| ✅ `android-app/feature-blockchain/src/test/.../WalletManagerTest.kt` | Keystore V3 导入、scrypt/pbkdf2 KDF、MAC 验证 | ~16 |

---

## 安全考虑

### 交易资金安全

- 所有交易通过 **智能合约托管**，资金由区块链合约管理，任何一方无法单独转移
- 支持多签钱包，大额交易可配置多人审批机制
- 分期付款合约自动执行，逾期处理逻辑写入链上不可篡改

### 隐私保护

- 交易双方通过 **Signal 协议** 加密通信，聊天记录不经过任何中心服务器
- 商品信息默认公开，但个人联系方式和真实身份仅在双方同意后披露
- 交易金额和参与方可选择 ZK-Rollup 隐私模式，对第三方不可见

### 反欺诈机制

- AI 风控引擎实时监测异常交易行为（价格异常、频繁发布、催促付款等）
- 所有评价记录在区块链上，不可篡改不可删除，防止信誉造假
- 仲裁员需质押资金担保公正性，恶意仲裁会被扣除质押金

### 合规安全

- 智能合约代码开源可审计，所有交易逻辑透明可验证
- 支持监管方持有审计密钥，在合规要求下可选择性查看交易细节
- 法币出入金渠道遵守当地法规，需完成 KYC 身份验证

---

## 相关文档

- [去中心化社交](./social) — DID 身份与信誉系统
- [数据加密](./encryption) — 交易数据加密
- [Agent 经济](./agent-economy) — 代理代币化
- [DAO 治理](./dao-governance-v2) — 去中心化治理
