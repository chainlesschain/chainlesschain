# 可验证凭证 (Verifiable Credentials) 实现完成

**完成时间**: 2025-12-18
**版本**: v0.7.0

---

## ✅ 完成内容

### 1. VC Manager (`vc/vc-manager.js`)

完整的可验证凭证管理器，实现 W3C VC 标准。

#### 核心功能
- ✅ **创建凭证**: 颁发各种类型的可验证凭证
- ✅ **签名凭证**: 使用 Ed25519 数字签名
- ✅ **验证凭证**: 验证签名和有效期
- ✅ **撤销凭证**: 颁发者可撤销已颁发的凭证
- ✅ **导出凭证**: 导出为标准 JSON 格式
- ✅ **统计信息**: 颁发/接收凭证统计

#### 支持的凭证类型
1. **SelfDeclaration** - 自我声明
2. **SkillCertificate** - 技能证书
3. **TrustEndorsement** - 信任背书
4. **EducationCredential** - 教育凭证
5. **WorkExperience** - 工作经历

#### 数据库表结构

```sql
CREATE TABLE verifiable_credentials (
  id TEXT PRIMARY KEY,              -- VC ID (urn:uuid:xxx)
  type TEXT NOT NULL,               -- 凭证类型
  issuer_did TEXT NOT NULL,         -- 颁发者 DID
  subject_did TEXT NOT NULL,        -- 主体 DID
  claims TEXT NOT NULL,             -- 声明内容 (JSON)
  vc_document TEXT NOT NULL,        -- 完整 VC 文档 (JSON)
  issued_at INTEGER NOT NULL,       -- 颁发时间
  expires_at INTEGER,               -- 过期时间 (可为空)
  status TEXT DEFAULT 'active',     -- 状态: active/revoked/expired
  created_at INTEGER NOT NULL       -- 创建时间
);

-- 索引
CREATE INDEX idx_vc_issuer ON verifiable_credentials(issuer_did);
CREATE INDEX idx_vc_subject ON verifiable_credentials(subject_did);
CREATE INDEX idx_vc_type ON verifiable_credentials(type);
CREATE INDEX idx_vc_status ON verifiable_credentials(status);
```

#### VC 文档结构 (W3C 标准)

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://chainlesschain.com/credentials/v1"
  ],
  "id": "urn:uuid:3978344f-8596-4c3a-a978-8fcaba3903c5",
  "type": ["VerifiableCredential", "SkillCertificate"],
  "issuer": "did:chainlesschain:1a2b3c4d5e6f...",
  "issuanceDate": "2025-12-18T10:30:00Z",
  "expirationDate": "2026-12-18T10:30:00Z",
  "credentialSubject": {
    "id": "did:chainlesschain:9f8e7d6c5b4a...",
    "skill": "JavaScript",
    "level": "Expert",
    "yearsOfExperience": 5
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2025-12-18T10:30:00Z",
    "verificationMethod": "did:chainlesschain:1a2b3c4d5e6f...#sign-key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "base64_encoded_signature..."
  }
}
```

### 2. 主进程集成 (`index.js`)

#### 初始化

```javascript
// 初始化可验证凭证管理器
const { VCManager } = require('./vc/vc-manager');
this.vcManager = new VCManager(this.database, this.didManager);
await this.vcManager.initialize();
```

#### IPC 处理器 (8 个)

1. `vc:create` - 创建凭证
2. `vc:get-all` - 获取凭证列表
3. `vc:get` - 获取单个凭证
4. `vc:verify` - 验证凭证
5. `vc:revoke` - 撤销凭证
6. `vc:delete` - 删除凭证
7. `vc:export` - 导出凭证
8. `vc:get-statistics` - 获取统计信息

### 3. Preload API (`preload/index.js`)

```javascript
window.electronAPI.vc = {
  create: (params) => ipcRenderer.invoke('vc:create', params),
  getAll: (filters) => ipcRenderer.invoke('vc:get-all', filters),
  get: (id) => ipcRenderer.invoke('vc:get', id),
  verify: (vcDocument) => ipcRenderer.invoke('vc:verify', vcDocument),
  revoke: (id, issuerDID) => ipcRenderer.invoke('vc:revoke', id, issuerDID),
  delete: (id) => ipcRenderer.invoke('vc:delete', id),
  export: (id) => ipcRenderer.invoke('vc:export', id),
  getStatistics: (did) => ipcRenderer.invoke('vc:get-statistics', did),
};
```

### 4. UI 组件 (`VCManagement.vue`)

#### 功能特性
- ✅ **标签切换**: 已颁发 / 已接收
- ✅ **统计面板**: 总数、颁发数、接收数
- ✅ **凭证列表**: 分页显示，带状态标签
- ✅ **创建凭证**: 表单式创建，支持 JSON 声明
- ✅ **查看详情**: 完整信息展示
- ✅ **验证功能**: 一键验证签名和有效期
- ✅ **撤销功能**: 颁发者可撤销凭证
- ✅ **导出功能**: 导出为 JSON 文件

#### UI 截面

**凭证列表卡片**:
- 凭证类型标题
- 状态标签（有效/已撤销/已过期）
- 颁发者和主体 DID
- 颁发时间和过期时间
- 操作按钮：查看、验证、撤销、导出

**创建凭证表单**:
- 凭证类型下拉选择
- 主体 DID 输入框
- 声明内容（JSON 格式）
- 有效期设置（天数）

### 5. 路由集成

```javascript
{
  path: 'credentials',
  name: 'VCManagement',
  component: () => import('../components/VCManagement.vue'),
}
```

导航按钮位于主布局顶部工具栏，图标为证书图标 (SafetyCertificateOutlined)。

---

## 🎯 技术架构

### 凭证创建流程

```
用户填写凭证信息
       ↓
