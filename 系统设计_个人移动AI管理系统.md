# 基于U盾和SIMKey的个人移动AI管理系统
## 系统设计文档 v1.0

---

## 一、系统概述

### 1.1 系统定位
本系统是一个**去中心化的个人AI助手平台**,整合了知识库管理、社交网络和交易辅助三大核心功能,通过U盾(USB Key)和SIMKey提供军事级安全保障。

### 1.2 核心特性
- **完全去中心化**: 数据存储在用户自己的设备上,不依赖第三方云服务
- **端到端加密**: 基于U盾/SIMKey的硬件级加密保护
- **跨设备同步**: 移动端、PC端、云端无缝协作
- **AI增强**: 集成本地大模型提供智能问答和知识管理
- **隐私优先**: 用户完全掌控自己的数据和AI模型

### 1.3 技术架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户层                                     │
├──────────────────────┬──────────────────────┬───────────────────┤
│   移动端 (Android/iOS)│      PC端 (Win/Mac)  │   Web端 (可选)    │
│   - 移动APP           │      - 桌面应用       │   - 浏览器访问     │
│   - SIMKey认证        │      - U盾认证        │   - 轻量级界面     │
└──────────────────────┴──────────────────────┴───────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     业务逻辑层                                    │
├──────────────────────────────┬──────────────────────────────────┤
│    ⭐项目管理模块 (核心)       │      辅助模块                     │
│    - 对话式任务执行            ├─────────────┬───────────────────┤
│    - 多类型文件处理            │知识库管理模块│去中心化社交模块   │
│    - AI代码/文档生成           │- 知识存储   │- P2P通信          │
│    - 项目协作与交易            │- 向量检索   │- 身份验证         │
│    - 知识库深度集成            │- AI问答     │- 内容分享         │
│                               ├─────────────┴───────────────────┤
│                               │     交易辅助模块                 │
│                               │     - 智能合约                   │
│                               │     - 信任评分                   │
│                               │     - 交易协商                   │
└──────────────────────────────┴──────────────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     数据层                                        │
├──────────────────┬─────────────────────┬────────────────────────┤
│  本地存储         │   分布式存储         │   AI模型层             │
│  - SQLCipher DB  │   - Git仓库          │   - 思维模型(LLM)     │
│  - 文件系统       │   - IPFS(可选)       │   - 问答模型(RAG)     │
│    • knowledge/  │   - P2P节点          │   - 嵌入模型(Embedding)│
│    • projects/   │                      │   - 多模态模型         │
│  - 向量数据库     │                      │                       │
└──────────────────┴─────────────────────┴────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     安全层                                        │
├──────────────────────────────┬──────────────────────────────────┤
│       U盾 (PC端)              │        SIMKey (移动端)           │
│  - 私钥存储                    │   - 私钥存储                     │
│  - 数字签名                    │   - 数字签名                     │
│  - 身份认证                    │   - SIM卡安全芯片                │
│  - 数据加密密钥                │   - 移动运营商支持               │
└──────────────────────────────┴──────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 知识库管理模块

#### 2.1.1 功能描述
个人知识库是用户的第二大脑,存储笔记、文档、对话历史等,并提供AI增强的检索和问答功能。

#### 2.1.2 架构设计

```
知识库管理
├── 数据采集层
│   ├── 手动输入 (文本、语音、图片)
│   ├── 文件导入 (PDF、Word、Markdown等)
│   ├── 网页剪藏 (浏览器插件)
│   └── API接入 (第三方数据源)
│
├── 数据处理层
│   ├── 文本解析与清洗
│   ├── 分词与实体识别
│   ├── 向量化 (Embedding)
│   └── 知识图谱构建
│
├── 存储层
│   ├── 元数据存储 (SQLCipher)
│   │   ├── 知识条目表 (id, title, type, created_at, updated_at)
│   │   ├── 标签表 (id, name, color)
│   │   ├── 知识-标签关联表
│   │   └── 版本历史表 (git commit hash, timestamp)
│   │
│   ├── 文件存储
│   │   ├── 原始文件 (docs/, images/, audio/)
│   │   └── 处理后文件 (parsed/, embeddings/)
│   │
│   ├── 向量数据库 (Qdrant/Milvus/ChromaDB)
│   │   └── 向量索引 (支持语义检索)
│   │
│   └── Git仓库
│       ├── .git/ (版本控制)
│       ├── knowledge/ (知识文件)
│       └── .gitattributes (大文件LFS配置)
│
├── AI推理层
│   ├── RAG (检索增强生成)
│   │   ├── 向量检索 (语义相似度匹配)
│   │   ├── 混合检索 (关键词+向量)
│   │   └── 重排序 (Reranker)
│   │
│   ├── 本地LLM
│   │   ├── PC端: LLaMA3/Qwen/ChatGLM (Docker部署)
│   │   ├── 移动端: MiniCPM/Phi-3 (轻量级模型)
│   │   └── 云端: 可选接入OpenAI/Claude API
│   │
│   └── 提示词工程
│       ├── 系统提示词模板
│       ├── 用户自定义提示词
│       └── Few-shot示例库
│
└── 同步层
    ├── Git Push/Pull (PC ↔ 远程仓库)
    ├── Git Clone (移动端 ↔ 远程仓库)
    └── 冲突解决机制
```

#### 2.1.3 核心流程

**知识添加流程**:
```
1. 用户输入/导入内容
2. 安全校验 (U盾/SIMKey解锁)
3. 内容解析与向量化
4. 写入SQLCipher数据库
5. 文件保存到本地目录
6. Git commit (本地提交)
7. Git push到加密远程仓库
8. 向量数据库索引更新
9. 通知其他设备同步
```

**知识检索流程**:
```
1. 用户输入查询 (自然语言)
2. 查询向量化 (Embedding)
3. 向量数据库检索 Top-K相关文档
4. SQLCipher查询元数据
5. 重排序 (根据时间、标签、相关性)
6. 返回结果列表
```

**AI问答流程**:
```
1. 用户提问
2. 向量检索相关知识 (RAG)
3. 构建提示词 (系统提示 + 检索内容 + 用户问题)
4. 调用本地LLM生成回答
5. 记录对话历史
6. (可选) 将有价值的对话保存为新知识
```

#### 2.1.4 数据模型

**SQLCipher数据库表结构**:

```sql
-- 知识条目表
CREATE TABLE knowledge_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'note', 'document', 'conversation', 'web_clip'
    content_path TEXT,   -- 文件相对路径
    embedding_path TEXT, -- 向量文件路径
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    git_commit_hash TEXT,
    device_id TEXT,      -- 创建设备标识
    sync_status TEXT DEFAULT 'synced'  -- 'synced', 'pending', 'conflict'
);

-- 标签表
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT,
    parent_tag_id TEXT,
    FOREIGN KEY (parent_tag_id) REFERENCES tags(id)
);

-- 知识-标签关联表
CREATE TABLE knowledge_tags (
    knowledge_id TEXT,
    tag_id TEXT,
    PRIMARY KEY (knowledge_id, tag_id),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

-- 查询模板表
CREATE TABLE query_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    knowledge_base_ids TEXT,  -- JSON数组: 关联的知识库ID
    llm_model TEXT,           -- 思维模型地址
    rag_model TEXT,           -- 问答模型地址
    system_prompt TEXT,
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 2000,
    created_at INTEGER NOT NULL
);

-- AI对话历史表
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    model_used TEXT,
    model_version TEXT,
    token_count INTEGER,
    rating INTEGER,  -- 用户评分 1-5
    created_at INTEGER NOT NULL,
    FOREIGN KEY (template_id) REFERENCES query_templates(id)
);

-- 设备表 (跟踪所有同步设备)
CREATE TABLE devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT,  -- 'pc', 'mobile', 'web'
    public_key TEXT NOT NULL,  -- 设备公钥
    last_sync_at INTEGER,
    is_active INTEGER DEFAULT 1
);
```

#### 2.1.5 技术选型

| 组件 | PC端 | 移动端 | 说明 |
|------|------|--------|------|
| 数据库 | SQLCipher | SQLCipher | AES-256加密 |
| 向量数据库 | ChromaDB/Qdrant | ChromaDB-Lite | PC端可用完整版 |
| LLM | LLaMA3-8B (Ollama) | MiniCPM-2B | 移动端使用轻量模型 |
| Embedding模型 | bge-large-zh-v1.5 | bge-small-zh-v1.5 | 中文优化 |
| Git客户端 | libgit2 | JGit/libgit2 | 原生Git操作 |
| 加密库 | OpenSSL + U盾SDK | BouncyCastle + SIM卡API | 硬件加密 |

---

### 2.2 去中心化社交模块

#### 2.2.1 功能描述
构建基于身份自主权(DID)的去中心化社交网络,用户完全掌控自己的社交图谱和内容,无需依赖中心化平台。

#### 2.2.2 架构设计

```
去中心化社交
├── 身份层 (DID - Decentralized Identity)
│   ├── 身份生成 (基于U盾/SIMKey的公私钥对)
│   ├── DID文档
│   │   ├── DID标识符: did:chainlesschain:<public_key_hash>
│   │   ├── 公钥列表 (加密、签名、认证)
│   │   ├── 服务端点 (个人节点地址)
│   │   └── 验证方法
│   └── 可验证凭证 (Verifiable Credentials)
│       ├── 自我声明 (昵称、头像、简介)
│       ├── 信任背书 (他人签名的凭证)
│       └── 技能证书 (链上存证)
│
├── 通信层 (P2P Network)
│   ├── 节点发现
│   │   ├── DHT (分布式哈希表) - Kademlia
│   │   ├── 引导节点 (Bootstrap Nodes)
│   │   └── mDNS (本地网络发现)
│   │
│   ├── 消息传输
│   │   ├── WebRTC (直接P2P通信)
│   │   ├── QUIC协议 (低延迟)
│   │   ├── 中继节点 (NAT穿透失败时)
│   │   └── 离线消息存储 (临时中继)
│   │
│   └── 消息加密
│       ├── Signal协议 (端到端加密)
│       ├── 双棘轮算法 (前向安全)
│       └── 会话密钥管理
│
├── 内容层
│   ├── 内容类型
│   │   ├── 文本动态 (类似微博)
│   │   ├── 长文章 (类似博客)
│   │   ├── 私密消息 (加密聊天)
│   │   └── 群组讨论
│   │
│   ├── 内容存储
│   │   ├── 本地存储 (自己的内容)
│   │   ├── IPFS (公开内容的分布式存储)
│   │   ├── 缓存 (关注者的内容)
│   │   └── Git仓库 (版本历史)
│   │
│   └── 内容分发
│       ├── 关注者推送 (主动推送给在线关注者)
│       ├── 拉取同步 (用户主动拉取更新)
│       └── 中继广播 (通过友好节点传播)
│
├── 社交图谱层
│   ├── 关系管理
│   │   ├── 关注/粉丝 (单向关注)
│   │   ├── 好友 (双向关注)
│   │   ├── 分组 (自定义标签)
│   │   └── 黑名单
│   │
│   ├── 信任网络
│   │   ├── 信任评分 (基于互动历史)
│   │   ├── Web of Trust (信任传递)
│   │   └── 信誉证明 (区块链锚定)
│   │
│   └── 隐私控制
│       ├── 内容可见性 (公开/仅好友/私密)
│       ├── 选择性同步 (只缓存感兴趣的内容)
│       └── 匿名模式 (临时身份)
│
└── 发现层
    ├── 内容发现
    │   ├── 时间线 (关注者内容流)
    │   ├── 话题标签 (#hashtag)
    │   ├── 全文搜索 (本地索引)
    │   └── 推荐算法 (本地AI推荐)
    │
    └── 用户发现
        ├── 好友推荐 (共同好友)
        ├── 兴趣匹配 (基于内容分析)
        └── 附近的人 (蓝牙/GPS可选)
```

#### 2.2.3 核心流程

**用户注册流程**:
```
1. 用户选择创建新身份
2. U盾/SIMKey生成密钥对 (Ed25519签名 + X25519加密)
3. 生成DID标识符: did:chainlesschain:<pubkey_hash>
4. 创建DID文档并自签名
5. 配置个人节点 (可选自托管或使用免费中继)
6. 发布DID文档到DHT网络
7. 生成DID二维码/链接供他人添加
```

**添加好友流程**:
```
1. 用户A扫描用户B的DID二维码
2. 从DHT网络获取B的DID文档
3. 验证DID文档签名
4. 发送好友请求 (使用B的加密公钥加密)
   - 消息内容: A的DID + 公钥 + 自我介绍 + 签名
5. B收到请求后验证签名
6. B同意后建立Signal加密会话
7. 双方交换公钥,存储到本地联系人数据库
8. 开始P2P通信
```

**发布动态流程**:
```
1. 用户撰写动态内容
2. 选择可见性级别 (公开/好友/私密)
3. 内容签名 (私钥签名证明authorship)
4. 如果是公开内容:
   - 上传到IPFS获取CID
   - 将CID + 元数据发布到DHT
5. 如果是好友可见:
   - 加密内容 (每个好友的公钥单独加密)
   - 通过P2P推送给在线好友
   - 离线好友消息存储在中继节点
6. 记录到本地Git仓库 (版本历史)
7. 更新本地内容索引
```

**查看时间线流程**:
```
1. 用户打开时间线
2. 从本地数据库读取缓存内容
3. 并行向所有关注者的节点拉取更新
   - 发送最后同步时间戳
   - 获取增量更新
4. 验证每条内容的签名
5. 解密私密内容
6. 合并排序显示 (按时间/算法推荐)
7. 异步下载多媒体资源 (图片、视频)
8. 更新本地缓存
```

#### 2.2.4 数据模型

**本地社交数据库表结构**:

