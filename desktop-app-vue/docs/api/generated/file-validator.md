# file-validator

**Source**: `src\main\security\file-validator.js`

**Generated**: 2026-01-27T06:44:03.819Z

---

## const fs = require("fs").promises;

```javascript
const fs = require("fs").promises;
```

* File Validator
 *
 * 文件安全验证器
 * - MIME类型检测
 * - 文件大小限制
 * - 恶意文件检测
 * - 文件扩展名白名单

---

## const ALLOWED_FILE_TYPES =

```javascript
const ALLOWED_FILE_TYPES =
```

* 允许的文件类型配置

---

## const DANGEROUS_EXTENSIONS = [

```javascript
const DANGEROUS_EXTENSIONS = [
```

* 危险文件扩展名黑名单

---

## const FILE_SIGNATURES =

```javascript
const FILE_SIGNATURES =
```

* 文件头签名 (Magic Numbers)
 * 用于验证真实的文件类型

---

## static async validateFile(filePath, category = null)

```javascript
static async validateFile(filePath, category = null)
```

* 验证文件
   * @param {string} filePath - 文件路径
   * @param {string} category - 文件类别 (document, image, audio, video, archive, spreadsheet, presentation, code)
   * @returns {Promise<Object>} 验证结果

---

## static detectCategory(extension)

```javascript
static detectCategory(extension)
```

* 检测文件类别

---

## static async readFileSignature(filePath, length = 8)

```javascript
static async readFileSignature(filePath, length = 8)
```

* 读取文件头签名

---

## static getMimeTypeFromSignature(signature)

```javascript
static getMimeTypeFromSignature(signature)
```

* 根据签名获取MIME类型

---

## static async calculateFileHash(filePath)

```javascript
static async calculateFileHash(filePath)
```

* 计算文件哈希值 (SHA256)

---

## static async performSecurityChecks(filePath, result)

```javascript
static async performSecurityChecks(filePath, result)
```

* 执行额外的安全检查

---

## static async validateFiles(filePaths, category = null)

```javascript
static async validateFiles(filePaths, category = null)
```

* 批量验证文件

---

## static getAllowedExtensions(category = null)

```javascript
static getAllowedExtensions(category = null)
```

* 获取允许的文件扩展名列表

---

## static getAllowedMimeTypes(category = null)

```javascript
static getAllowedMimeTypes(category = null)
```

* 获取允许的MIME类型列表

---

## static getMaxFileSize(category)

```javascript
static getMaxFileSize(category)
```

* 获取最大文件大小

---