验证表单数据
       ↓
构建 VC 文档
       ↓
使用颁发者私钥签名
       ↓
保存到数据库
       ↓
更新 UI 显示
```

### 凭证验证流程

```
读取 VC 文档
       ↓
解析签名和公钥
       ↓
从 DID 获取颁发者公钥
  （本地或 DHT）
       ↓
验证 Ed25519 签名
       ↓
检查有效期
       ↓
返回验证结果
```

### 数据流图

```
┌──────────────┐
│ UI Component │
│ (Vue)        │
└──────┬───────┘
       │ IPC
       ↓
┌──────────────┐
│ Main Process │
│ IPC Handlers │
└──────┬───────┘
       │
       ↓
┌──────────────┐     ┌──────────────┐
│  VC Manager  │ ←→  │ DID Manager  │
└──────┬───────┘     └──────────────┘
       │
       ↓
┌──────────────┐
│   Database   │
│  (SQLite)    │
└──────────────┘
```

---

## 📋 使用指南

### 1. 颁发凭证

#### UI 操作
1. 点击顶部导航栏的"可验证凭证"图标
2. 点击"颁发凭证"按钮
3. 填写表单：
   - 选择凭证类型
   - 输入主体 DID
   - 输入声明内容（JSON 格式）
   - 设置有效期（可选）
4. 点击"确定"完成颁发

#### API 调用
```javascript
const params = {
  type: 'SkillCertificate',
  issuerDID: 'did:chainlesschain:issuer123...',
  subjectDID: 'did:chainlesschain:subject456...',
  claims: {
    skill: 'JavaScript',
    level: 'Expert',
    yearsOfExperience: 5
  },
  expiresIn: 365 * 24 * 60 * 60 * 1000  // 1 年（毫秒）
};

const result = await window.electronAPI.vc.create(params);
console.log('凭证已创建:', result.id);
```

### 2. 查看凭证

#### 查看已颁发的凭证
```javascript
// 筛选条件
const filters = {
  issuerDID: 'did:chainlesschain:issuer123...',
  type: 'SkillCertificate',
  status: 'active'
};

const credentials = await window.electronAPI.vc.getAll(filters);
console.log('已颁发凭证:', credentials);
```

#### 查看已接收的凭证
```javascript
const filters = {
  subjectDID: 'did:chainlesschain:subject456...'
};

const credentials = await window.electronAPI.vc.getAll(filters);
console.log('已接收凭证:', credentials);
```

### 3. 验证凭证

```javascript
// 方式1: 通过ID验证
const id = 'urn:uuid:3978344f-8596-4c3a-a978-8fcaba3903c5';
const vcDocument = await window.electronAPI.vc.export(id);
const isValid = await window.electronAPI.vc.verify(vcDocument);
console.log('验证结果:', isValid);

// 方式2: 验证外部凭证
const externalVC = JSON.parse(vcJsonString);
const isValid = await window.electronAPI.vc.verify(externalVC);
```

### 4. 撤销凭证

```javascript
const id = 'urn:uuid:3978344f-8596-4c3a-a978-8fcaba3903c5';
const issuerDID = 'did:chainlesschain:issuer123...';