```sql
-- DID身份表 (本人的多个身份)
CREATE TABLE identities (
    did TEXT PRIMARY KEY,
    nickname TEXT,
    avatar_path TEXT,
    bio TEXT,
    public_key_sign TEXT NOT NULL,  -- 签名公钥
    public_key_encrypt TEXT NOT NULL,  -- 加密公钥
    private_key_ref TEXT NOT NULL,  -- U盾/SIMKey中的私钥引用
    did_document TEXT NOT NULL,  -- JSON格式的DID文档
    created_at INTEGER NOT NULL,
    is_default INTEGER DEFAULT 0
);

-- 联系人表
CREATE TABLE contacts (
    did TEXT PRIMARY KEY,
    nickname TEXT,
    avatar_url TEXT,
    bio TEXT,
    public_key_sign TEXT NOT NULL,
    public_key_encrypt TEXT NOT NULL,
    did_document TEXT,
    relationship TEXT,  -- 'following', 'follower', 'friend', 'blocked'
    trust_score REAL DEFAULT 0.0,  -- 0-1之间的信任评分
    tags TEXT,  -- JSON数组: 分组标签
    node_address TEXT,  -- 对方的节点地址
    last_seen INTEGER,
    added_at INTEGER NOT NULL
);

-- 动态内容表
CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    author_did TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT DEFAULT 'text',  -- 'text', 'article', 'image', 'video'
    media_urls TEXT,  -- JSON数组: 多媒体附件
    visibility TEXT DEFAULT 'public',  -- 'public', 'friends', 'private'
    ipfs_cid TEXT,  -- 公开内容的IPFS CID
    signature TEXT NOT NULL,  -- 作者签名
    created_at INTEGER NOT NULL,
    synced_at INTEGER,
    is_local INTEGER DEFAULT 0,  -- 是否本人发布
    FOREIGN KEY (author_did) REFERENCES contacts(did)
);

-- 私密消息表
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_did TEXT NOT NULL,
    receiver_did TEXT NOT NULL,
    content_encrypted BLOB NOT NULL,  -- Signal协议加密
    media_encrypted BLOB,
    ratchet_state TEXT,  -- Signal双棘轮状态
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    read_at INTEGER,
    FOREIGN KEY (sender_did) REFERENCES contacts(did),
    FOREIGN KEY (receiver_did) REFERENCES contacts(did)
);

-- 群组表
CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    avatar_path TEXT,
    creator_did TEXT NOT NULL,
    group_key_encrypted BLOB NOT NULL,  -- 群组对称密钥(用成员公钥加密)
    created_at INTEGER NOT NULL,
    FOREIGN KEY (creator_did) REFERENCES contacts(did)
);

-- 群组成员表
CREATE TABLE group_members (
    group_id TEXT,
    member_did TEXT,
    role TEXT DEFAULT 'member',  -- 'admin', 'member'
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, member_did),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (member_did) REFERENCES contacts(did)
);

-- 信任背书表 (Web of Trust)
CREATE TABLE endorsements (
    id TEXT PRIMARY KEY,
    endorser_did TEXT NOT NULL,  -- 背书人
    endorsee_did TEXT NOT NULL,  -- 被背书人
    skill_or_trait TEXT NOT NULL,  -- 背书的技能或特质
    comment TEXT,
    signature TEXT NOT NULL,  -- 背书人签名
    created_at INTEGER NOT NULL,
    FOREIGN KEY (endorser_did) REFERENCES contacts(did),
    FOREIGN KEY (endorsee_did) REFERENCES contacts(did)
);
```

#### 2.2.5 技术选型

| 组件 | 技术选择 | 说明 |
|------|---------|------|
| DID标准 | W3C DID Core | 符合国际标准 |
| P2P网络 | libp2p | 成熟的P2P通信库 |
| NAT穿透 | WebRTC + STUN/TURN | 支持直连和中继 |
| 端到端加密 | Signal协议 | 行业标准,前向安全 |
| 分布式存储 | IPFS | 公开内容的永久存储 |
| DHT | Kademlia | 节点发现和路由 |
| 签名算法 | Ed25519 | 高效的椭圆曲线签名 |
| 加密算法 | X25519 + ChaCha20-Poly1305 | 现代加密组合 |

---

### 2.3 去中心化交易辅助模块

#### 2.3.1 功能描述
利用AI和区块链技术,在去中心化环境下辅助用户达成可信交易,无需传统中介平台。

#### 2.3.2 架构设计

```
交易辅助系统
├── 交易发现层
│   ├── 需求发布
│   │   ├── 商品/服务描述 (AI辅助撰写)
│   │   ├── 价格范围
│   │   ├── 交易条件
│   │   └── 有效期
│   │
│   ├── 需求匹配
│   │   ├── 语义搜索 (向量检索)
│   │   ├── AI推荐引擎
│   │   ├── 反向竞价 (买家发需求,卖家报价)
│   │   └── 智能筛选 (基于信任评分)
│   │
│   └── 市场广场
│       ├── 分类浏览
│       ├── 地理位置筛选
│       └── 热门推荐
│
├── 信任评估层
│   ├── 信誉系统
│   │   ├── 交易历史记录 (区块链存证)
│   │   ├── 评价体系 (5星评分 + 文字评价)
│   │   ├── 信用分计算 (多维度加权)
│   │   └── 信誉证明 (零知识证明)
│   │
│   ├── 身份验证
│   │   ├── DID身份绑定
│   │   ├── 实名认证 (可选,隐私保护)
│   │   ├── 技能认证 (第三方背书)
│   │   └── 押金质押 (高价值交易)
│   │
│   └── 风险评估
│       ├── AI欺诈检测
│       ├── 异常行为识别
│       ├── 交易金额风险评级
│       └── 争议历史查询
│
├── 交易协商层
│   ├── 智能合约
│   │   ├── 合约模板库
│   │   │   ├── 商品买卖
│   │   │   ├── 服务交付
│   │   │   ├── 租赁协议
│   │   │   └── 合作协议
│   │   │
│   │   ├── 合约编辑器 (可视化)
│   │   ├── AI合约审查 (检查条款合理性)
│   │   └── 多签执行 (双方或多方签名)
│   │
│   ├── 条款协商
│   │   ├── 在线聊天 (端到端加密)
│   │   ├── AI协商助手
│   │   │   ├── 建议合理价格
│   │   │   ├── 起草条款
│   │   │   ├── 风险提示
│   │   │   └── 历史案例参考
│   │   └── 条款版本管理
│   │
│   └── 支付托管
│       ├── 加密货币托管 (智能合约)
│       │   ├── 买家支付到合约
│       │   ├── 满足条件后释放给卖家
│       │   └── 争议时仲裁解锁
│       │
│       ├── 法币托管 (可选第三方)
│       └── 混合支付 (部分押金 + 部分尾款)
│
├── 交易执行层
│   ├── 里程碑管理
│   │   ├── 交易阶段划分
│   │   ├── 阶段性验收
│   │   ├── 分期付款
│   │   └── 进度跟踪
│   │
│   ├── 证据管理
│   │   ├── 聊天记录存证
│   │   ├── 交付凭证上传 (图片、文件)
│   │   ├── 区块链时间戳
│   │   └── 哈希校验
│   │
│   └── 确认与评价
│       ├── 买家确认收货
│       ├── 卖家确认收款
│       ├── 双向评价
│       └── NFT交易证明 (可选)
│
└── 争议解决层
    ├── 争议发起
    │   ├── 申诉理由
    │   ├── 证据提交
    │   └── 赔偿要求
    │
    ├── 仲裁机制
    │   ├── 去中心化仲裁员网络
    │   │   ├── 仲裁员DID注册
    │   │   ├── 专业领域标注
    │   │   ├── 仲裁员信誉
    │   │   └── 随机选择 + 双方挑战
    │   │
    │   ├── 仲裁流程
    │   │   ├── 证据展示
    │   │   ├── 双方陈述
    │   │   ├── 仲裁员投票
    │   │   └── 判决执行
    │   │
    │   └── AI辅助仲裁
    │       ├── 相似案例检索
    │       ├── 法律条款匹配
    │       └── 判决建议
    │
    └── 强制执行
        ├── 智能合约自动执行判决
        ├── 信誉惩罚 (降低信用分)
        ├── 黑名单机制
        └── 损失赔付 (从押金扣除)
```

#### 2.3.3 核心流程

**发布交易需求流程**:
```
1. 用户选择交易类型 (买/卖/服务)
2. AI助手帮助用户完善描述
   - 智能提问收集信息
   - 建议合理价格区间 (基于历史数据)
   - 生成专业描述文案
3. 设置交易条件
   - 价格/报价方式
   - 交付时间
   - 质量要求
   - 支付方式
4. 用户签名发布
5. 内容加密后广播到P2P网络
6. 索引到本地和DHT网络
7. AI自动匹配潜在交易方并推送通知
```

**交易撮合流程**:
```
1. 用户B看到用户A的需求
2. 查看A的信誉分和交易历史
3. AI分析交易风险并给出建议
4. B提交报价/意向
5. A收到报价,比较多个报价
6. A选择B,发起协商
7. 双方在加密聊天室讨论细节
8. AI助手实时提供:
   - 条款建议
   - 风险提示
   - 类似交易参考价格
9. 达成一致后选择智能合约模板
10. 双方审阅并签署合约
11. 进入交易执行阶段
```

**智能合约交易流程** (以商品买卖为例):
```
1. 双方签署智能合约
2. 买家支付金额到合约地址
   - 支持加密货币 (ETH/USDT等)
   - 或托管到可信第三方
3. 卖家看到款项锁定,开始发货
4. 卖家上传发货凭证 (快递单号 + 照片)
   - 哈希存储到区块链
5. 买家收到货物
6. 买家确认收货或提出问题
   - 如满意: 触发合约释放款项给卖家
   - 如不满意: 发起争议流程
7. 双方互相评价
8. 交易记录上链,影响信誉分
```

**争议仲裁流程**:
```
1. 买家/卖家发起争议
2. 冻结合约中的资金
3. 系统从仲裁员池随机选择3-5名仲裁员
   - 选择标准: 信誉高、相关领域经验、无利益冲突
4. 双方各有1次仲裁员挑战权 (更换不信任的仲裁员)
5. 仲裁员查看:
   - 智能合约条款
   - 聊天记录
   - 证据材料 (照片、文件、物流信息)
   - AI提供的相似案例
6. 仲裁员独立投票
   - 完全支持买家
   - 完全支持卖家
   - 折中方案 (比如退50%款)
7. 按多数票执行判决
8. 智能合约自动分配资金
9. 败诉方信誉分下降,仲裁费用由败诉方承担
```

#### 2.3.4 数据模型

**交易数据库表结构**:

```sql
-- 交易需求/供给表
CREATE TABLE listings (
    id TEXT PRIMARY KEY,
    publisher_did TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'buy', 'sell', 'service_offer', 'service_request'
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price_min REAL,
    price_max REAL,
    currency TEXT DEFAULT 'CNY',
    location TEXT,  -- 地理位置 (可选)
    delivery_method TEXT,  -- 'in_person', 'shipping', 'digital'
    conditions TEXT,  -- JSON: 交易条件
    status TEXT DEFAULT 'active',  -- 'active', 'matched', 'completed', 'cancelled'
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (publisher_did) REFERENCES contacts(did)
);

-- 交易订单表
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    listing_id TEXT,
    buyer_did TEXT NOT NULL,
    seller_did TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    contract_address TEXT,  -- 智能合约地址 (如果使用区块链)
    contract_terms TEXT NOT NULL,  -- JSON: 合约条款
    milestones TEXT,  -- JSON: 里程碑数组
    current_milestone INTEGER DEFAULT 0,
    status TEXT DEFAULT 'negotiating',
    -- 'negotiating', 'contract_signed', 'payment_locked',
    -- 'in_progress', 'completed', 'disputed', 'cancelled'
    created_at INTEGER NOT NULL,
    signed_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (listing_id) REFERENCES listings(id),
    FOREIGN KEY (buyer_did) REFERENCES contacts(did),
    FOREIGN KEY (seller_did) REFERENCES contacts(did)
);

-- 交易聊天消息表 (关联到交易)
CREATE TABLE transaction_messages (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    sender_did TEXT NOT NULL,
    message_encrypted BLOB NOT NULL,
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (sender_did) REFERENCES contacts(did)
);

-- 交易证据表
CREATE TABLE transaction_evidence (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    uploader_did TEXT NOT NULL,
    evidence_type TEXT NOT NULL,  -- 'image', 'document', 'tracking_number', 'receipt'
    file_path TEXT,
    file_hash TEXT NOT NULL,  -- SHA-256哈希
    blockchain_tx TEXT,  -- 区块链存证交易哈希
    description TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (uploader_did) REFERENCES contacts(did)
);

-- 评价表
CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    reviewer_did TEXT NOT NULL,
    reviewee_did TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    tags TEXT,  -- JSON数组: ['professional', 'fast', 'quality']
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    blockchain_tx TEXT,  -- 评价上链交易哈希
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (reviewer_did) REFERENCES contacts(did),
    FOREIGN KEY (reviewee_did) REFERENCES contacts(did)
);

-- 信誉分表 (定期计算)
CREATE TABLE reputation_scores (
    did TEXT PRIMARY KEY,
    overall_score REAL NOT NULL DEFAULT 0.0,  -- 综合信誉分 0-1000
    transaction_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    dispute_count INTEGER DEFAULT 0,
    avg_rating REAL DEFAULT 0.0,
    buyer_score REAL DEFAULT 0.0,  -- 买家信誉
    seller_score REAL DEFAULT 0.0,  -- 卖家信誉
    response_time_score REAL DEFAULT 0.0,  -- 响应速度
    completion_rate REAL DEFAULT 0.0,  -- 完成率
    last_updated INTEGER NOT NULL,
    FOREIGN KEY (did) REFERENCES contacts(did)
);

-- 争议表
CREATE TABLE disputes (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    initiator_did TEXT NOT NULL,
    respondent_did TEXT NOT NULL,
    reason TEXT NOT NULL,
    claim_amount REAL,
    evidence_ids TEXT,  -- JSON数组: 证据ID列表
    status TEXT DEFAULT 'pending',
    -- 'pending', 'arbitration', 'resolved', 'rejected'
    resolution TEXT,  -- JSON: 仲裁结果
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (initiator_did) REFERENCES contacts(did),
    FOREIGN KEY (respondent_did) REFERENCES contacts(did)
);

-- 仲裁员表
CREATE TABLE arbitrators (
    did TEXT PRIMARY KEY,
    specialties TEXT NOT NULL,  -- JSON数组: 专业领域
    languages TEXT NOT NULL,  -- JSON数组: 语言能力
    arbitration_count INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    avg_resolution_time INTEGER,  -- 平均仲裁时长(秒)
    reputation_score REAL DEFAULT 0.0,
    is_active INTEGER DEFAULT 1,
    joined_at INTEGER NOT NULL,
    FOREIGN KEY (did) REFERENCES contacts(did)
);

-- 仲裁案件表
CREATE TABLE arbitration_cases (
    id TEXT PRIMARY KEY,
    dispute_id TEXT NOT NULL,
    arbitrators TEXT NOT NULL,  -- JSON数组: 仲裁员DID列表
    votes TEXT,  -- JSON: 仲裁员投票结果
    final_decision TEXT NOT NULL,
    reasoning TEXT,  -- AI生成的判决理由
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    FOREIGN KEY (dispute_id) REFERENCES disputes(id)
);
```

#### 2.3.5 智能合约示例 (Solidity伪代码)

```solidity
// 简单的托管合约
contract EscrowContract {
    address public buyer;
    address public seller;
    address public arbitrator;
    uint256 public amount;
    bool public buyerConfirmed;
    bool public sellerConfirmed;
    enum State { Created, Locked, Released, Disputed, Refunded }
    State public state;

    constructor(address _seller, address _arbitrator) payable {
        buyer = msg.sender;
        seller = _seller;
        arbitrator = _arbitrator;
        amount = msg.value;
        state = State.Created;
    }

    function confirmReceipt() public {
        require(msg.sender == buyer);
        require(state == State.Locked);
        buyerConfirmed = true;
        if (sellerConfirmed) releaseFunds();
    }

    function releaseFunds() private {
        state = State.Released;
        payable(seller).transfer(amount);
    }

    function raiseDispute() public {
        require(msg.sender == buyer || msg.sender == seller);
        state = State.Disputed;
    }

    function resolveDispute(uint8 buyerPercent) public {
        require(msg.sender == arbitrator);
        require(state == State.Disputed);
        uint256 buyerAmount = (amount * buyerPercent) / 100;
        uint256 sellerAmount = amount - buyerAmount;
        payable(buyer).transfer(buyerAmount);
        payable(seller).transfer(sellerAmount);
        state = State.Released;
    }
}
```

#### 2.3.6 AI辅助功能

