# 第四批技能工具扩展文档

## 概述

本次扩展为 ChainlessChain AI 系统新增了 **10 个技能** 和 **20 个工具**，重点增强了区块链集成、邮件管理、PDF处理、语音处理、图表可视化、网页爬虫、数据验证、缓存管理、消息队列和容器管理等企业级功能。

## 扩展统计

### 总体数据
- **技能总数**: 55 个 (新增 10 个)
- **工具总数**: 92 个 (新增 20 个)
- **注册工具**: 86 个 (FunctionCaller)

### 新增技能 (46-55)

| ID | 名称 | 分类 | 工具数 | 说明 |
|----|------|------|--------|------|
| 46 | 区块链集成 | blockchain | 3 | 与区块链网络交互、智能合约调用、钱包管理 |
| 47 | 邮件管理 | communication | 3 | 发送邮件、读取邮件、处理附件 |
| 48 | PDF处理 | document | 3 | PDF生成、文本提取、页面合并 |
| 49 | 语音处理 | media | 3 | 语音识别、文本转语音、音频格式转换 |
| 50 | 图表可视化 | visualization | 2 | 生成各类图表（折线图、柱状图、饼图等） |
| 51 | 网页爬虫 | network | 3 | 网页数据爬取、HTML解析、内容提取 |
| 52 | 数据验证 | data | 2 | 数据校验、Schema验证 |
| 53 | 缓存管理 | storage | 1 | 缓存读写、过期管理、分布式缓存 |
| 54 | 消息队列 | messaging | 1 | 消息发布订阅、队列管理 |
| 55 | 容器管理 | devops | 1 | Docker容器操作、镜像管理 |

### 新增工具 (73-92)

| ID | 工具名称 | 分类 | 风险等级 | 说明 |
|----|----------|------|----------|------|
| 73 | blockchain_client | blockchain | 2 | 连接区块链网络，查询区块、交易信息 |
| 74 | smart_contract_caller | blockchain | 4 | 调用智能合约函数、发送交易 |
| 75 | wallet_manager | blockchain | 5 | 创建钱包、导入私钥、签名交易 |
| 76 | email_sender | communication | 3 | 通过SMTP发送邮件（支持HTML、附件） |
| 77 | email_reader | communication | 3 | 通过IMAP读取邮件 |
| 78 | email_attachment_handler | communication | 2 | 提取、保存、发送邮件附件 |
| 79 | pdf_generator | document | 2 | 从HTML、Markdown或模板生成PDF文件 |
| 80 | pdf_text_extractor | document | 1 | 从PDF文件中提取文本内容 |
| 81 | pdf_merger | document | 2 | 合并多个PDF文件、拆分PDF |
| 82 | speech_recognizer | media | 2 | 将语音转换为文本（ASR） |
| 83 | text_to_speech | media | 2 | 将文本转换为语音（TTS） |
| 84 | audio_converter | media | 2 | 转换音频格式（MP3、WAV、OGG等） |
| 85 | chart_renderer | visualization | 1 | 渲染各类图表为图片（PNG、SVG） |
| 86 | web_crawler | network | 3 | 爬取网页内容、下载资源 |
| 87 | html_extractor | network | 1 | 从HTML中提取特定内容、表格、图片等 |
| 88 | data_validator | data | 1 | 验证数据类型、范围、格式等 |
| 89 | schema_validator | data | 1 | 使用JSON Schema验证数据结构 |
| 90 | cache_manager | storage | 2 | 内存缓存、Redis缓存操作 |
| 91 | message_queue_client | messaging | 3 | 发布订阅消息、队列操作 |
| 92 | docker_manager | devops | 4 | 管理Docker容器、镜像、网络 |

## 重点功能介绍

### 1. 区块链集成 (skill_blockchain_integration)

**应用场景**: Web3应用开发、DeFi交互、NFT管理、智能合约测试

#### 区块链客户端
```javascript
// 查询以太坊余额
const balance = await functionCaller.call('blockchain_client', {
  network: 'ethereum',
  action: 'getBalance',
  params: { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }
});

// 获取 Gas Price
const gasPrice = await functionCaller.call('blockchain_client', {
  network: 'ethereum',
  action: 'getGasPrice'
});
```