await window.electronAPI.vc.revoke(id, issuerDID);
console.log('凭证已撤销');
```

### 5. 导出凭证

```javascript
const id = 'urn:uuid:3978344f-8596-4c3a-a978-8fcaba3903c5';
const vcDocument = await window.electronAPI.vc.export(id);

// 保存为文件
const blob = new Blob([JSON.stringify(vcDocument, null, 2)], {
  type: 'application/json'
});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'credential.json';
a.click();
```

---

## 🔧 凭证类型详解

### 1. SelfDeclaration (自我声明)

用于声明自己的信息、偏好、身份等。

**示例声明**:
```json
{
  "statement": "我是一名全栈开发者",
  "specialization": "Web3 和区块链",
  "languages": ["中文", "英文"]
}
```

### 2. SkillCertificate (技能证书)

用于证明某项技能的掌握程度。

**示例声明**:
```json
{
  "skill": "JavaScript",
  "level": "Expert",
  "yearsOfExperience": 5,
  "certifications": ["AWS Certified Developer"]
}
```

### 3. TrustEndorsement (信任背书)

用于为他人提供信任背书。

**示例声明**:
```json
{
  "trustLevel": "High",
  "relationship": "Colleague",
  "endorsement": "可靠的合作伙伴，具有出色的技术能力",
  "duration": "3 years"
}
```

### 4. EducationCredential (教育凭证)

用于证明教育背景。

**示例声明**:
```json
{
  "degree": "Bachelor of Science",
  "major": "Computer Science",
  "institution": "清华大学",
  "graduationYear": 2020,
  "gpa": "3.8/4.0"
}
```

### 5. WorkExperience (工作经历)

用于证明工作经历和成就。

**示例声明**:
```json
{
  "position": "Senior Software Engineer",
  "company": "Tech Corp",
  "startDate": "2020-01",
  "endDate": "2023-12",
  "responsibilities": "负责区块链应用开发"
}
```

---

## 🔐 安全性考虑

### 1. 签名验证

- ✅ 所有 VC 使用 Ed25519 数字签名
- ✅ 签名验证确保凭证未被篡改
- ✅ 自动检查颁发者身份

### 2. 有效期检查

- ✅ 支持设置过期时间
- ✅ 验证时自动检查是否过期
- ✅ 过期凭证标记为 `expired` 状态

### 3. 撤销机制

- ✅ 只有颁发者可以撤销凭证
- ✅ 撤销的凭证标记为 `revoked` 状态
- ✅ 验证时自动检查撤销状态

### 4. 隐私保护

- ✅ 私钥存储在本地（未来可用 U 盾）
- ✅ 只有必要信息包含在凭证中
- ✅ 可选择性披露凭证

---

## 🚀 后续优化

### 短期 (1-2 周)

- [ ] 凭证模板系统
- [ ] 批量导入/导出凭证
- [ ] 凭证搜索和过滤增强
- [ ] 凭证预览功能

### 中期 (2-4 周)

- [ ] 凭证链（一个凭证基于另一个凭证）
- [ ] 凭证分享功能（生成分享链接）
- [ ] 凭证展示页面（公开展示）
- [ ] 凭证历史记录

### 长期 (1-3 月)

- [ ] 去中心化凭证注册表
- [ ] 凭证市场（交易凭证）
- [ ] 智能合约集成
- [ ] 多签凭证（多方共同签发）

---

## 🎉 总结

### 已实现

- ✅ 完整的 VC 管理器（创建、验证、撤销）
- ✅ 5 种凭证类型支持
- ✅ 符合 W3C VC 标准
- ✅ Ed25519 数字签名
- ✅ 完整的 UI 组件
- ✅ 统计和导出功能
- ✅ 8 个 IPC 处理器
- ✅ 完整的数据库支持

### 技术亮点

- 🏆 **W3C 标准**: 完全符合 W3C Verifiable Credentials 标准
- 🔐 **安全可靠**: Ed25519 签名 + 有效期检查 + 撤销机制
- 🎨 **用户友好**: 直观的 UI + 实时验证反馈
- 📊 **统计分析**: 凭证数量、类型分布统计
- 🌐 **去中心化**: 基于 DID，无需中心化服务器

### 应用场景

1. **求职**: 展示技能证书和工作经历
2. **社交网络**: 信任背书和身份验证
3. **教育**: 学历证明和成绩单
4. **自由职业**: 客户评价和项目经验
5. **身份认证**: 可验证的身份声明

---

**下一步**: 实现凭证模板系统和分享功能！

*文档版本: v0.7.0*
*更新时间: 2025-12-18*