**交易描述优化**:
```python
# AI Prompt示例
system_prompt = """你是一个交易助手,帮助用户撰写清晰、吸引人的交易描述。
请根据用户输入的关键信息,生成专业的交易描述,包括:
1. 标题 (简洁有力,20字以内)
2. 详细描述 (200-500字)
3. 建议价格区间 (参考市场行情)
4. 注意事项
"""

user_input = "我想卖一台用了2年的MacBook Pro, 16GB内存, 512GB硬盘, 95成新"
# AI生成优化后的listing
```

**价格建议**:
```python
# 基于历史交易数据和市场行情
def suggest_price(item_description, condition, historical_data):
    # 1. 向量检索相似商品的历史交易
    similar_items = vector_search(item_description, top_k=20)

    # 2. 根据成色调整价格
    condition_factor = {'全新': 1.0, '99新': 0.95, '95新': 0.80, '9成新': 0.65}

    # 3. 计算建议价格
    prices = [item.price * condition_factor[condition] for item in similar_items]
    suggested_min = percentile(prices, 25)
    suggested_max = percentile(prices, 75)

    return suggested_min, suggested_max
```

**风险评估**:
```python
# AI评估交易风险
def assess_transaction_risk(transaction_data, user_reputation):
    risk_factors = []
    risk_score = 0.0

    # 1. 对方信誉检查
    if user_reputation.overall_score < 500:
        risk_factors.append("对方信誉较低")
        risk_score += 0.3

    # 2. 交易金额
    if transaction_data.amount > 10000:
        risk_factors.append("交易金额较大")
        risk_score += 0.2

    # 3. 账号年龄
    if user_reputation.account_age_days < 30:
        risk_factors.append("对方账号注册时间较短")
        risk_score += 0.2

    # 4. AI文本分析 (检测异常用词)
    if detect_fraud_patterns(transaction_data.description):
        risk_factors.append("描述中包含可疑内容")
        risk_score += 0.4

    return {
        'risk_level': 'high' if risk_score > 0.6 else 'medium' if risk_score > 0.3 else 'low',
        'risk_score': risk_score,
        'factors': risk_factors,
        'recommendations': generate_recommendations(risk_factors)
    }
```

---

### 2.4 项目管理模块 ⭐核心模块

#### 2.4.1 功能描述

**项目管理模块是整个系统最核心、对用户最有直接价值的模块**,它将AI能力转化为实际的生产力工具。用户通过自然语言对话的方式下达指令,AI助手帮助完成各种文件处理和创作任务,所有项目文件统一管理,实现真正的AI辅助工作流。

**核心价值**:
- **对话式工作流**: 用户只需用自然语言描述需求,无需掌握复杂软件
- **全能文件处理**: 支持网页、文档、数据、演示、视频等几乎所有常见文件类型
- **项目化管理**: 每个项目独立文件夹,清晰的文件组织和版本控制
- **知识库集成**: 项目可引用知识库内容,知识库也可从项目中学习
- **协作与分享**: 项目可以通过社交模块分享,也可作为商品在交易市场出售

#### 2.4.2 架构设计

```
项目管理系统
├── 项目生命周期管理层
│   ├── 项目创建
│   │   ├── 项目类型选择 (预设模板)
│   │   ├── 项目信息设置 (名称、描述、目标)
│   │   ├── 文件夹结构初始化
│   │   └── Git仓库初始化 (版本控制)
│   │
│   ├── 项目组织
│   │   ├── 项目分类管理
│   │   │   ├── Web开发 (网站、Web应用)
│   │   │   ├── 文档处理 (Word、PDF、Markdown)
│   │   │   ├── 数据分析 (Excel、CSV、数据库)
│   │   │   ├── 报告撰写 (研究报告、工作总结)
│   │   │   ├── 演示文稿 (PPT、Keynote)
│   │   │   ├── 视频制作 (剪辑、字幕、特效)
│   │   │   ├── 图像设计 (平面设计、UI设计)
│   │   │   ├── 代码开发 (软件项目)
│   │   │   └── 混合项目 (多类型组合)
│   │   │
│   │   ├── 标签系统 (自定义标签、智能分类)
│   │   ├── 收藏夹 (快速访问常用项目)
│   │   └── 归档管理 (完成项目归档)
│   │
│   └── 项目监控
│       ├── 进度追踪 (任务完成度)
│       ├── 文件变更监控 (Git diff)
│       ├── 资源使用统计 (存储、AI tokens)
│       └── 协作者活动记录
│
├── 对话式指令处理层 (核心引擎)
│   ├── 自然语言理解 (NLU)
│   │   ├── 意图识别
│   │   │   ├── 创建任务 ("帮我制作一个产品介绍网页")
│   │   │   ├── 编辑任务 ("把标题改成蓝色")
│   │   │   ├── 查询任务 ("这个项目有哪些文件?")
│   │   │   ├── 分析任务 ("分析这份销售数据的趋势")
│   │   │   └── 导出任务 ("生成PDF版本")
│   │   │
│   │   ├── 实体抽取
│   │   │   ├── 文件名、路径
│   │   │   ├── 操作对象 (段落、图片、表格)
│   │   │   ├── 样式参数 (颜色、字体、尺寸)
│   │   │   └── 数据引用 (知识库条目、外部资源)
│   │   │
│   │   └── 上下文管理
│   │       ├── 对话历史记忆 (多轮对话)
│   │       ├── 项目上下文 (当前文件、已完成任务)
│   │       └── 用户偏好学习 (常用风格、习惯)
│   │
│   ├── 任务规划
│   │   ├── 任务拆解 (复杂任务 → 子任务)
│   │   ├── 依赖关系分析 (任务执行顺序)
│   │   ├── 资源评估 (需要的工具、API、模型)
│   │   └── 执行计划生成 (步骤列表)
│   │
│   ├── 工具调用
│   │   ├── Function Calling (LLM原生工具调用)
│   │   ├── 工具库管理
│   │   │   ├── 文件操作工具 (读、写、删、移动)
│   │   │   ├── 格式转换工具 (Word↔PDF, CSV↔Excel)
│   │   │   ├── 代码执行工具 (Python、JavaScript沙箱)
│   │   │   ├── 外部API工具 (Web搜索、图像生成)
│   │   │   └── 自定义工具 (用户编写的脚本)
│   │   │
│   │   └── 工具链编排 (多工具协作)
│   │
│   └── 结果验证与反馈
│       ├── 输出质量检查 (格式、内容完整性)
│       ├── 用户确认机制 (敏感操作前确认)
│       ├── 错误处理与重试
│       └── 学习与优化 (从用户反馈改进)
│
├── 文件处理引擎层
│   ├── Web开发引擎
│   │   ├── HTML生成 (语义化、响应式)
│   │   ├── CSS样式 (现代框架: Tailwind, Bootstrap)
│   │   ├── JavaScript交互 (Vue、React组件)
│   │   ├── 静态站点生成 (Jekyll, Hugo)
│   │   ├── 本地预览服务器
│   │   └── 部署辅助 (GitHub Pages, Vercel)
│   │
│   ├── 文档处理引擎
│   │   ├── Word文档
│   │   │   ├── python-docx (创建、编辑)
│   │   │   ├── 样式模板库 (商务、学术、报告)
│   │   │   ├── 智能排版 (章节、目录、页码)
│   │   │   └── 内容增强 (AI润色、扩写)
│   │   │
│   │   ├── PDF文档
│   │   │   ├── 生成 (ReportLab, WeasyPrint)
│   │   │   ├── 编辑 (PyPDF2, pdfrw)
│   │   │   ├── 解析 (pdfplumber, OCR)
│   │   │   └── 表单填充 (自动填表)
│   │   │
│   │   ├── Markdown
│   │   │   ├── 渲染 (GitHub风格、自定义主题)
│   │   │   ├── 导出 (HTML、PDF、Word)
│   │   │   └── 图表支持 (Mermaid, PlantUML)
│   │   │
│   │   └── 富文本编辑
│   │       ├── 所见即所得编辑器
│   │       ├── 协同编辑 (OT算法)
│   │       └── 版本对比 (diff可视化)
│   │
│   ├── 数据处理引擎
│   │   ├── Excel/CSV
│   │   │   ├── pandas (数据分析)
│   │   │   ├── openpyxl (Excel读写)
│   │   │   ├── 数据清洗 (去重、填充、转换)
│   │   │   └── 公式计算 (复杂业务逻辑)
│   │   │
│   │   ├── 数据分析
│   │   │   ├── 统计分析 (描述性、推断性)
│   │   │   ├── 可视化 (matplotlib, plotly)
│   │   │   ├── 机器学习 (scikit-learn)
│   │   │   └── AI数据洞察 (趋势分析、异常检测)
│   │   │
│   │   ├── 数据库操作
│   │   │   ├── SQL查询生成 (自然语言→SQL)
│   │   │   ├── SQLite本地库
│   │   │   └── 远程数据库连接 (MySQL, PostgreSQL)
│   │   │
│   │   └── 报表生成
│   │       ├── 交互式仪表盘 (Streamlit, Dash)
│   │       ├── 定时报表 (自动化任务)
│   │       └── 多维数据分析 (OLAP)
│   │
│   ├── 演示文稿引擎
│   │   ├── PPT生成
│   │   │   ├── python-pptx (创建、编辑)
│   │   │   ├── 模板库 (商务、教育、创意)
│   │   │   ├── AI内容生成 (大纲→完整PPT)
│   │   │   └── 智能排版 (布局、对齐、配色)
│   │   │
│   │   ├── 多媒体集成
│   │   │   ├── 图片处理 (压缩、裁剪)
│   │   │   ├── 图表嵌入 (数据可视化)
│   │   │   └── 视频嵌入
│   │   │
│   │   └── 演讲辅助
│   │       ├── 演讲稿生成
│   │       ├── 动画效果
│   │       └── 导出格式 (PDF、视频)
│   │
│   ├── 视频处理引擎
│   │   ├── 视频剪辑
│   │   │   ├── moviepy (Python视频编辑)
│   │   │   ├── FFmpeg (格式转换、压缩)
│   │   │   ├── 剪辑操作 (剪切、合并、调速)
│   │   │   └── 滤镜特效
│   │   │
│   │   ├── 字幕处理
│   │   │   ├── AI语音识别 (Whisper)
│   │   │   ├── 字幕生成 (SRT、ASS)
│   │   │   ├── 字幕翻译
│   │   │   └── 字幕烧录
│   │   │
│   │   ├── AI增强
│   │   │   ├── 视频摘要 (关键帧提取)
│   │   │   ├── 场景分割
│   │   │   ├── 人脸识别与追踪
│   │   │   └── 自动配乐 (AI音乐生成)
│   │   │
│   │   └── 导出与发布
│   │       ├── 多分辨率导出
│   │       ├── 平台优化 (抖音、B站)
│   │       └── 直接上传 (API集成)
│   │
│   ├── 图像设计引擎
│   │   ├── AI绘图
│   │   │   ├── Stable Diffusion (文生图)
│   │   │   ├── ControlNet (精确控制)
│   │   │   ├── 图像编辑 (局部重绘)
│   │   │   └── 风格转换
│   │   │
│   │   ├── 平面设计
│   │   │   ├── 自动布局 (海报、名片)
│   │   │   ├── 图标生成
│   │   │   ├── 配色方案 (AI推荐)
│   │   │   └── 矢量图形 (SVG)
│   │   │
│   │   └── 图片处理
│   │       ├── Pillow (基础操作)
│   │       ├── 背景移除
│   │       ├── 图像增强 (超分辨率)
│   │       └── 批量处理
│   │
│   └── 代码开发引擎
│       ├── 代码生成
│       │   ├── 多语言支持 (Python、JS、Java、Go等)
│       │   ├── 框架代码 (Flask、Express、Spring)
│       │   ├── 单元测试生成
│       │   └── 文档注释生成
│       │
│       ├── 代码辅助
│       │   ├── 代码补全 (基于上下文)
│       │   ├── Bug修复建议
│       │   ├── 代码重构
│       │   └── 性能优化建议
│       │
│       └── 项目脚手架
│           ├── 快速初始化 (create-react-app风格)
│           ├── 依赖管理 (自动安装)
│           ├── 配置文件生成
│           └── Git初始化与提交
│
├── 项目存储层
│   ├── 文件系统组织
│   │   ├── 根目录结构
│   │   │   ├── projects/ (与knowledge/同级)
│   │   │   │   ├── <project_id_1>/
│   │   │   │   │   ├── .project.json (项目元数据)
│   │   │   │   │   ├── .git/ (版本控制)
│   │   │   │   │   ├── sources/ (源文件)
│   │   │   │   │   ├── outputs/ (生成的文件)
│   │   │   │   │   ├── assets/ (资源文件: 图片、视频)
│   │   │   │   │   ├── data/ (数据文件)
│   │   │   │   │   ├── docs/ (文档)
│   │   │   │   │   └── README.md (项目说明)
│   │   │   │   └── <project_id_2>/
│   │   │   │
│   │   │   └── knowledge/ (知识库目录)
│   │   │
│   │   ├── 项目模板库
│   │   │   ├── templates/
│   │   │   │   ├── web/
│   │   │   │   ├── document/
│   │   │   │   ├── data-analysis/
│   │   │   │   ├── presentation/
│   │   │   │   └── custom/
│   │   │   └── 模板变量替换
│   │   │
│   │   └── 备份策略
│   │       ├── 自动快照 (每次重大变更)
│   │       ├── 增量备份 (rsync)
│   │       └── 云端同步 (可选)
│   │
│   ├── 元数据数据库 (SQLCipher)
│   │   ├── 项目表
│   │   ├── 文件表
│   │   ├── 任务表
│   │   ├── 对话历史表
│   │   └── 项目协作者表
│   │
│   └── 版本控制
│       ├── Git集成
│       │   ├── 自动提交 (每次AI修改)
│       │   ├── 提交信息自动生成 (AI总结变更)
│       │   ├── 分支管理 (功能分支)
│       │   └── 版本回溯 (时间旅行)
│       │
│       └── 冲突解决
│           ├── 多设备同步冲突
│           ├── AI辅助合并
│           └── 用户选择策略
│
├── AI协作层
│   ├── 多模型协同
│   │   ├── 思维模型 (LLM)
│   │   │   ├── 任务理解与规划 (GPT-4、Claude)
│   │   │   ├── 内容生成 (文字创作)
│   │   │   └── 代码生成 (Codex、StarCoder)
│   │   │
│   │   ├── 专用模型
│   │   │   ├── 图像生成 (DALL-E、Midjourney、SD)
│   │   │   ├── 语音识别 (Whisper)
│   │   │   ├── 语音合成 (TTS)
│   │   │   ├── 视频理解 (VideoLLM)
│   │   │   └── OCR (PaddleOCR, Tesseract)
│   │   │
│   │   └── 嵌入模型
│   │       ├── 文本向量化 (用于知识检索)
│   │       ├── 图像向量化 (相似图搜索)
│   │       └── 跨模态检索 (CLIP)
│   │
│   ├── 提示词工程
│   │   ├── 系统提示词库
│   │   │   ├── 角色定义 (Web开发专家、数据分析师)
│   │   │   ├── 输出格式约束 (JSON、Markdown)
│   │   │   └── 质量要求 (专业、简洁、详细)
│   │   │
│   │   ├── 动态提示词组装
│   │   │   ├── 项目上下文注入
│   │   │   ├── 用户偏好注入
│   │   │   ├── 知识库检索结果注入 (RAG)
│   │   │   └── Few-shot示例选择
│   │   │
│   │   └── 提示词优化
│   │       ├── A/B测试
│   │       ├── 自动优化 (基于效果反馈)
│   │       └── 用户自定义提示词
│   │
│   ├── 知识库集成 (与2.1模块联动)
│   │   ├── 项目引用知识
│   │   │   ├── 对话中@知识条目
│   │   │   ├── 自动检索相关知识 (RAG)
│   │   │   ├── 知识作为项目模板
│   │   │   └── 知识作为Few-shot示例
│   │   │
│   │   └── 知识从项目学习
│   │       ├── 项目对话自动保存为知识
│   │       ├── 优秀输出标记为知识
│   │       ├── 项目文件导入知识库
│   │       └── 经验总结 (项目复盘→知识条目)
│   │
│   └── Agent工作流
│       ├── ReAct (推理-行动循环)
│       ├── 自主任务分解
│       ├── 工具使用学习
│       └── 自我反思与改进
│
└── 模块集成层
    ├── 与知识库模块集成 (2.1)
    │   ├── 知识检索增强 (项目AI使用知识库)
    │   ├── 知识沉淀 (项目经验→知识库)
    │   ├── 模板共享 (项目模板存储在知识库)
    │   └── 统一向量检索
    │
    ├── 与社交模块集成 (2.2)
    │   ├── 项目分享
    │   │   ├── 项目展示页生成 (预览、截图)
    │   │   ├── 分享到动态 (带链接)
    │   │   ├── 协作邀请 (多人编辑)
    │   │   └── 开源项目发布
    │   │
    │   └── 协作功能
    │       ├── 好友协作 (实时编辑)
    │       ├── 权限管理 (查看/编辑/管理)
    │       ├── 变更通知 (推送更新)
    │       └── 评论与反馈
    │
    ├── 与交易模块集成 (2.3)
    │   ├── 项目作为商品
    │   │   ├── 项目打包 (源文件+文档)
    │   │   ├── 项目定价 (按类型、复杂度)
    │   │   ├── 演示预览 (买家可查看部分内容)
    │   │   └── 版权保护 (水印、许可证)
    │   │
    │   ├── 项目交付
    │   │   ├── 智能合约托管
    │   │   ├── 分阶段交付 (里程碑)
    │   │   ├── 修改意见管理
    │   │   └── 最终验收
    │   │
    │   └── 服务市场
    │       ├── 项目定制服务 (接单)
    │       ├── AI辅助报价
    │       ├── 进度跟踪
    │       └── 自动交付
    │
    └── 扩展能力
        ├── 插件系统
        │   ├── 第三方工具集成 (Figma、Notion)
        │   ├── 自定义处理器
        │   └── API扩展
        │
        └── 自动化工作流
            ├── 定时任务 (每日报表)
            ├── 触发器 (数据变化→更新报告)
            └── 批处理 (批量文件转换)
```

