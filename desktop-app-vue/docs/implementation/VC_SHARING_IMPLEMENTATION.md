# 可验证凭证分享功能实现文档

**版本**: v0.7.3
**日期**: 2025-12-18
**状态**: ✅ 已完成

---

## 📋 目录

1. [功能概述](#功能概述)
2. [技术架构](#技术架构)
3. [实现细节](#实现细节)
4. [使用指南](#使用指南)
5. [API 文档](#api-文档)
6. [安全考虑](#安全考虑)
7. [问题排查](#问题排查)

---

## 功能概述

可验证凭证（VC）分享功能允许用户通过多种方式安全地分享和接收凭证。

### 核心特性

- ✅ **二维码分享**：生成二维码供扫描
- ✅ **链接分享**：生成自定义协议链接
- ✅ **JSON 数据分享**：导出完整 JSON 数据
- ✅ **凭证导入**：通过 JSON 粘贴导入凭证
- ✅ **签名验证**：自动验证凭证签名和有效期
- ✅ **重复检测**：防止重复导入相同凭证

### 使用场景

1. **个人简历**：分享教育凭证和工作经历
2. **技能认证**：分享技能证书给潜在雇主
3. **社交网络**：分享信任背书建立信誉
4. **身份验证**：分享自我声明进行身份确认

---

## 技术架构

### 数据格式

#### 完整格式（Full Format）

```json
{
  "type": "VerifiableCredential",
  "version": "1.0",
  "sharedAt": 1734537600000,
  "credential": {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://chainlesschain.com/credentials/v1"
    ],
    "id": "urn:uuid:123e4567-e89b-12d3-a456-426614174000",
    "type": ["VerifiableCredential", "EducationCredential"],
    "issuer": "did:chainlesschain:abc123...",
    "credentialSubject": {
      "id": "did:chainlesschain:def456...",
      "degree": "Bachelor of Science"
    },
    "proof": {
      "type": "Ed25519Signature2020",
      "proofValue": "base64_signature..."
    }
  }
}
```

#### 紧凑格式（Compact Format）

用于二维码：

```json
{
  "t": "vc",
  "v": "1.0",
  "c": { "..." }
}
```

---

## 实现细节

### 后端实现

**文件**: `src/main/vc/vc-manager.js`

#### 1. 生成分享数据

```javascript
async generateShareData(id) {
  const credential = this.getCredentialById(id);
  const vcDocument = JSON.parse(credential.vc_document);

  const shareData = {
    type: 'VerifiableCredential',
    version: '1.0',
    sharedAt: Date.now(),
    credential: vcDocument,
    metadata: {
      issuer: credential.issuer_did,
      subject: credential.subject_did,
      issuedAt: credential.issued_at,
      expiresAt: credential.expires_at,
      status: credential.status,
    },
  };

  const compactData = {
    t: 'vc',
    v: '1.0',
    c: vcDocument,
  };

  return {
    fullData: shareData,
    compactData,
    qrCodeData: JSON.stringify(compactData),
    shareUrl: `chainlesschain://vc/${id}`,
  };
}
```

#### 2. 导入分享数据

```javascript
async importFromShareData(shareData) {
  // 解析格式
  let vcDocument;
  if (shareData.t === 'vc') {
    vcDocument = shareData.c;
  } else if (shareData.type === 'VerifiableCredential') {
    vcDocument = shareData.credential;
  }

  // 验证凭证
  const isValid = await this.verifyCredential(vcDocument);
  if (!isValid) {
    throw new Error('凭证验证失败');
  }

  // 检查重复
  const existing = this.getCredentialById(vcDocument.id);
  if (existing) {
    throw new Error('凭证已存在');
  }

  // 保存到数据库
  await this.saveCredential(vcRecord);

  return result;
}
```

### 前端实现

**文件**: `src/renderer/components/VCManagement.vue`

#### 分享功能

```javascript
async function handleShareCredential(id) {
  const data = await window.electronAPI.vc.generateShareData(id);
  shareData.value = data;

  // 生成二维码
  await QRCode.toCanvas(qrcodeCanvas.value, data.qrCodeData, {
    width: 300,
    margin: 2,
  });

  qrcodeImage.value = qrcodeCanvas.value.toDataURL();
  showShareModal.value = true;
}
```

#### 导入功能

```javascript
async function handleImportShare() {
  const shareData = JSON.parse(importJsonText.value);
  const result = await window.electronAPI.vc.importFromShare(shareData);

  message.success('凭证已成功导入');
  await loadCredentials();
}
```

---

## 使用指南

### 分享凭证

1. 在凭证列表中点击"分享"按钮
2. 选择分享方式：
   - **二维码**：显示二维码供扫描
   - **链接**：复制自定义协议链接
   - **JSON**：复制完整 JSON 数据

### 接收凭证

1. 点击"扫码接收"按钮
2. 选择导入方式：
   - **扫描二维码**（待实现）
   - **粘贴 JSON**：粘贴凭证数据并确认

---

## API 文档

### 后端 API

#### `generateShareData(id)`

生成凭证分享数据。

**参数**: `id` (string) - 凭证 ID

**返回值**:
```typescript
{
  fullData: object;
  compactData: object;
  qrCodeData: string;
  shareUrl: string;
}
```

#### `importFromShareData(shareData)`

从分享数据导入凭证。

**参数**: `shareData` (object) - 分享数据

**返回值**:
```typescript
{
  id: string;
  type: string;
  issuer_did: string;
  subject_did: string;
}
```

### IPC API

- `vc:generate-share-data` - 生成分享数据
- `vc:import-from-share` - 导入凭证

---

## 安全考虑

### 1. 签名验证

所有导入的凭证必须通过 Ed25519 签名验证。

### 2. DID 解析

如果本地没有颁发者身份，尝试从 DHT 解析。

### 3. 重复检测

防止重复导入相同凭证。

### 4. 数据验证

- 必需字段检查
- 类型验证
- DID 格式验证
- 时间戳有效性

---

## 问题排查

### 二维码无法生成

**解决方案**:
```bash
npm install qrcode
```

### 导入失败 - 签名无效

检查：
1. 凭证数据完整性
2. 颁发者 DID 是否可解析
3. 凭证是否过期

### JSON 格式错误

确保粘贴的是有效的 JSON 格式数据。

---

## 未来改进

### 短期
1. 二维码扫描功能
2. 批量分享
3. 分享历史

### 中期
4. 加密分享
5. 自定义协议处理
6. P2P 直接传输

### 长期
7. NFC 分享（移动端）
8. 蓝牙分享
9. 区块链锚定

---

## 版本历史

### v0.7.3 (2025-12-18)

✅ **新增功能**：
- 凭证分享功能（二维码、链接、JSON）
- 凭证导入功能（JSON 粘贴）
- 签名验证和重复检测

✅ **API**：
- `generateShareData()` - 生成分享数据
- `importFromShareData()` - 导入凭证

🔄 **待实现**：
- 二维码扫描功能

---

## 相关文档

- [可验证凭证实现文档](./VC_IMPLEMENTATION.md)
- [可验证凭证模板系统](./VC_TEMPLATE_SYSTEM.md)
- [DID 身份系统](./DID_IMPLEMENTATION_COMPLETE.md)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)

---

**文档版本**: v0.7.3
**最后更新**: 2025-12-18
**作者**: ChainlessChain 开发团队