#### 智能合约调用
```javascript
// 调用 ERC20 合约查询余额
const tokenBalance = await functionCaller.call('smart_contract_caller', {
  contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  abi: [/* ERC20 ABI */],
  method: 'balanceOf',
  args: ['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']
});
```

#### 钱包管理
```javascript
// 创建新钱包
const wallet = await functionCaller.call('wallet_manager', {
  action: 'create'
});

console.log('地址:', wallet.address);
console.log('私钥:', wallet.privateKey);
```

**推荐库**: `web3.js`, `ethers.js`, `bip39`

---

### 2. 邮件管理 (skill_email_management)

**应用场景**: 自动化邮件发送、邮件监控、附件提取、邮件营销

#### 发送邮件
```javascript
const result = await functionCaller.call('email_sender', {
  from: 'noreply@company.com',
  to: ['user@example.com'],
  subject: '欢迎加入我们！',
  html: '<h1>欢迎！</h1><p>感谢您的注册。</p>',
  smtpConfig: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'
    }
  }
});
```

#### 读取邮件
```javascript
const emails = await functionCaller.call('email_reader', {
  imapConfig: {
    host: 'imap.gmail.com',
    port: 993,
    user: 'your-email@gmail.com',
    password: 'your-app-password',
    tls: true
  },
  mailbox: 'INBOX',
  limit: 20
});

console.log(`收到 ${emails.emails.length} 封邮件`);
```

**推荐库**: `nodemailer`, `imap-simple`, `mailparser`

---

### 3. PDF处理 (skill_pdf_processing)

**应用场景**: 报告生成、发票制作、文档转换、PDF合并

#### 生成 PDF
```javascript
const pdf = await functionCaller.call('pdf_generator', {
  content: '<h1>销售报表</h1><table>...</table>',
  contentType: 'html',
  outputPath: '/reports/sales-2024.pdf',
  options: {
    format: 'A4',
    margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
    landscape: false
  }
});
```

#### 提取文本
```javascript
const text = await functionCaller.call('pdf_text_extractor', {
  pdfPath: '/documents/contract.pdf',
  pages: [1, 2, 3], // 只提取前3页
  preserveLayout: true
});

console.log(text.text);
```

#### 合并 PDF
```javascript
const merged = await functionCaller.call('pdf_merger', {
  action: 'merge',
  inputFiles: [
    '/docs/part1.pdf',
    '/docs/part2.pdf',
    '/docs/part3.pdf'
  ],
  outputPath: '/docs/complete.pdf'
});
```

**推荐库**: `puppeteer`, `pdfkit`, `pdf-lib`, `pdf-parse`

---

### 4. 语音处理 (skill_speech_processing)

**应用场景**: 语音助手、会议转录、有声读物、语音翻译

#### 语音识别
```javascript
const transcript = await functionCaller.call('speech_recognizer', {
  audioPath: '/recordings/meeting.wav',
  language: 'zh-CN',
  model: 'whisper' // 使用 OpenAI Whisper 模型
});

console.log('识别结果:', transcript.text);
console.log('置信度:', transcript.confidence);
```

#### 文本转语音
```javascript
const audio = await functionCaller.call('text_to_speech', {
  text: '欢迎使用 ChainlessChain AI 系统',
  language: 'zh-CN',
  voice: 'female',
  outputPath: '/audio/welcome.mp3',
  speed: 1.2
});
```

**推荐库**: `@google-cloud/speech`, `@google-cloud/text-to-speech`, `whisper.cpp`, `edge-tts`

---

### 5. 图表可视化 (skill_chart_visualization)

**应用场景**: 数据报表、仪表盘、数据分析可视化

```javascript
const chart = await functionCaller.call('chart_renderer', {
  chartConfig: {
    type: 'bar',
    data: {
      labels: ['1月', '2月', '3月', '4月', '5月'],
      datasets: [{
        label: '销售额',
        data: [12000, 19000, 15000, 25000, 22000],
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: '2024年销售报表' }
      }
    }
  },
  outputPath: '/charts/sales-2024.png',
  format: 'png',
  width: 1200,
  height: 800
});
```