#### 2.4.3 核心流程

**项目创建流程**:
```
1. 用户发起创建项目请求
   - 方式1: 对话式 ("帮我创建一个产品介绍网站项目")
   - 方式2: 选择模板 (预设项目类型)
   - 方式3: 空白项目 (完全自定义)

2. AI助手收集项目信息
   - 智能提问: "这个网站的目标用户是谁?"
   - 提取关键参数: 项目类型、规模、需求
   - 推荐模板: "根据您的需求,建议使用'单页应用'模板"

3. 创建项目结构
   - 生成唯一项目ID: proj_<timestamp>_<uuid>
   - 创建文件夹: projects/proj_xxx/
   - 初始化目录结构: sources/, outputs/, assets/, data/, docs/
   - 创建.project.json元数据文件
   - Git初始化: git init && git add . && git commit -m "Initial commit"

4. 写入数据库
   - 插入projects表
   - 创建初始任务记录
   - 建立对话会话

5. 应用项目模板 (如果选择了模板)
   - 复制模板文件到项目目录
   - 变量替换 (项目名称、作者等)
   - AI生成初始README.md

6. 开始首次对话
   - 系统消息: "项目已创建,您想从哪里开始?"
   - 用户下达第一个任务
```

**对话式任务执行流程** (核心工作流):
```
用户输入: "帮我制作一个产品介绍网页,产品是智能手表,主要卖点是续航长、健康监测、时尚外观"

1. 自然语言理解 (NLU)
   ├── 意图识别: "创建网页"
   ├── 实体抽取:
   │   ├── 文件类型: HTML网页
   │   ├── 内容主题: 产品介绍
   │   ├── 产品名称: 智能手表
   │   └── 卖点: [续航长, 健康监测, 时尚外观]
   └── 上下文检查: 当前项目类型、已有文件

2. 任务规划
   ├── AI分解任务:
   │   ├── 子任务1: 设计网页结构 (header, features, CTA)
   │   ├── 子任务2: 编写HTML框架
   │   ├── 子任务3: 编写CSS样式 (响应式)
   │   ├── 子任务4: 添加JavaScript交互 (可选)
   │   └── 子任务5: 生成预览
   │
   ├── 依赖分析: 子任务1 → 2 → 3 → 4 → 5
   └── 资源评估: 需要LLM(代码生成)、文件写入工具、预览服务器

3. 知识检索 (RAG)
   ├── 向量搜索知识库: "产品介绍网页示例"
   ├── 检索历史项目: 相似的成功案例
   └── 获取用户偏好: 之前使用的CSS框架、配色方案

4. 内容生成
   ├── 调用LLM生成HTML
   │   ├── System Prompt: "你是专业的Web开发专家,擅长创建现代、响应式的产品介绍页面..."
   │   ├── 用户需求注入: "智能手表,卖点: 续航、健康、时尚"
   │   ├── RAG上下文: [知识库中的优秀案例]
   │   └── 输出约束: "只输出完整的HTML代码,使用Tailwind CSS"
   │
   ├── 生成CSS (如果需要自定义)
   └── 生成JavaScript (交互逻辑)

5. 文件操作
   ├── 写入文件:
   │   ├── projects/proj_xxx/sources/index.html
   │   ├── projects/proj_xxx/sources/styles.css (如果有)
   │   └── projects/proj_xxx/sources/script.js (如果有)
   │
   ├── 更新数据库:
   │   ├── 插入project_files表
   │   └── 更新project_tasks表 (状态: completed)
   │
   └── Git自动提交:
       ├── git add sources/
       └── git commit -m "AI: 创建智能手表产品介绍网页"

6. 预览与展示
   ├── 启动本地HTTP服务器 (http://localhost:8080)
   ├── 生成预览截图 (headless browser)
   ├── 返回结果给用户:
   │   ├── 文件路径: /projects/proj_xxx/sources/index.html
   │   ├── 预览链接: http://localhost:8080/index.html
   │   ├── 截图预览: [缩略图]
   │   └── AI说明: "我已经创建了一个响应式的产品介绍页面,包含了您提到的三个卖点..."
   │
   └── 等待用户反馈

7. 迭代优化 (如果用户提出修改)
   用户: "把标题改成蓝色,字体加大"
   ├── 理解修改意图: 样式调整
   ├── 读取现有文件: index.html
   ├── AI生成修改后的代码 (只修改相关部分)
   ├── 写回文件
   ├── Git提交: "AI: 调整标题样式 - 蓝色,加大字体"
   └── 刷新预览,返回结果

8. 任务完成确认
   用户: "很好,就这样吧"
   ├── 更新任务状态: completed
   ├── 生成项目输出:
   │   └── 复制到outputs/目录 (可交付版本)
   ├── 询问是否保存经验到知识库:
   │   └── "是否将这次对话保存为'制作产品介绍网页'的经验?"
   └── 等待下一个任务
```

**跨文件类型任务流程** (复杂示例):
```
用户: "分析data文件夹中的销售数据,生成Excel报表和PPT演示文稿"

1. 任务拆解
   ├── 子任务1: 读取并分析sales.csv
   ├── 子任务2: 生成数据洞察 (趋势、异常、建议)
   ├── 子任务3: 创建Excel报表 (格式化、图表)
   ├── 子任务4: 生成PPT (可视化、关键发现)
   └── 依赖关系: 1 → 2 → (3 & 4 并行)

2. 数据分析阶段
   ├── 使用pandas读取CSV
   ├── 执行分析代码 (在沙箱中):
   │   ├── df.describe() - 描述性统计
   │   ├── 趋势分析 - 月度增长率
   │   ├── 异常检测 - 销售突降
   │   └── 相关性分析 - 产品类别与销售额
   │
   └── AI生成洞察报告:
       "11月销售额同比增长23%,主要由产品A驱动(占比45%)。
        但12月出现15%下滑,建议调查原因..."

3. Excel报表生成
   ├── 使用openpyxl创建工作簿
   ├── AI设计表格结构:
   │   ├── Sheet1: 原始数据
   │   ├── Sheet2: 汇总统计
   │   ├── Sheet3: 月度趋势
   │   └── Sheet4: 产品排名
   │
   ├── 插入图表 (柱状图、折线图、饼图)
   ├── 应用样式模板 (表头蓝色、数据区域斑马纹)
   └── 保存: outputs/sales_report.xlsx

4. PPT演示生成
   ├── 使用python-pptx创建演示
   ├── AI生成大纲:
   │   ├── 封面: "2024年销售数据分析"
   │   ├── 第2页: 整体概览 (总销售额、增长率)
   │   ├── 第3页: 趋势分析 (折线图)
   │   ├── 第4页: 产品分布 (饼图)
   │   ├── 第5页: 关键发现 (3-5个bullet points)
   │   └── 第6页: 行动建议
   │
   ├── 应用商务模板 (配色、字体)
   ├── 嵌入图表 (从Excel导出或重新生成)
   └── 保存: outputs/sales_presentation.pptx

5. 结果汇总
   ├── 显示文件列表:
   │   ├── ✓ outputs/sales_report.xlsx
   │   └── ✓ outputs/sales_presentation.pptx
   │
   ├── AI总结:
   │   "我已完成销售数据分析,生成了详细的Excel报表和演示文稿。
   │    主要发现: [3个关键点]。
   │    建议: [2个行动建议]"
   │
   └── 提供下载/打开选项
```

**项目协作流程** (与社交模块集成):
```
1. 项目所有者发起分享
   ├── 选择分享对象: 好友、群组、公开
   ├── 设置权限:
   │   ├── 查看: 只读,可查看文件和对话历史
   │   ├── 评论: 可添加批注和建议
   │   ├── 编辑: 可修改文件
   │   └── 管理: 可邀请他人、修改设置
   │
   └── 生成分享链接/二维码

2. 协作者加入
   ├── 扫码或点击链接
   ├── 验证DID身份
   ├── 同步项目文件到本地
   │   ├── Git clone (如果有权限)
   │   └── 只读缓存 (如果仅查看)
   │
   └── 加入项目聊天室

3. 协同工作
   ├── 实时编辑:
   │   ├── WebSocket同步
   │   ├── OT算法处理冲突
   │   ├── 显示其他人的光标位置
   │   └── 变更实时广播
   │
   ├── AI协作:
   │   ├── 每个协作者可对话AI
   │   ├── AI理解多人上下文
   │   └── AI提醒冲突 ("Bob正在编辑同一文件")
   │
   └── 版本控制:
       ├── 每人的修改自动提交
       ├── 提交信息包含作者DID
       └── 冲突时AI辅助合并

4. 项目交付 (如果是交易)
   ├── 买家提出修改意见 (留言板)
   ├── 卖家AI辅助修改
   ├── 分阶段验收 (里程碑)
   ├── 最终交付:
   │   ├── 打包项目文件
   │   ├── 生成交付文档
   │   └── 智能合约释放款项
   │
   └── 评价与归档
```

**项目商品化流程** (与交易模块集成):
```
1. 打包为商品
   ├── 项目准备:
   │   ├── 清理临时文件
   │   ├── 检查敏感信息 (API密钥等)
   │   ├── 生成完整文档 (README、使用说明)
   │   └── AI生成演示视频/截图
   │
   ├── 商品信息:
   │   ├── AI生成标题和描述
   │   ├── 自动分类 (Web、文档、数据等)
   │   ├── 标签提取 (技术栈、适用场景)
   │   └── 定价建议 (基于项目复杂度)
   │
   └── 发布到交易市场

2. 买家浏览与购买
   ├── 在市场搜索项目
   ├── 查看项目演示:
   │   ├── 预览部分代码 (前50行)
   │   ├── 在线Demo (如果是Web项目)
   │   ├── 截图/视频
   │   └── AI生成的技术说明
   │
   ├── 购买决策:
   │   ├── AI分析适用性 ("这个项目适合您吗?")
   │   ├── 查看卖家信誉
   │   └── 讨价还价 (AI协商助手)
   │
   └── 签署智能合约并支付

3. 交付与验收
   ├── 自动交付:
   │   ├── 完整源代码
   │   ├── 配置说明
   │   ├── 部署指南
   │   └── AI客服 (解答部署问题)
   │
   ├── 买家验收:
   │   ├── AI辅助测试
   │   ├── 提出问题或修改需求
   │   └── 确认或发起争议
   │
   └── 完成交易:
       ├── 释放款项给卖家
       ├── 双方评价
       └── 项目归档
```

#### 2.4.4 数据模型

**项目管理数据库表结构**:

```sql
-- 项目表
CREATE TABLE projects (
    id TEXT PRIMARY KEY,  -- proj_<timestamp>_<uuid>
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,  -- 'web', 'document', 'data_analysis', 'presentation', 'video', 'image', 'code', 'mixed'
    category TEXT,  -- 二级分类,例如: 'react_app', 'sales_report', 'product_demo'
    owner_did TEXT NOT NULL,  -- 项目所有者DID
    folder_path TEXT NOT NULL,  -- 项目文件夹路径: projects/proj_xxx/
    template_id TEXT,  -- 如果从模板创建,记录模板ID

    status TEXT DEFAULT 'active',  -- 'active', 'archived', 'deleted'
    visibility TEXT DEFAULT 'private',  -- 'private', 'shared', 'public'

    -- 统计信息
    file_count INTEGER DEFAULT 0,
    task_count INTEGER DEFAULT 0,
    completed_task_count INTEGER DEFAULT 0,
    total_ai_tokens INTEGER DEFAULT 0,  -- 消耗的AI tokens

    -- 时间戳
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,

    -- Git信息
    git_repo_path TEXT,  -- Git仓库路径
    latest_commit_hash TEXT,

    -- 标签与分类
    tags TEXT,  -- JSON数组: ['responsive', 'tailwind', 'dark-mode']

    -- 项目设置 (JSON)
    settings TEXT,  -- {"auto_commit": true, "ai_model": "gpt-4", "language": "zh-CN"}

    FOREIGN KEY (owner_did) REFERENCES identities(did)
);

-- 项目文件表
CREATE TABLE project_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,  -- 相对于项目根目录的路径: sources/index.html
    file_type TEXT NOT NULL,  -- 'html', 'css', 'js', 'py', 'xlsx', 'docx', 'pdf', 'mp4'等
    file_size INTEGER,  -- 字节
    file_hash TEXT,  -- SHA-256哈希值 (内容校验)

    -- 文件来源
    source TEXT NOT NULL,  -- 'ai_generated', 'user_uploaded', 'imported', 'template'
    generator_model TEXT,  -- 如果是AI生成,记录模型: 'gpt-4', 'claude-3'

    -- 文件关系
    parent_file_id TEXT,  -- 如果是从另一文件衍生 (例如PDF从Word导出)
    related_task_id TEXT,  -- 关联的任务ID

    -- 版本信息
    version INTEGER DEFAULT 1,  -- 文件版本号
    git_commit_hash TEXT,  -- 对应的Git提交

    -- 文件元数据 (JSON)
    metadata TEXT,  -- {"width": 1920, "height": 1080, "duration": 120} (视频)
                    -- {"word_count": 3500, "page_count": 12} (文档)

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (related_task_id) REFERENCES project_tasks(id),
    FOREIGN KEY (parent_file_id) REFERENCES project_files(id)
);

-- 项目任务表 (记录AI执行的所有任务)
CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,

    -- 任务描述
    title TEXT NOT NULL,  -- AI自动生成的任务标题
    user_instruction TEXT NOT NULL,  -- 用户原始指令: "帮我制作一个网页"

    -- 任务分类
    task_type TEXT NOT NULL,  -- 'create', 'edit', 'analyze', 'convert', 'query'
    target_file_type TEXT,  -- 目标文件类型: 'html', 'docx', 'pptx'

    -- 任务状态
    status TEXT DEFAULT 'pending',
    -- 'pending', 'planning', 'executing', 'completed', 'failed', 'cancelled'

    -- 任务执行信息
    execution_plan TEXT,  -- JSON: 任务拆解和执行计划
    executed_steps TEXT,  -- JSON数组: 已执行的步骤记录
    error_message TEXT,  -- 如果失败,记录错误信息

    -- AI使用情况
    ai_model TEXT,  -- 使用的主模型: 'gpt-4', 'claude-3-sonnet'
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,

    -- 输出结果
    output_file_ids TEXT,  -- JSON数组: 生成的文件ID列表
    output_summary TEXT,  -- AI生成的结果总结

    -- 用户反馈
    user_rating INTEGER,  -- 1-5星评分
    user_feedback TEXT,  -- 用户评价

    -- 时间信息
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    duration_seconds INTEGER,  -- 执行耗时

    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 项目对话历史表
CREATE TABLE project_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,  -- 关联的任务 (如果是任务相关的对话)

    -- 对话角色
    role TEXT NOT NULL,  -- 'user', 'assistant', 'system', 'tool'

    -- 消息内容
    content TEXT NOT NULL,  -- 消息文本
    content_type TEXT DEFAULT 'text',  -- 'text', 'image', 'file', 'code'
    attachments TEXT,  -- JSON数组: 附件 (图片、文件路径)

    -- AI相关 (如果是assistant消息)
    model TEXT,  -- 使用的模型
    tokens INTEGER,  -- token消耗
    function_calls TEXT,  -- JSON: 工具调用记录

    -- 消息元数据
    is_pinned INTEGER DEFAULT 0,  -- 是否置顶 (重要消息)
    parent_message_id TEXT,  -- 引用的消息ID (回复、编辑)

    created_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (task_id) REFERENCES project_tasks(id),
    FOREIGN KEY (parent_message_id) REFERENCES project_conversations(id)
);

-- 项目协作者表
CREATE TABLE project_collaborators (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    collaborator_did TEXT NOT NULL,

    -- 权限控制
    role TEXT NOT NULL,  -- 'owner', 'editor', 'commenter', 'viewer'
    permissions TEXT,  -- JSON: 详细权限 {"can_edit": true, "can_invite": false, "can_delete": false}

    -- 协作状态
    status TEXT DEFAULT 'active',  -- 'invited', 'active', 'removed'

    -- 邀请信息
    invited_by_did TEXT,  -- 邀请人DID
    invited_at INTEGER,
    accepted_at INTEGER,

    -- 活动统计
    last_active_at INTEGER,
    edit_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (collaborator_did) REFERENCES contacts(did),
    FOREIGN KEY (invited_by_did) REFERENCES contacts(did)
);

-- 项目评论/批注表 (协作功能)
CREATE TABLE project_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_id TEXT,  -- 如果是针对特定文件的评论
    commenter_did TEXT NOT NULL,

    -- 评论内容
    content TEXT NOT NULL,
    comment_type TEXT DEFAULT 'general',  -- 'general', 'suggestion', 'question', 'approval'

    -- 评论位置 (如果是文档批注)
    position_data TEXT,  -- JSON: {"line": 42, "column": 10} 或 {"page": 3, "x": 100, "y": 200}

    -- 评论状态
    status TEXT DEFAULT 'open',  -- 'open', 'resolved', 'dismissed'
    resolved_by_did TEXT,
    resolved_at INTEGER,

    -- 回复关系
    parent_comment_id TEXT,  -- 评论的评论 (嵌套)

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (file_id) REFERENCES project_files(id),
    FOREIGN KEY (commenter_did) REFERENCES contacts(did),
    FOREIGN KEY (resolved_by_did) REFERENCES contacts(did),
    FOREIGN KEY (parent_comment_id) REFERENCES project_comments(id)
);

-- 项目模板表
CREATE TABLE project_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,  -- 'web', 'document', 'data_analysis'等

    -- 模板文件
    template_path TEXT NOT NULL,  -- 模板文件夹路径
    thumbnail_path TEXT,  -- 模板缩略图

    -- 模板变量
    variables TEXT,  -- JSON数组: 需要用户提供的变量 [{"name": "project_name", "type": "text", "required": true}]

    -- 模板来源
    source TEXT DEFAULT 'builtin',  -- 'builtin', 'user_created', 'community'
    creator_did TEXT,  -- 如果是用户创建的模板

    -- 模板受欢迎度
    use_count INTEGER DEFAULT 0,
    rating REAL DEFAULT 0.0,

    -- 标签与分类
    tags TEXT,  -- JSON数组

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (creator_did) REFERENCES contacts(did)
);

-- 项目市场商品表 (与交易模块关联)
CREATE TABLE project_marketplace_listings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    seller_did TEXT NOT NULL,

    -- 商品信息
    title TEXT NOT NULL,  -- 可能与项目名称不同
    description TEXT NOT NULL,  -- AI优化后的商品描述
    category TEXT NOT NULL,

    -- 定价
    price REAL NOT NULL,
    currency TEXT DEFAULT 'CNY',
    license_type TEXT NOT NULL,  -- 'single_use', 'multi_use', 'open_source', 'commercial'

    -- 商品内容
    included_files TEXT,  -- JSON数组: 包含的文件列表
    demo_url TEXT,  -- 演示地址 (如果是Web项目)
    preview_images TEXT,  -- JSON数组: 预览图片路径

    -- 销售状态
    status TEXT DEFAULT 'active',  -- 'draft', 'active', 'sold_out', 'delisted'

    -- 销售统计
    view_count INTEGER DEFAULT 0,
    purchase_count INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0.0,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (seller_did) REFERENCES contacts(did)
);

-- 项目知识关联表 (与知识库模块集成)
CREATE TABLE project_knowledge_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    knowledge_id TEXT NOT NULL,  -- 关联的知识条目ID

    -- 关联类型
    link_type TEXT NOT NULL,  -- 'reference', 'template', 'learned_from', 'example'

    -- 关联上下文
    context TEXT,  -- 描述这个知识是如何使用的: "作为网页布局参考"
    task_id TEXT,  -- 在哪个任务中使用了这个知识

    created_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id),
    FOREIGN KEY (task_id) REFERENCES project_tasks(id)
);

-- 项目自动化规则表 (工作流自动化)
CREATE TABLE project_automation_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,

    name TEXT NOT NULL,
    description TEXT,

    -- 触发条件
    trigger_type TEXT NOT NULL,  -- 'schedule', 'file_change', 'task_complete', 'manual'
    trigger_config TEXT NOT NULL,  -- JSON: {"cron": "0 9 * * *"} 或 {"file_pattern": "data/*.csv"}

    -- 执行动作
    action_type TEXT NOT NULL,  -- 'run_task', 'generate_report', 'send_notification', 'git_commit'
    action_config TEXT NOT NULL,  -- JSON: 动作参数

    -- 状态
    is_enabled INTEGER DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,

    created_at INTEGER NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**.project.json 文件结构** (每个项目文件夹中):
```json
{
  "id": "proj_20250115_a3f4e2d1",
  "name": "智能手表产品介绍网站",
  "type": "web",
  "category": "landing_page",
  "version": "1.2.0",
  "created_at": 1705305600,
  "updated_at": 1705392000,

  "owner": {
    "did": "did:chainlesschain:abc123",
    "name": "张三"
  },

  "description": "为智能手表设计的现代响应式产品介绍页面,突出续航、健康监测和时尚设计三大卖点。",

  "structure": {
    "sources": "源代码文件",
    "outputs": "可交付的输出文件",
    "assets": "图片、视频等资源",
    "data": "数据文件",
    "docs": "文档说明"
  },

  "tech_stack": [
    "HTML5",
    "Tailwind CSS",
    "Vanilla JavaScript"
  ],

  "ai_models_used": [
    {
      "model": "gpt-4",
      "purpose": "代码生成",
      "total_tokens": 15234
    },
    {
      "model": "dall-e-3",
      "purpose": "生成产品图片",
      "images_generated": 3
    }
  ],

  "git": {
    "initialized": true,
    "remote": null,
    "branch": "main",
    "latest_commit": "f4a3e2d"
  },

  "settings": {
    "auto_commit": true,
    "default_ai_model": "gpt-4",
    "language": "zh-CN",
    "code_style": "prettier"
  },

  "collaborators": [],

  "tags": ["responsive", "product-page", "tailwind", "dark-mode"],

  "statistics": {
    "file_count": 5,
    "total_size_bytes": 245760,
    "task_count": 8,
    "completed_tasks": 8,
    "conversation_messages": 23
  }
}
```

#### 2.4.5 技术选型

| 组件 | PC端 | 移动端 | 说明 |
|------|------|--------|------|
| **对话引擎** |
| NLU模型 | GPT-4 / Claude-3 | MiniCPM-2B (本地) | 意图识别和实体抽取 |
| Function Calling | OpenAI Functions | 自定义解析 | 工具调用机制 |
| **文件处理库** |
| Web开发 | - | - | |
| HTML/CSS | Jinja2模板 | 同左 | 模板渲染 |
| JavaScript | - | - | 直接生成 |
| 预览服务器 | Python http.server | 同左 | 本地预览 |
| 文档处理 | - | - | |
| Word | python-docx | python-docx | 创建和编辑 |
| PDF | ReportLab, WeasyPrint | 同左 (精简版) | 生成PDF |
| PDF解析 | pdfplumber | 同左 | 提取文本和表格 |
| Markdown | markdown-it-py | 同左 | 渲染和转换 |
| 数据处理 | - | - | |
| Excel/CSV | pandas + openpyxl | 同左 (精简) | 数据分析和操作 |
| 可视化 | matplotlib + plotly | matplotlib-lite | 图表生成 |
| 统计分析 | scipy + statsmodels | 基础统计 | 科学计算 |
| 演示文稿 | - | - | |
| PPT | python-pptx | 同左 | 创建和编辑 |
| 视频处理 | - | - | |
| 视频编辑 | moviepy | 不支持 (移动端限制) | 剪辑和合成 |
| 格式转换 | FFmpeg | FFmpeg-lite | 格式转换 |
| 字幕 | pysrt | 同左 | 字幕解析 |
| 语音识别 | Whisper (本地) | Whisper-tiny (本地) | 语音转文字 |
| 图像处理 | - | - | |
| 基础处理 | Pillow | Pillow | 裁剪、调整 |
| AI绘图 | Stable Diffusion (本地) | 调用云端API | 文生图 |
| 背景移除 | rembg | 同左 | AI抠图 |
| 代码开发 | - | - | |
| 代码生成 | Codex / StarCoder | 同左 (云端) | 多语言代码生成 |
| 代码分析 | Tree-sitter | 同左 | 语法解析 |
| 代码格式化 | Black, Prettier | 同左 | 代码美化 |
| **存储** |
| 数据库 | SQLCipher | SQLCipher | 加密数据库 |
| 文件系统 | 本地目录 | 本地目录 | 项目文件夹 |
| 版本控制 | libgit2 / GitPython | JGit / libgit2 | Git操作 |
| **AI基础设施** |
| LLM | Ollama (本地) | MLC LLM (本地) | 模型推理 |
| Embedding | bge-large-zh-v1.5 | bge-small-zh-v1.5 | 向量化 |
| RAG | LangChain | LangChain-lite | 检索增强 |
| Agent框架 | AutoGPT / BabyAGI | 简化版 | 自主任务执行 |

#### 2.4.6 AI辅助功能详解

**1. 智能任务拆解**

当用户提出复杂需求时,AI自动拆解为可执行的子任务:

```python
# AI Prompt示例
system_prompt = """你是一个项目管理助手,擅长将用户的需求拆解为清晰的执行步骤。

用户需求: {user_request}
项目类型: {project_type}
现有文件: {existing_files}

请输出JSON格式的任务计划:
{{
  "task_title": "任务标题",
  "subtasks": [
    {{
      "step": 1,
      "description": "子任务描述",
      "tool": "需要使用的工具",
      "estimated_tokens": 1000,
      "dependencies": []
    }}
  ]
}}
"""

# 示例输出
{
  "task_title": "创建销售数据分析报告",
  "subtasks": [
    {
      "step": 1,
      "description": "读取并解析sales.csv文件",
      "tool": "pandas",
      "estimated_tokens": 500,
      "dependencies": []
    },
    {
      "step": 2,
      "description": "执行统计分析和趋势计算",
      "tool": "python_code_executor",
      "estimated_tokens": 2000,
      "dependencies": [1]
    },
    {
      "step": 3,
      "description": "生成可视化图表",
      "tool": "matplotlib",
      "estimated_tokens": 1500,
      "dependencies": [2]
    },
    {
      "step": 4,
      "description": "创建Excel报表并插入图表",
      "tool": "openpyxl",
      "estimated_tokens": 2500,
      "dependencies": [2, 3]
    },
    {
      "step": 5,
      "description": "生成PPT演示文稿",
      "tool": "python-pptx",
      "estimated_tokens": 3000,
      "dependencies": [2, 3]
    }
  ]
}
```

**2. RAG增强的项目AI**

项目AI可以检索知识库中的相关内容来增强回答:

```python
def project_ai_chat(user_query, project_context):
    # 1. 检索项目相关知识
    project_knowledge = vector_search(
        query=user_query,
        filters={
            "tags": project_context["tags"],
            "type": project_context["type"]
        },
        top_k=5
    )

    # 2. 检索项目历史成功案例
    similar_projects = search_projects(
        criteria={
            "type": project_context["type"],
            "status": "completed",
            "rating": ">= 4"
        },
        limit=3
    )

    # 3. 组装提示词
    prompt = f"""
    项目背景:
    - 名称: {project_context['name']}
    - 类型: {project_context['type']}
    - 已有文件: {project_context['files']}
    - 当前任务: {project_context['current_task']}

    相关知识库内容:
    {format_knowledge(project_knowledge)}

    参考案例:
    {format_projects(similar_projects)}

    用户需求: {user_query}

    请根据项目背景、知识库和成功案例,给出专业的建议和实施方案。
    """

    # 4. 调用LLM
    response = llm.complete(prompt)
    return response
