# ChainlessChain 官网图片资源说明

本目录包含ChainlessChain官方网站使用的所有图片资源。

## 📁 目录结构

```
images/
├── diagrams/          # 架构图和流程图
│   ├── decentralized-architecture.svg    # 去中心化架构图
│   ├── cost-comparison.svg               # 成本对比图表
│   └── 5min-setup-flow.svg               # 5分钟上手流程图
│
├── icons/             # 图标集合
│   ├── ai-engines.svg           # AI引擎图标集（19个）
│   ├── product-features.svg     # 产品功能图标集
│   └── tech-stack.svg           # 技术栈图标集
│
├── qr/                # 二维码
│   └── android-download.svg     # Android下载二维码
│
└── og-image.svg       # Open Graph社交分享图片

```

---

## 🎨 图标使用方法

### 1. AI引擎图标集（ai-engines.svg）

包含19个AI引擎图标，使用SVG `<symbol>` 定义。

#### 可用图标ID：

| 图标ID | 名称 | 颜色主题 |
|--------|------|----------|
| `icon-code-engine` | 代码引擎 | 紫色 (#667eea) |
| `icon-doc-engine` | 文档引擎 | 蓝色 (#1890ff) |
| `icon-excel-engine` | Excel引擎 | 绿色 (#52c41a) |
| `icon-ppt-engine` | PPT引擎 | 橙色 (#fa8c16) |
| `icon-pdf-engine` | PDF引擎 | 红色 (#f5222d) |
| `icon-image-engine` | 图像引擎 | 粉色 (#eb2f96) |
| `icon-video-engine` | 视频引擎 | 紫罗兰 (#722ed1) |
| `icon-web-engine` | Web引擎 | 青色 (#13c2c2) |
| `icon-data-engine` | 数据引擎 | 蓝色 (#2f54eb) |
| `icon-audio-engine` | 音频引擎 | 金色 (#faad14) |
| `icon-email-engine` | 邮件引擎 | 蓝色 (#1890ff) |
| `icon-database-engine` | 数据库引擎 | 绿色 (#52c41a) |
| `icon-api-engine` | API引擎 | 青色 (#13c2c2) |
| `icon-ai-engine` | AI引擎 | 紫罗兰 (#722ed1) |
| `icon-search-engine` | 搜索引擎 | 金色 (#faad14) |
| `icon-translation-engine` | 翻译引擎 | 粉色 (#eb2f96) |
| `icon-ocr-engine` | OCR引擎 | 红色 (#f5222d) |
| `icon-blockchain-engine` | 区块链引擎 | 橙色 (#fa8c16) |
| `icon-security-engine` | 安全引擎 | 绿色 (#52c41a) |

#### 使用示例：

```html
<!-- 1. 首先在页面中引入图标集 -->
<object data="images/icons/ai-engines.svg" type="image/svg+xml" style="display:none;"></object>

<!-- 2. 使用 <svg> + <use> 引用图标 -->
<svg width="48" height="48" class="ai-engine-icon">
  <use href="images/icons/ai-engines.svg#icon-code-engine"/>
</svg>

<!-- 或者使用内联方式 -->
<svg width="48" height="48">
  <use xlink:href="images/icons/ai-engines.svg#icon-doc-engine"/>
</svg>
```

---

### 2. 产品功能图标集（product-features.svg）

包含12个产品功能图标。

#### 可用图标ID：

| 图标ID | 名称 | 描述 |
|--------|------|------|
| `icon-knowledge-base` | 知识库 | 带AI标记的书本 |
| `icon-enterprise` | 企业版 | 办公大楼 |
| `icon-project-management` | 项目管理 | 任务列表+勾选 |
| `icon-social` | 社交通信 | 多用户交流 |
| `icon-trading` | 交易辅助 | 货币+购物袋 |
| `icon-security` | 安全保护 | 盾牌+锁 |
| `icon-ai-brain` | AI大脑 | 智能大脑 |
| `icon-cloud-sync` | 云同步 | 云+箭头 |
| `icon-collaboration` | 协作 | 多人连接 |
| `icon-p2p-network` | P2P网络 | 去中心化网络 |
| `icon-data-ownership` | 数据主权 | 用户+皇冠 |
| `icon-zero-cost` | 零成本 | 0元标记 |

#### 使用示例：

```html
<!-- 知识库图标 -->
<svg width="64" height="64">
  <use href="images/icons/product-features.svg#icon-knowledge-base"/>
</svg>

<!-- 企业版图标 -->
<svg width="64" height="64">
  <use href="images/icons/product-features.svg#icon-enterprise"/>
</svg>
```

---

### 3. 技术栈图标集（tech-stack.svg）

包含16个技术栈图标。

#### 可用图标ID：

| 图标ID | 技术名称 |
|--------|----------|
| `icon-electron` | Electron |
| `icon-vue` | Vue.js |
| `icon-typescript` | TypeScript |
| `icon-nodejs` | Node.js |
| `icon-spring` | Spring Boot |
| `icon-python` | Python/FastAPI |
| `icon-postgresql` | PostgreSQL |
| `icon-redis` | Redis |
| `icon-ollama` | Ollama |
| `icon-vectordb` | Qdrant向量数据库 |
| `icon-sqlcipher` | SQLCipher |
| `icon-libp2p` | libp2p |
| `icon-signal` | Signal Protocol |
| `icon-docker` | Docker |
| `icon-git` | Git |
| `icon-hardhat` | Hardhat |
| `icon-chrome` | Chrome Extension |

#### 使用示例：

```html
<svg width="48" height="48">
  <use href="images/icons/tech-stack.svg#icon-vue"/>
</svg>

<svg width="48" height="48">
  <use href="images/icons/tech-stack.svg#icon-electron"/>
</svg>
```

---

## 📊 架构图和流程图

### 1. 去中心化架构图（decentralized-architecture.svg）

**尺寸**: 800x600
**用途**: 企业版详情页、技术文档页
**特点**:
- 展示P2P网络结构
- 6个用户节点互联
- 6大核心优势标注

**使用示例**:
```html
<img src="images/diagrams/decentralized-architecture.svg"
     alt="ChainlessChain去中心化架构"
     width="100%" />
```

---

### 2. 成本对比图表（cost-comparison.svg）

**尺寸**: 800x500
**用途**: 企业版详情页、首页Spotlight板块
**特点**:
- 柱状图对比
- 传统软件：¥180,000/年
- ChainlessChain：¥0
- 节省金额高亮显示

**使用示例**:
```html
<img src="images/diagrams/cost-comparison.svg"
     alt="成本对比：传统软件 vs ChainlessChain"
     class="cost-comparison-chart" />
```

---

### 3. 5分钟上手流程图（5min-setup-flow.svg）

**尺寸**: 900x300
**用途**: 企业版详情页、首页
**特点**:
- 4步流程展示
- 每步标注时间
- 总计5分钟高亮

**使用示例**:
```html
<img src="images/diagrams/5min-setup-flow.svg"
     alt="5分钟快速上手流程"
     class="setup-flow-diagram" />
```

---

## 🎨 设计规范

### 颜色主题

所有图标和插图遵循统一的颜色系统：

| 颜色名称 | 色值 | 用途 |
|---------|------|------|
| 主色（蓝色） | `#1890ff` | 主要按钮、链接 |
| 辅助色（紫色） | `#667eea` | 渐变、强调 |
| 辅助色（深紫） | `#764ba2` | 渐变终点 |
| 成功色（绿色） | `#52c41a` | 成功状态、对勾 |
| 警告色（橙色） | `#faad14` | 警告提示 |
| 错误色（红色） | `#f5222d` | 错误状态 |

### 图标尺寸建议

| 场景 | 推荐尺寸 |
|------|----------|
| 导航菜单 | 24x24 |
| 功能卡片 | 48x48 或 64x64 |
| Hero区域 | 80x80 或 更大 |
| 技术栈展示 | 40x40 或 48x48 |

### SVG优化

所有SVG文件已经优化：
- ✅ 移除不必要的元数据
- ✅ 压缩路径数据
- ✅ 使用语义化ID
- ✅ 适配响应式设计

---

## 💡 使用技巧

### 1. 响应式图标

```css
.icon {
  width: 64px;
  height: 64px;
}

@media (max-width: 768px) {
  .icon {
    width: 48px;
    height: 48px;
  }
}
```

### 2. 图标颜色自定义

如果需要修改图标颜色，可以使用CSS：

```html
<svg class="custom-icon">
  <use href="images/icons/product-features.svg#icon-ai-brain"/>
</svg>

<style>
.custom-icon {
  fill: #ff6b6b;  /* 自定义填充色 */
  stroke: #ee5a6f;  /* 自定义描边色 */
}
</style>
```

### 3. 图标动画

```css
.icon-animated {
  transition: transform 0.3s ease;
}

.icon-animated:hover {
  transform: scale(1.1);
}
```

---

## 📝 更新日志

### v1.0 (2025-12-31)
- ✅ 创建去中心化架构图
- ✅ 创建成本对比图表
- ✅ 创建5分钟上手流程图
- ✅ 创建AI引擎图标集（19个）
- ✅ 创建产品功能图标集（12个）
- ✅ 创建技术栈图标集（16个）
- ✅ 总计：3个架构图 + 47个图标

---

## 📮 联系方式

如需添加新图标或修改现有图标，请联系：
- **Email**: zhanglongfa@chainlesschain.com
- **GitHub**: https://github.com/chainlesschain

---

**制作**: Claude Code
**版本**: v1.0
**日期**: 2025-12-31