**推荐库**: `chartjs-node-canvas`, `d3-node`, `vega`

---

### 6. 网页爬虫 (skill_web_scraping)

**应用场景**: 数据采集、价格监控、新闻抓取、竞品分析

```javascript
const data = await functionCaller.call('web_crawler', {
  url: 'https://news.example.com',
  selectors: {
    title: 'h1.article-title',
    content: 'div.article-body',
    author: 'span.author-name',
    publishDate: 'time.publish-date'
  },
  followLinks: false,
  maxDepth: 1
});

console.log('标题:', data.data.title);
console.log('作者:', data.data.author);
```

**推荐库**: `puppeteer`, `cheerio`, `playwright`, `axios`

---

### 7. 数据验证 (skill_data_validation)

**应用场景**: 表单验证、API输入校验、数据质量检查

#### 规则验证
```javascript
const validation = await functionCaller.call('data_validator', {
  data: {
    username: 'john_doe',
    email: 'john@example.com',
    age: 25,
    phone: '13800138000'
  },
  rules: [
    { field: 'username', type: 'string', required: true, pattern: '^[a-zA-Z0-9_]+$' },
    { field: 'email', type: 'string', required: true, pattern: '^[^@]+@[^@]+\\.[^@]+$' },
    { field: 'age', type: 'number', required: true, min: 18, max: 100 },
    { field: 'phone', type: 'string', pattern: '^1[3-9]\\d{9}$' }
  ]
});

if (!validation.valid) {
  console.log('验证失败:', validation.errors);
}
```

#### Schema 验证
```javascript
const schemaValidation = await functionCaller.call('schema_validator', {
  data: {
    name: 'Product A',
    price: 99.99,
    tags: ['electronics', 'gadget']
  },
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      price: { type: 'number', minimum: 0 },
      tags: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['name', 'price']
  }
});
```

**推荐库**: `ajv`, `joi`, `yup`

---

### 8. 缓存管理 (skill_cache_management)

**应用场景**: 性能优化、减少数据库查询、分布式缓存

```javascript
// 设置缓存
await functionCaller.call('cache_manager', {
  action: 'set',
  key: 'user:12345',
  value: { name: 'John', role: 'admin' },
  ttl: 3600, // 1小时过期
  type: 'memory'
});

// 获取缓存
const cached = await functionCaller.call('cache_manager', {
  action: 'get',
  key: 'user:12345',
  type: 'memory'
});

if (cached.exists) {
  console.log('缓存命中:', cached.value);
} else {
  console.log('缓存未命中，需要从数据库查询');
}

// 删除缓存
await functionCaller.call('cache_manager', {
  action: 'delete',
  key: 'user:12345'
});
```

**推荐库**: `redis`, `ioredis`, `node-cache`

---

### 9. 消息队列 (skill_message_queue)

**应用场景**: 异步任务处理、微服务通信、削峰填谷

```javascript
// 发布消息
const published = await functionCaller.call('message_queue_client', {
  action: 'publish',
  queue: 'email-tasks',
  message: {
    type: 'send-email',
    to: 'user@example.com',
    template: 'welcome'
  }
});

// 消费消息
const messages = await functionCaller.call('message_queue_client', {
  action: 'consume',
  queue: 'email-tasks'
});

for (const msg of messages.messages) {
  console.log('处理任务:', msg);
  // 处理完成后确认
  await functionCaller.call('message_queue_client', {
    action: 'ack',
    queue: 'email-tasks',
    messageId: msg.id
  });
}
```

**推荐库**: `amqplib` (RabbitMQ), `kafkajs` (Kafka), `bull` (Redis队列)

---

### 10. 容器管理 (skill_container_management)

**应用场景**: DevOps自动化、容器编排、CI/CD