```

**3. 代码生成与质量保证**

AI生成代码后,自动进行质量检查:

```python
def generate_and_validate_code(task_description, file_type, project_context):
    # 1. 生成代码
    code = ai_generate_code(
        task=task_description,
        language=file_type,
        style_guide=project_context["code_style"],
        examples=retrieve_code_examples(file_type)
    )

    # 2. 语法检查
    syntax_valid, syntax_errors = check_syntax(code, file_type)
    if not syntax_valid:
        # 重新生成或修复
        code = ai_fix_code(code, syntax_errors)

    # 3. 代码质量检查
    quality_issues = lint_code(code, file_type)  # pylint, eslint等
    if quality_issues:
        code = ai_improve_code(code, quality_issues)

    # 4. 安全检查
    security_issues = security_scan(code)
    if security_issues:
        code = ai_fix_security(code, security_issues)

    # 5. 生成注释和文档
    code_with_docs = ai_add_documentation(code)

    return code_with_docs
```

**4. 智能文件转换**

AI理解用户意图,自动选择合适的转换方式:

```python
# 用户: "把这个Excel表格转成漂亮的PDF报表"
def智能转换(source_file, target_format, user_preferences):
    # 1. 分析源文件
    file_analysis = analyze_file(source_file)
    # Excel文件,包含3个sheet,有数据和图表

    # 2. AI决策转换策略
    strategy = ai_decide_conversion_strategy(
        source=file_analysis,
        target=target_format,
        preferences=user_preferences  # "漂亮" → 专业模板、配色
    )
    # 策略: 使用商务模板,每个sheet一页,保留图表,添加页眉页脚

    # 3. 执行转换
    pdf = create_pdf_from_excel(
        source_file,
        template=strategy["template"],
        layout=strategy["layout"],
        styling=strategy["styling"]
    )

    # 4. AI优化输出
    optimized_pdf = ai_optimize_pdf(pdf)
    # 调整图表大小、对齐、配色

    return optimized_pdf
```

**5. 项目总结与知识沉淀**

项目完成后,AI自动生成总结并沉淀为知识:

```python
def project_completion_summary(project_id):
    # 1. 收集项目数据
    project = get_project(project_id)
    tasks = get_project_tasks(project_id)
    conversations = get_project_conversations(project_id)
    files = get_project_files(project_id)

    # 2. AI生成项目总结
    summary = ai_generate_summary(f"""
    分析以下项目数据,生成结构化总结:

    项目信息: {project}
    任务列表: {tasks}
    对话记录: {conversations}
    生成文件: {files}

    请输出:
    1. 项目概述 (1段)
    2. 关键成果 (3-5点)
    3. 技术亮点 (使用的技术和工具)
    4. 经验教训 (做得好的和可改进的)
    5. 可复用资源 (模板、代码片段)
    """)

    # 3. 提取可复用知识
    reusable_knowledge = []

    # 3.1 优秀代码片段
    for file in files:
        if file.user_rating >= 4:  # 用户评分高
            snippet = {
                "type": "code_snippet",
                "title": f"{file.file_type}代码示例: {file.description}",
                "content": file.content,
                "tags": file.tags
            }
            reusable_knowledge.append(snippet)

    # 3.2 成功的对话模式
    successful_tasks = [t for t in tasks if t.status == 'completed' and t.user_rating >= 4]
    for task in successful_tasks:
        pattern = {
            "type": "conversation_pattern",
            "title": f"如何{task.title}",
            "user_query": task.user_instruction,
            "ai_approach": task.execution_plan,
            "result": task.output_summary
        }
        reusable_knowledge.append(pattern)

    # 3.3 项目模板
    if project.rating >= 4:  # 整体评分高
        template = {
            "type": "project_template",
            "title": f"{project.type}项目模板: {project.name}",
            "structure": project.folder_structure,
            "files": extract_template_files(project),
            "description": summary["project_overview"]
        }
        reusable_knowledge.append(template)

    # 4. 保存到知识库
    for knowledge in reusable_knowledge:
        save_to_knowledge_base(knowledge)

    # 5. 生成README.md
    readme = ai_generate_readme(summary, project)
    save_file(f"{project.folder_path}/README.md", readme)

    return summary
```

#### 2.4.7 与其他模块的关联设计

**与知识库模块 (2.1) 的深度集成**:

```
项目 ←→ 知识库 双向流动

向右流动 (项目使用知识):
1. RAG检索: 项目AI对话时自动检索知识库
2. 模板引用: 从知识库加载项目模板
3. 示例学习: Few-shot示例来自知识库成功案例
4. 代码复用: 引用知识库中的代码片段

向左流动 (项目沉淀知识):
1. 对话保存: 有价值的对话自动保存为知识条目
2. 文件导入: 项目文件导入知识库 (带元数据)
3. 经验总结: 项目完成后生成总结文档→知识库
4. 模板贡献: 优秀项目转为模板供未来复用

技术实现:
- 共享向量数据库: 知识和项目对话都向量化
- 统一检索接口: search(query, sources=['knowledge', 'projects'])
- 交叉引用: project_knowledge_links表关联
- 自动标签: 项目和知识共享标签体系
```

**与社交模块 (2.2) 的集成**:

```
项目协作与分享

1. 项目分享到社交网络:
   - 发布项目动态 (附带预览图、Demo链接)
   - 展示项目成果 (自动生成精美展示页)
   - 开源项目发布 (Git仓库链接)
   - 寻求反馈 (邀请好友评论)

2. 多人协作:
   - DID身份验证: 协作者通过DID加入
   - P2P文件同步: 实时同步项目文件
   - 端到端加密: 私密项目内容加密
   - 冲突解决: AI辅助合并冲突

3. 社区驱动:
   - 项目模板市场: 分享和下载模板
   - 最佳实践: 社区投票选出优秀项目
   - 协作网络: 基于项目建立协作关系

技术实现:
- WebRTC: 实时协同编辑
- OT算法: 操作转换处理并发编辑
- Git分支: 每个协作者独立分支
- 消息推送: 项目更新通知
```

**与交易模块 (2.3) 的集成**:

```
项目商品化与服务交易

1. 项目作为数字商品:
   - 自动定价: AI根据复杂度、质量评估价格
   - 商品描述: AI生成吸引人的商品页面
   - 演示生成: 自动生成Demo视频/截图
   - 许可证管理: 支持多种许可类型

2. 项目定制服务:
   - 需求匹配: 买家需求 ↔ 卖家能力
   - AI辅助报价: 分析需求复杂度给出报价建议
   - 里程碑交付: 项目按阶段交付和付款
   - 自动验收: AI检查交付物是否符合要求

3. 智能合约托管:
   - 款项锁定: 买家付款到智能合约
   - 条件释放: 验收通过后自动支付卖家
   - 争议仲裁: AI辅助判断交付质量
   - 退款机制: 未完成项目自动退款

技术实现:
- 项目打包: 自动排除敏感文件、压缩
- 水印嵌入: 防止盗版 (代码注释、图片水印)
- 使用统计: 追踪买家使用情况 (可选)
- 信誉系统: 项目评分影响卖家信誉
```

**统一架构视图**:

```
                    ┌─────────────────────────────────┐
                    │      项目管理模块 (核心)         │
                    └─────────────────────────────────┘
                               ▲ │ ▼
          ┌────────────────────┼─┼─┼────────────────────┐
          │                    │ │ │                    │
    ┌─────▼─────┐       ┌─────▼─▼─▼─────┐       ┌─────▼─────┐
    │知识库模块  │       │   AI引擎层     │       │ 社交模块  │
    │           │◄─────►│   - LLM        │◄─────►│           │
    │- 知识检索  │       │   - Embedding  │       │- 协作     │
    │- 模板存储  │       │   - RAG        │       │- 分享     │
    │- 经验沉淀  │       │   - Agent      │       │- 评论     │
    └───────────┘       └────────────────┘       └───────────┘
          │                    ▲ │ ▼                    │
          └────────────────────┼─┼─┼────────────────────┘
                               │ │ │
                        ┌──────▼─▼─▼──────┐
                        │   交易模块       │
                        │                  │
                        │- 项目商品化      │
                        │- 定制服务        │
                        │- 智能合约托管    │
                        └──────────────────┘
```

---

## 三、安全机制设计

### 3.1 U盾安全机制

#### 3.1.1 U盾架构
```
U盾 (USB Key)
├── 硬件层
│   ├── 安全芯片 (SE - Secure Element)
│   ├── USB接口控制器
│   ├── 闪存存储 (存储公钥、证书、配置)
│   └── 随机数生成器 (TRNG)
│
├── 固件层
│   ├── PIN验证模块 (防暴力破解)
│   ├── 密钥生成模块
│   ├── 加密/解密引擎 (RSA-2048/4096, AES-256)
│   ├── 签名验证模块 (RSA/ECDSA)
│   └── 生命周期管理 (初始化、锁定、解锁、重置)
│
└── API层
    ├── PKCS#11接口 (通用加密API)
    ├── 自定义SDK (针对本系统)
    └── 驱动程序 (Windows/Linux/Mac)
```

#### 3.1.2 密钥管理

**密钥层次结构**:
```
主密钥 (Master Key) - 永不导出,仅存U盾内
├── 设备签名密钥 (Device Sign Key)
│   └── 用途: 签名DID文档、交易、消息
│
├── 设备加密密钥 (Device Encrypt Key)
│   └── 用途: 接收加密消息、文件
│
├── 数据库加密密钥 (DB Encryption Key)
│   └── 用途: 加密SQLCipher数据库
│
└── 备份加密密钥 (Backup Encryption Key)
    └── 用途: 加密Git仓库、云备份
```

**密钥生成流程**:
```
1. 用户插入U盾
2. 输入PIN码解锁
3. 调用U盾API生成密钥对
   - RSA-4096 (兼容性好,适合签名)
   - 或 Ed25519 (高效,256位安全性)
4. 私钥写入安全芯片 (标记为不可导出)
5. 公钥导出并存储到应用数据库
6. 生成对应的DID标识符
```

**安全操作**:
```c
// U盾签名操作示例
int ukey_sign_data(const char* data, size_t data_len,
                   unsigned char* signature, size_t* sig_len) {
    // 1. 验证U盾连接
    if (!ukey_is_connected()) return ERROR_UKEY_NOT_FOUND;

    // 2. 验证PIN (带重试次数限制)
    if (!ukey_verify_pin(pin, &retries_left)) {
        if (retries_left == 0) {
            ukey_lock();  // PIN错误次数过多,锁定U盾
        }
        return ERROR_INVALID_PIN;
    }

    // 3. 计算数据哈希
    unsigned char hash[32];
    sha256(data, data_len, hash);

    // 4. 调用安全芯片签名 (私钥永不离开芯片)
    int ret = se_sign(DEVICE_SIGN_KEY_ID, hash, 32, signature, sig_len);

    return ret;
}
```

#### 3.1.3 备份与恢复

**备份方案**:
```
方案一: 助记词备份 (BIP39)
1. 生成256位熵
2. 转换为24个助记词
3. 用户抄写并安全保存 (纸质、金属板)
4. 可选加密助记词 (需要额外密码)
5. 从助记词可恢复所有密钥

方案二: 备份U盾
1. 制作2-3个备份U盾
2. 将私钥安全导出并写入备份U盾
   (需要管理员级别权限和二次验证)
3. 备份U盾存放在不同物理位置

方案三: 社交恢复 (Shamir秘密共享)
1. 将主密钥分割为N份 (如5份)
2. 任意M份可恢复 (如3份)
3. 分发给可信朋友/家人
4. 丢失U盾时向他们请求恢复
```

**U盾丢失恢复流程**:
```
1. 用户使用助记词或备份U盾
2. 生成新的U盾并导入密钥
3. 登录系统后发布DID更新事件
   - 声明旧U盾已作废
   - 发布新的设备公钥
   - 使用旧私钥签名证明身份连续性
4. 通知所有联系人更新公钥
5. 旧U盾私钥加入黑名单
```

### 3.2 SIMKey安全机制

#### 3.2.1 SIMKey架构
```
SIMKey (SIM卡安全芯片)
├── 硬件层
│   ├── SIM卡芯片 (Java Card或类似)
│   ├── 安全存储区域 (几十KB)
│   └── 加密协处理器
│
├── Applet层 (在SIM卡上运行的小程序)
│   ├── PIN管理
│   ├── 密钥生成 (RSA/ECC)
│   ├── 签名/验证
│   ├── 加密/解密
│   └── 安全存储API
│
└── 移动端接口
    ├── Android: OMAPI (Open Mobile API)
    ├── iOS: 需要运营商支持的特殊API
    └── APDU命令 (Application Protocol Data Unit)
```

#### 3.2.2 SIMKey优势
- **始终在线**: 手机随身携带,SIM卡始终在手机中
- **运营商背书**: 实名制SIM卡提供额外身份保证
- **难以复制**: SIM卡丢失后可挂失,防止冒用
- **普及性高**: 无需额外硬件,人人都有SIM卡

#### 3.2.3 SIMKey操作示例

**Android OMAPI通信**:
```java
// 打开SIM卡安全通道
SEService seService = new SEService(context, new SEService.OnConnectedListener() {
    @Override
    public void onConnected() {
        Reader[] readers = seService.getReaders();
        for (Reader reader : readers) {
            if (reader.getName().contains("SIM")) {
                Session session = reader.openSession();
                // 选择我们的Applet
                Channel channel = session.openLogicalChannel(APPLET_AID);

                // 发送签名命令 (APDU)
                byte[] signCommand = buildSignAPDU(dataToSign);
                byte[] response = channel.transmit(signCommand);

                // 解析签名结果
                byte[] signature = parseSignatureResponse(response);
            }
        }
    }
});
```

**SIMKey生命周期**:
```
1. 用户首次使用:
   - 检测SIM卡是否支持安全Applet
   - 安装Chainlesschain Applet (需要运营商支持或开放式SIM卡)
   - 或使用已有的USIM安全功能

2. 初始化:
   - 设置Applet PIN (独立于SIM卡PIN)
   - 生成密钥对
   - 导出公钥存储到应用

3. 日常使用:
   - 输入PIN解锁 (或使用生物识别委托)
   - 调用签名/加密API
   - 会话超时后自动锁定

4. SIM卡更换:
   - 从备份恢复私钥到新SIM卡
   - 或生成新密钥并发布DID更新
```

### 3.3 统一认证流程

**PC端登录**:
```
1. 用户打开应用
2. 插入U盾
3. 输入PIN码 (或生物识别)
4. U盾解密本地配置文件
5. 读取DID和数据库密钥
6. 解密SQLCipher数据库
7. 加载知识库和联系人
8. 进入主界面
```

**移动端登录**:
```
1. 用户打开APP
2. 选择使用SIMKey认证
3. 输入PIN (或指纹/面容ID)
4. SIMKey解密本地配置
5. 读取DID和数据库密钥
6. 解密SQLCipher数据库
7. 后台同步Git仓库
8. 进入主界面
```

**跨设备认证** (PC与手机联动):
```
1. 用户在新PC上安装应用
2. PC显示二维码
3. 用户用手机扫码
4. 手机SIMKey签名授权消息
5. PC验证签名
6. 建立加密通道
7. 手机通过加密通道传输临时会话密钥
8. PC使用会话密钥访问云端Git仓库
9. 下载数据到PC本地
10. 用户决定是否信任此PC (写入新设备到设备列表)
```

### 3.4 加密方案

**数据加密层次**:
```
1. 存储加密 (Data at Rest)
   ├── SQLCipher数据库: AES-256-CBC
   │   └── 密钥来源: U盾/SIMKey导出的DB密钥
   │
   ├── 敏感文件: AES-256-GCM
   │   ├── 知识库文件
   │   ├── 私密照片/文档
   │   └── 聊天记录备份
   │
   └── Git仓库加密
       ├── git-crypt (透明加密)
       └── 或 git-remote-gcrypt (远程仓库加密)

2. 传输加密 (Data in Transit)
   ├── P2P通信: TLS 1.3 + Signal协议
   ├── Git同步: HTTPS + 仓库级加密
   └── API调用: TLS 1.3

3. 端到端加密 (End-to-End Encryption)
   ├── 私密消息: Signal协议
   ├── 群组消息: MLS (Messaging Layer Security)
   └── 文件传输: 接收方公钥加密
```

**加密密钥派生** (KDF):
```
Master Key (U盾/SIMKey中,256位)
    ↓ HKDF-SHA256
├── DB_Encryption_Key (数据库加密)
├── File_Encryption_Key (文件加密)
├── Backup_Encryption_Key (备份加密)
└── Transport_Key_Seed (传输密钥种子)
```

---

## 四、数据同步方案

### 4.1 Git-based同步架构

**为什么选择Git**:
- ✅ 去中心化: 无需中央服务器
- ✅ 版本控制: 完整历史记录,可回滚
- ✅ 冲突解决: 成熟的merge算法
- ✅ 增量同步: 只传输变化部分
- ✅ 加密友好: 支持透明加密
- ✅ 生态成熟: 众多托管选择 (GitHub、GitLab、自托管)

### 4.2 仓库结构

```
my-knowledge-base/ (Git仓库根目录)
├── .git/                  # Git元数据
├── .gitattributes         # Git LFS配置
├── .git-crypt/            # 加密配置 (如使用git-crypt)
│
├── knowledge/             # 知识文件目录
│   ├── notes/             # 笔记
│   │   ├── 2024-01-01-学习Go语言.md
│   │   └── 2024-01-02-分布式系统设计.md
│   ├── documents/         # 文档
│   │   └── 技术方案.pdf
│   ├── images/            # 图片
│   └── embeddings/        # 向量文件 (可选不加密)
│
├── social/                # 社交数据
│   ├── posts/             # 我的动态
│   ├── contacts/          # 联系人导出 (加密)
│   └── conversations/     # 聊天记录 (加密)
│
├── transactions/          # 交易数据
│   ├── listings/          # 交易列表
│   ├── contracts/         # 合约
│   └── evidence/          # 证据文件
│
├── databases/             # 数据库备份
│   ├── knowledge.db.enc   # 加密的SQLCipher数据库
│   ├── social.db.enc
│   └── transactions.db.enc
│
├── configs/               # 配置文件 (加密)
│   ├── llm_configs.json.enc
│   ├── sync_settings.json.enc
│   └── device_list.json.enc
│
└── .chainlesschain/       # 系统元数据
    ├── version            # 数据格式版本
    ├── device_id          # 设备唯一ID
    └── last_sync          # 最后同步时间戳
```

### 4.3 同步流程

**首次克隆** (新设备):
```
1. 用户在新设备登录
2. 输入Git仓库地址 (HTTPS或SSH)
3. 输入仓库访问凭证 (用户名+密码/Token)
4. Git clone到本地
5. U盾/SIMKey解密数据库密钥
6. 解密数据库文件
7. 导入数据库到SQLCipher
8. 构建向量索引
9. 标记设备为已同步
```

**增量同步** (双向):
```
移动端 → 云端:
1. 用户在手机上添加新笔记
2. 写入本地SQLCipher数据库
3. 保存文件到knowledge/目录
4. Git add + commit
5. 后台任务检测到变更
6. 通过移动网络git push到远程仓库
7. 推送成功后更新同步状态

云端 → PC端:
1. PC端定期 (每5分钟) 执行git fetch
2. 检测到远程有新commit
3. 执行git pull
4. 解密新文件
5. 更新SQLCipher数据库
6. 重建向量索引
7. 通知用户有新内容
```

**冲突解决**:
```
场景: 用户在手机和PC上同时编辑同一笔记

1. 手机和PC都commit到本地
2. 手机先push成功
3. PC尝试push,被拒绝 (non-fast-forward)
4. PC执行git pull --rebase
5. Git尝试自动合并:
   - 成功: 自动完成
   - 冲突: 生成冲突标记文件
6. 应用检测到冲突
7. 展示冲突内容给用户:
   <<<<<<< HEAD (PC版本)
   这是PC上的修改
   =======
   这是手机上的修改
   >>>>>>> remote (手机版本)
8. 用户手动选择保留哪个版本或合并
9. 解决后提交并push
```

### 4.4 托管选项

| 选项 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **GitHub私有仓库** | 免费,稳定,大空间 | 数据在GitHub服务器 | 数据已加密,信任GitHub |
| **GitLab自托管** | 完全控制,无限空间 | 需要自己维护服务器 | 技术能力强,隐私要求高 |
| **Gitea (轻量)** | 资源占用少,易部署 | 功能相对简单 | 家庭服务器,NAS |
| **Git + 加密云盘** | 利用现有云存储 | 需要手动同步 | 已有大容量云盘 |
| **P2P Git** | 无中心服务器 | 设备需同时在线 | 极致去中心化需求 |

**推荐方案**: GitHub私有仓库 + Git-crypt加密
- 所有敏感数据用git-crypt透明加密
- 只有拥有密钥的设备能解密
- GitHub只看到加密后的乱码
- 免费用户可建无限私有仓库

---

## 五、AI模型部署方案

### 5.1 模型选型

#### 5.1.1 LLM (大语言模型)

| 设备类型 | 推荐模型 | 参数量 | 内存需求 | 性能 |
|---------|---------|-------|---------|------|
| **高性能PC** | LLaMA3-70B | 70B | 64GB RAM + 显卡 | 接近GPT-3.5 |
| **普通PC** | Qwen2-7B | 7B | 16GB RAM | 日常使用足够 |
| **低配PC** | Phi-3-mini | 3.8B | 8GB RAM | 轻量但实用 |
| **旗舰手机** | MiniCPM-2B | 2.4B | 6GB RAM | 移动端最优 |
| **中端手机** | Gemma-2B | 2B | 4GB RAM | 速度快 |
| **云端API** | GPT-4/Claude | - | 无需本地资源 | 最强性能 |

#### 5.1.2 Embedding模型 (向量化)

| 模型 | 维度 | 大小 | 语言支持 | 用途 |
|------|------|------|---------|------|
| bge-large-zh-v1.5 | 1024 | 1.3GB | 中英文 | PC端,高精度 |
| bge-base-zh-v1.5 | 768 | 400MB | 中英文 | 平衡性能和精度 |
| bge-small-zh-v1.5 | 512 | 95MB | 中英文 | 移动端,轻量 |
| text-embedding-ada-002 | 1536 | API | 多语言 | 云端,最强效果 |

#### 5.1.3 向量数据库

| 数据库 | 类型 | 优点 | 缺点 | 适用设备 |
|--------|------|------|------|---------|
| **ChromaDB** | 嵌入式 | 简单,自带持久化 | 性能一般 | PC和移动端 |
| **Qdrant** | 独立服务 | 高性能,功能丰富 | 需要单独部署 | PC (Docker) |
| **Milvus** | 分布式 | 企业级,可扩展 | 复杂,资源占用大 | 服务器 |
| **FAISS** | 库 | 超高性能 | 无持久化,需自己封装 | 高级用户 |

### 5.2 PC端部署方案

#### 5.2.1 Docker Compose配置

```yaml
version: '3.8'

services:
  # Ollama - LLM推理引擎
  ollama:
    image: ollama/ollama:latest
    container_name: chainlesschain-llm
    ports:
      - "11434:11434"
    volumes:
      - ./ollama_data:/root/.ollama
    environment:
      - OLLAMA_HOST=0.0.0.0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]  # 如果有NVIDIA显卡

  # Qdrant - 向量数据库
  qdrant:
    image: qdrant/qdrant:latest
    container_name: chainlesschain-vectordb
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./qdrant_data:/qdrant/storage

  # AnythingLLM - RAG问答系统
  anythingllm:
    image: mintplexlabs/anythingllm:latest
    container_name: chainlesschain-rag
    ports:
      - "3001:3001"
    volumes:
      - ./anythingllm_data:/app/server/storage
    environment:
      - LLM_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://ollama:11434
      - VECTOR_DB=qdrant
      - QDRANT_ENDPOINT=http://qdrant:6333
      - EMBEDDING_ENGINE=native  # 使用内置Embedding

  # Git服务器 (可选,自托管)
  gitea:
    image: gitea/gitea:latest
    container_name: chainlesschain-git
    ports:
      - "3000:3000"
      - "2222:22"
    volumes:
      - ./gitea_data:/data
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - GITEA__database__DB_TYPE=sqlite3
```

**一键启动脚本**:
```bash
#!/bin/bash
# setup_pc.sh

echo "正在启动Chainlesschain AI系统..."

# 1. 启动Docker容器
docker-compose up -d

# 2. 等待服务就绪
echo "等待服务启动..."
sleep 10

# 3. 下载LLM模型
echo "下载语言模型 (首次运行需要几分钟)..."
docker exec chainlesschain-llm ollama pull qwen2:7b

# 4. 下载Embedding模型
docker exec chainlesschain-llm ollama pull nomic-embed-text

# 5. 创建向量数据库集合
curl -X PUT 'http://localhost:6333/collections/knowledge_base' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

echo "✅ 系统启动完成!"
echo "LLM API: http://localhost:11434"
echo "向量数据库: http://localhost:6333"
echo "RAG问答: http://localhost:3001"
```

### 5.3 移动端部署方案

#### 5.3.1 Android集成

```kotlin
// 使用MLC LLM在Android上运行本地模型
class LocalLLM(context: Context) {
    private val mlcEngine = MLCEngine(context)

    fun initialize() {
        // 下载并加载MiniCPM-2B模型
        val modelPath = downloadModel("MiniCPM-2B-Q4")  // 量化到4bit
        mlcEngine.loadModel(modelPath)
    }

    suspend fun chat(prompt: String, history: List<Message>): String {
        return mlcEngine.generate(prompt, maxTokens = 512)
    }
}

// Embedding模型
class LocalEmbedding(context: Context) {
    private val tfLite = Interpreter(loadModelFile("bge-small-zh-v1.5.tflite"))

    fun embed(text: String): FloatArray {
        // 分词
        val tokens = tokenizer.encode(text)
        // 推理
        val embedding = FloatArray(512)
        tfLite.run(tokens, embedding)
        return embedding
    }
}
```

#### 5.3.2 iOS集成

```swift
// 使用Core ML运行本地模型
class LocalLLM {
    private var model: MLModel?

    func initialize() {
        // 加载编译好的.mlpackage模型
        let modelURL = Bundle.main.url(forResource: "MiniCPM-2B", withExtension: "mlpackage")!
        model = try? MLModel(contentsOf: modelURL)
    }

    func generate(prompt: String) async -> String {
        // 使用Core ML推理
        let input = MLDictionary(["input_text": prompt])
        let output = try? model?.prediction(from: input)
        return output?["generated_text"] as? String ?? ""
    }
}
```

### 5.4 混合部署策略

**智能路由**:
```python
class AIRouter:
    def __init__(self):
        self.pc_llm_available = check_pc_api("http://192.168.1.100:11434")
        self.mobile_llm_available = check_mobile_model()
        self.cloud_api_key = get_api_key("openai")

    def route_request(self, prompt: str, context_length: int,
                      quality_required: str) -> str:
        """
        智能选择使用哪个模型
        """
        # 1. 长上下文 -> 云端API
        if context_length > 8000:
            return self.call_cloud_api(prompt)

        # 2. 高质量要求 + 在家 -> PC端模型
        if quality_required == "high" and self.pc_llm_available:
            return self.call_pc_llm(prompt)

        # 3. 快速响应 + 移动场景 -> 本地模型
        if quality_required == "fast" and self.mobile_llm_available:
            return self.call_mobile_llm(prompt)

        # 4. 默认 -> 云端API (如果有密钥)
        if self.cloud_api_key:
            return self.call_cloud_api(prompt)

        # 5. 降级到任何可用的模型
        if self.mobile_llm_available:
            return self.call_mobile_llm(prompt)

        return "抱歉,当前没有可用的AI模型"