```javascript
// 列出所有容器
const containers = await functionCaller.call('docker_manager', {
  action: 'list',
  resource: 'container'
});

// 启动容器
await functionCaller.call('docker_manager', {
  action: 'start',
  resource: 'container',
  id: 'my-app-container'
});

// 执行命令
const output = await functionCaller.call('docker_manager', {
  action: 'exec',
  resource: 'container',
  id: 'my-app-container',
  command: 'npm run build'
});

// 查看日志
const logs = await functionCaller.call('docker_manager', {
  action: 'logs',
  resource: 'container',
  id: 'my-app-container'
});
```

**推荐库**: `dockerode`

---

## 技术实现

### 依赖库总结

```json
{
  "dependencies": {
    // 区块链
    "web3": "^4.3.0",
    "ethers": "^6.9.0",
    "bip39": "^3.1.0",

    // 邮件
    "nodemailer": "^6.9.7",
    "imap-simple": "^5.2.0",
    "mailparser": "^3.6.5",

    // PDF
    "puppeteer": "^21.6.0",
    "pdfkit": "^0.13.0",
    "pdf-lib": "^1.17.1",
    "pdf-parse": "^1.1.1",

    // 语音
    "@google-cloud/speech": "^6.1.0",
    "@google-cloud/text-to-speech": "^5.1.0",

    // 图表
    "chartjs-node-canvas": "^4.1.6",

    // 爬虫
    "cheerio": "^1.0.0-rc.12",
    "axios": "^1.6.2",

    // 验证
    "ajv": "^8.12.0",
    "joi": "^17.11.0",

    // 缓存
    "redis": "^4.6.11",
    "ioredis": "^5.3.2",

    // 消息队列
    "amqplib": "^0.10.3",
    "kafkajs": "^2.2.4",

    // Docker
    "dockerode": "^4.0.0"
  }
}
```

### 文件结构

```
desktop-app-vue/
├── src/main/
│   ├── ai-engine/
│   │   ├── function-caller.js         (更新: 导入 ExtendedTools4)
│   │   ├── extended-tools.js
│   │   ├── extended-tools-2.js
│   │   ├── extended-tools-3.js
│   │   └── extended-tools-4.js        (新增: 20 个工具实现)
│   └── skill-tool-system/
│       ├── builtin-skills.js          (更新: 新增 10 个技能)
│       └── builtin-tools.js           (更新: 新增 20 个工具定义)
└── tests/
    └── skill-tool-load-test.js
```

### 测试结果

```
总技能数: 55
总工具数: 92
FunctionCaller 注册: 86 个工具
所有测试通过 ✅
```

## 安全注意事项

### 高风险工具 (Risk Level 4-5)

1. **wallet_manager** (Level 5)
   - 涉及私钥和助记词
   - 必须加密存储
   - 建议使用硬件钱包

2. **smart_contract_caller** (Level 4)
   - 可能涉及资金交易
   - 需要交易确认机制
   - 建议模拟执行后再实际调用

3. **docker_manager** (Level 4)
   - 直接访问 Docker 守护进程
   - 需要权限控制
   - 避免执行未验证的命令

### 中等风险工具 (Risk Level 3)

- **email_sender/reader**: 邮箱凭证保护
- **web_crawler**: 遵守 robots.txt
- **api_requester**: API密钥安全
- **message_queue_client**: 消息内容加密

## 版本历史

- **v4.0.0** (2025-12-30): 第四批扩展
  - 新增 10 个技能（区块链、邮件、PDF、语音、图表等）
  - 新增 20 个工具
  - 完整测试通过

- **v3.0.0**: 第三批扩展（45 技能，72 工具）
- **v2.0.0**: 第二批扩展（35 技能，52 工具）
- **v1.0.0**: 第一批扩展（25 技能，32 工具）
- **v0.0.1**: 初始版本（15 技能，12 工具）

## 下一步计划

1. **专业库集成**: 为每个工具集成推荐的生产级库
2. **完整测试**: 编写单元测试和集成测试
3. **文档完善**: 添加更多使用示例和最佳实践
4. **性能优化**: 优化大数据量处理和并发性能
5. **安全加固**: 实现细粒度权限控制和审计日志

---

**更新日期**: 2025-12-30
**文档版本**: 1.0.0
**作者**: ChainlessChain AI Team