```

---

## 六、系统实现技术栈

### 6.1 PC端 (跨平台桌面应用)

**核心框架**: Electron + React / Tauri + Vue

```
技术栈:
├── 前端框架: React 18 + TypeScript
├── UI库: Ant Design / shadcn/ui
├── 状态管理: Zustand / Redux Toolkit
├── Markdown编辑器: Milkdown / Tiptap
├── Git操作: isomorphic-git / nodegit
├── 数据库: better-sqlite3 + SQLCipher
├── 加密: node-forge / webcrypto
├── U盾SDK: 原生Node.js addon (C++/Rust)
└── 打包: Electron Builder / Tauri CLI
```

**目录结构**:
```
desktop-app/
├── src/
│   ├── main/              # 主进程 (Node.js)
│   │   ├── ukey.ts        # U盾操作
│   │   ├── database.ts    # 数据库管理
│   │   ├── git.ts         # Git同步
│   │   └── llm.ts         # LLM API封装
│   ├── renderer/          # 渲染进程 (React)
│   │   ├── pages/
│   │   │   ├── Knowledge.tsx  # 知识库页面
│   │   │   ├── Social.tsx     # 社交页面
│   │   │   └── Transaction.tsx # 交易页面
│   │   ├── components/
│   │   └── hooks/
│   └── shared/            # 共享代码
├── resources/             # 资源文件
└── package.json
```

### 6.2 移动端

**Android**: Kotlin + Jetpack Compose
```
技术栈:
├── UI: Jetpack Compose
├── 架构: MVVM + Clean Architecture
├── 数据库: Room + SQLCipher for Android
├── 网络: Ktor Client
├── Git: JGit
├── 加密: BouncyCastle + Android Keystore
├── SIMKey: OMAPI (org.simalliance.openmobileapi)
├── LLM: MLC LLM / llama.cpp Android
└── P2P: libp2p Android binding
```

**iOS**: Swift + SwiftUI
```
技术栈:
├── UI: SwiftUI
├── 架构: MVVM + Combine
├── 数据库: Core Data + SQLCipher
├── 网络: Alamofire
├── Git: ObjectiveGit (libgit2)
├── 加密: CryptoKit
├── SIMKey: Core Telephony (需要运营商支持)
├── LLM: Core ML / llama.cpp iOS
└── P2P: 自定义WebRTC实现
```

### 6.3 后端服务 (可选)

**中继服务器** (用于NAT穿透和离线消息):
```
技术栈:
├── 语言: Rust / Go
├── 框架: Actix-web / Gin
├── 数据库: PostgreSQL (中继消息临时存储)
├── 缓存: Redis
├── 消息队列: RabbitMQ
└── 部署: Docker + Kubernetes
```

**引导节点** (DHT网络):
```
技术栈:
├── 语言: Go
├── P2P库: libp2p
├── 功能:
│   ├── DHT引导
│   ├── 节点发现
│   └── NAT穿透协助 (STUN)
└── 部署: 全球多地区VPS
```

---

## 七、开发路线图

### Phase 1: MVP (最小可行产品) - 3个月

**目标**: 实现核心知识库功能

**里程碑**:
- [ ] Week 1-2: 项目搭建
  - 初始化Electron项目
  - 集成U盾SDK (支持常见品牌)
  - SQLCipher数据库封装

- [ ] Week 3-4: 知识库基础功能
  - Markdown笔记编辑器
  - 本地存储和Git初始化
  - 简单的列表/搜索界面

- [ ] Week 5-6: AI集成
  - Ollama集成 (Docker部署)
  - RAG基础实现 (向量检索)
  - 问答界面

- [ ] Week 7-8: 同步功能
  - Git push/pull实现
  - 冲突检测和提示
  - GitHub私有仓库配置向导

- [ ] Week 9-10: 移动端原型
  - Android基础框架
  - SIMKey集成
  - 与PC端数据同步测试

- [ ] Week 11-12: 测试和优化
  - 内部测试
  - Bug修复
  - 文档编写

### Phase 2: 社交功能 - 2个月

**目标**: 添加去中心化社交网络

**里程碑**:
- [ ] Week 1-2: DID系统
  - DID生成和管理
  - DID文档发布到DHT

- [ ] Week 3-4: P2P通信
  - libp2p集成
  - 节点发现和连接
  - Signal协议端到端加密

- [ ] Week 5-6: 社交功能
  - 添加好友
  - 发布动态
  - 时间线展示

- [ ] Week 7-8: 优化和测试
  - 性能优化 (离线消息、缓存)
  - 跨设备测试
  - Beta版发布

### Phase 3: 交易功能 - 2个月

**目标**: 去中心化交易辅助

**里程碑**:
- [ ] Week 1-2: 交易发布
  - 需求/供给发布界面
  - AI描述优化
  - 向量匹配推荐

- [ ] Week 3-4: 智能合约
  - 以太坊集成 (Ethers.js)
  - 托管合约部署
  - 合约模板库

- [ ] Week 5-6: 信誉系统
  - 评价机制
  - 信誉分计算
  - 区块链存证

- [ ] Week 7-8: 争议解决
  - 仲裁员注册
  - 仲裁流程实现
  - 测试和发布

### Phase 4: 生态完善 - 持续

**长期目标**:
- [ ] 浏览器扩展 (网页剪藏)
- [ ] 插件系统 (第三方扩展)
- [ ] 多语言支持
- [ ] 更多LLM支持 (Gemini、Claude等)
- [ ] 企业版 (团队协作)
- [ ] Web端 (渐进式Web应用)

---

## 八、关键挑战与解决方案

### 8.1 U盾/SIMKey兼容性

**挑战**: 市场上U盾和SIM卡品牌众多,API不统一

**解决方案**:
```
1. 抽象层设计:
   定义统一接口 (ISecureKey)
   ├── sign(data) -> signature
   ├── encrypt(data) -> ciphertext
   ├── decrypt(ciphertext) -> data
   └── getPublicKey() -> pubkey

2. 适配器模式:
   ├── 飞天诚信U盾适配器
   ├── 握奇U盾适配器
   ├── USIM卡适配器 (运营商SIM卡)
   └── 软件模拟适配器 (测试用,不推荐生产)

3. 自动检测:
   启动时扫描已插入的设备
   根据设备ID加载对应适配器

4. 降级方案:
   如果没有硬件设备,允许使用:
   - 密码 + 系统密钥链 (macOS Keychain / Windows DPAPI)
   - 生物识别 (指纹/面容) + TPM
```

### 8.2 移动端性能优化

**挑战**: 手机资源有限,LLM推理慢,耗电高

**解决方案**:
```
1. 模型量化:
   - 使用4-bit量化模型 (Q4_K_M)
   - 降低精度但保持质量

2. 混合推理:
   - 简单问题用本地模型
   - 复杂问题调用云端API

3. 预计算缓存:
   - 常见问题预先生成答案
   - Embedding向量离线计算

4. 异步处理:
   - 后台同步Git仓库
   - 夜间充电时更新向量索引

5. 省电模式:
   - 用户可选择关闭本地LLM
   - 仅使用轻量级搜索功能
```

### 8.3 数据隐私与合规

**挑战**: 确保用户数据绝对私密,同时满足法律要求

**解决方案**:
```
1. 隐私设计原则:
   ✅ 数据最小化: 只收集必要信息
   ✅ 本地优先: 尽量不传输到云端
   ✅ 加密一切: 传输和存储都加密
   ✅ 用户控制: 数据导出、删除权利

2. 合规措施:
   - GDPR合规 (欧盟用户)
   - CCPA合规 (加州用户)
   - 个人信息保护法 (中国)

3. 可选实名认证:
   - 交易模块可要求实名
   - 但知识库和社交可匿名

4. 审计日志:
   - 记录数据访问日志 (本地)
   - 用户可查看谁访问了自己的数据
```

### 8.4 P2P网络稳定性

**挑战**: NAT穿透困难,节点频繁上下线

**解决方案**:
```
1. 多层连接策略:
   ├── 优先: 直接P2P连接 (WebRTC STUN)
   ├── 次选: 中继连接 (TURN服务器)
   └── 降级: 离线消息 (存储在中继服务器)

2. 节点发现:
   ├── DHT (Kademlia)
   ├── mDNS (局域网)
   └── 社交图谱提示 (好友节点推荐)

3. 离线支持:
   - 消息队列机制
   - 重连后自动同步
   - 离线状态标识

4. 全球中继节点:
   - 社区运营的公益节点
   - 用户可自愿贡献带宽
   - 激励机制 (信誉积分)
```

---

## 九、商业模式 (可选)

虽然系统完全开源和去中心化,但可通过以下方式可持续运营:

### 9.1 免费增值模式

**免费功能**:
- ✅ 完整知识库管理
- ✅ 基础社交功能
- ✅ 小额交易 (<1000元)
- ✅ 本地LLM推理
- ✅ Git同步 (用户自备仓库)

**高级功能** (订阅制):
- 🔒 云端LLM API额度 (GPT-4/Claude)
- 🔒 托管Git仓库 (100GB+)
- 🔒 全球加速中继节点
- 🔒 高级AI模型 (垂直领域微调)
- 🔒 企业版团队协作

### 9.2 企业服务

- 私有化部署
- 定制开发
- 技术支持合同
- 员工培训

### 9.3 生态收益

- U盾/SIMKey硬件销售分成
- 第三方插件市场 (抽成)
- 仲裁员服务费分成
- 交易手续费 (极低比例,如0.5%)

---

## 十、总结

这套**基于U盾和SIMKey的个人移动AI管理系统**整合了:

1. **知识库管理**: 个人第二大脑,本地AI增强检索和问答
2. **去中心化社交**: 基于DID的隐私优先社交网络
3. **去中心化交易**: AI辅助的可信交易平台

**核心优势**:
- 🔐 **极致安全**: 硬件级密钥保护,端到端加密
- 🌐 **完全去中心化**: 无需信任第三方平台
- 🧠 **AI原生**: 本地大模型,保护隐私的同时享受AI能力
- 📱 **跨设备**: PC、手机无缝协作
- 🔓 **开源自主**: 代码开源,数据自己掌控

**技术创新点**:
- Git-based数据同步 (而非传统云同步)
- Signal协议社交通信 (而非明文或简单加密)
- AI增强的信任网络 (而非中心化信誉系统)
- 智能合约托管 (而非第三方支付平台)

这是一个**面向未来的个人数据主权系统**,让每个人真正拥有自己的数字资产和AI助手!

---

## 附录A: 快速开始指南

### A.1 PC端安装 (Windows)

```bash
# 1. 下载安装包
wget https://github.com/chainlesschain/desktop/releases/latest/ChainlessChain-Setup.exe

# 2. 运行安装程序
./ChainlessChain-Setup.exe

# 3. 插入U盾

# 4. 按照向导完成初始化
```

### A.2 移动端安装 (Android)

```bash
# 1. 从Google Play下载
# 或下载APK直接安装

# 2. 打开应用,授予权限

# 3. 选择使用SIMKey或U盾 (通过OTG)

# 4. 扫描PC端二维码完成绑定
```

### A.3 第一次使用

```
1. 创建身份
   - 输入昵称
   - 选择头像
   - 系统生成DID

2. 配置Git仓库
   - 选择GitHub/GitLab/自托管
   - 输入凭证
   - 创建私有仓库

3. 安装AI模型
   - PC端自动下载Qwen2-7B
   - 移动端下载MiniCPM-2B (可选)

4. 开始使用
   - 添加第一条笔记
   - 体验AI问答
   - 添加好友 (扫描对方二维码)
```

---

## 附录B: API文档

### B.1 LLM API

```http
POST http://localhost:11434/api/generate
Content-Type: application/json

{
  "model": "qwen2:7b",
  "prompt": "解释一下量子计算的原理",
  "stream": false,
  "options": {
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 2000
  }
}
```

### B.2 向量检索API

```http
POST http://localhost:6333/collections/knowledge_base/points/search
Content-Type: application/json

{
  "vector": [0.1, 0.2, ...],  // 768维向量
  "limit": 10,
  "with_payload": true
}
```

### B.3 Git操作API (内部)

```typescript
interface GitAPI {
  init(path: string): Promise<void>;
  add(files: string[]): Promise<void>;
  commit(message: string, author: Author): Promise<string>;
  push(remote: string, branch: string): Promise<void>;
  pull(remote: string, branch: string): Promise<MergeResult>;
  status(): Promise<StatusResult>;
}
```

---

---

## 十一、实施完成总结 (2025-12-19更新)

### ✅ Phase 3 全部模块已完成实施

截至2025年12月19日,**Phase 3: 去中心化交易系统**的所有6个核心模块已全部完成实施,从理论设计转化为生产代码。

#### 已实现模块详情

**模块1: 数字资产管理** ✅
- **实现文件**: `desktop-app-vue/src/main/trade/asset-manager.js` (780行)
- **核心功能**:
  - 4种资产类型支持 (Token, NFT, 知识产品, 服务凭证)
  - 完整资产生命周期管理 (创建、铸造、转账、销毁)
  - 资产历史查询和余额管理
  - 资产所有权证明
- **数据库表**: assets, asset_holdings, asset_transfers

**模块2: 交易市场** ✅
- **实现文件**:
  - `marketplace-manager.js` (950行) - 市场管理
  - `escrow-manager.js` (600行) - 托管管理
- **核心功能**:
  - 3种订单类型 (买卖、服务、以物换物)
  - 智能匹配引擎
  - 3种托管类型 (简单、多重签名、时间锁)
  - 交付确认和纠纷处理
- **数据库表**: orders, transactions, escrows
- **前端界面**: MarketplaceList.vue, OrderCreate.vue

**模块3: 智能合约托管** ✅
- **实现文件**:
  - `contract-engine.js` (1200行) - 合约引擎
  - `contract-templates.js` (400行) - 合约模板
- **核心功能**:
  - 4种托管类型完整实现
  - 6种合约模板 (买卖、订阅、悬赏、交换、多签、时间锁)
  - 条件检查和自动执行引擎
  - 仲裁机制和纠纷处理
  - 完整的合约事件记录
- **数据库表**: contracts, contract_conditions, contract_events
- **前端界面**:
  - ContractList.vue (542行) - 合约列表
  - ContractCreate.vue (546行) - 创建向导
  - ContractDetail.vue (642行) - 详情页

**模块4: 知识付费系统** ✅
- **实现文件**: `knowledge-payment.js` (716行)
- **核心功能**:
  - 5种内容类型 (文章、视频、音频、课程、咨询)
  - AES-256-CBC内容加密保护
  - 3种定价模式 (一次性购买、订阅、打赏)
  - 订阅计划管理和自动续订
  - 访问控制和权限验证
  - 内容访问日志记录
- **数据库表**: paid_contents, content_purchases, subscription_plans, user_subscriptions, content_access_logs
- **前端界面**:
  - ContentStore.vue (489行) - 内容商店
  - MyPurchases.vue (305行) - 购买记录

**模块5: 信用评分系统** ✅
- **实现文件**: `credit-score.js` (596行)
- **核心功能**:
  - 6维度加权评分算法:
    - 交易完成率 (30%)
    - 交易金额 (20%)
    - 好评率 (25%)
    - 响应速度 (10%)
    - 纠纷率 (10%)
    - 退款率 (5%)
  - 5级信用等级体系 (新手→钻石)
  - 实时事件驱动更新
  - 完整统计和历史追踪
  - 信用排行榜
  - 信用快照和趋势分析
- **数据库表**: user_credits, credit_records, credit_snapshots
- **前端界面**: CreditScore.vue (398行)

**模块6: 评价和反馈系统** ✅
- **实现文件**: `review-manager.js` (565行)
- **核心功能**:
  - 星级评分 (1-5星) 和文字评价
  - 标签评价和图片证明
  - 匿名评价选项
  - 双向评价机制 (买卖互评)
  - 评价修改 (7天期限)
  - 评价回复功能
  - 有帮助投票
  - 举报和审核功能
  - 评价统计和推荐
- **数据库表**: reviews, review_replies, review_reports, review_helpful_votes

#### 技术亮点

1. **端到端加密**: AES-256-CBC内容加密,保护知识产权
2. **智能合约**: 多种合约模板,支持复杂业务场景
3. **信用算法**: 多维度加权评分,5级信用等级
4. **P2P同步**: 交易信息通过P2P网络实时同步
5. **事件驱动**: 实时更新信用评分和通知

#### 代码统计

**后端系统**:
- 9个核心文件
- 约5687行代码
- 15个数据库表

**前端界面**:
- 9个主要组件
- 约3384行代码
- 完整的UI交互

#### 路由集成

新增7个路由到主应用:
- `/friends` - 好友管理
- `/posts` - 社交动态
- `/marketplace` - 交易市场
- `/contracts` - 智能合约
- `/knowledge-store` - 知识付费
- `/my-purchases` - 我的购买
- `/credit-score` - 信用评分

#### Git提交记录

- **Commit 7e21b2c** (2025-12-18): 完成模块1-3 (资产、市场、合约)
- **Commit 9f1db66** (2025-12-19): 完成模块4-6 (知识付费、信用、评价)
- **Commit b94339f** (2025-12-19): 更新所有进度文档

### 下一步计划

#### Phase 4: Web Extension (待开始)
- 浏览器扩展开发
- 网页标注和保存
- 一键保存到知识库
- 网页内容摘要

#### 系统优化
- IPC API集成完善
- 单元测试和集成测试
- 性能优化
- 文档完善

详见项目文档:
- `CURRENT_STATUS.md` - 当前开发状态
- `docs/PHASE_3_IMPLEMENTATION_PLAN.md` - Phase 3实施计划
- `desktop-app-vue/PROJECT_SUMMARY.md` - 项目总结

---

**文档版本**: 2.0
**最后更新**: 2025-12-19
**作者**: Chainlesschain开发团队
**许可证**: CC BY-SA 4.0
