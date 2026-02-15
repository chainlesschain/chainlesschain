# file-security-validator

**Source**: `src/main/file/file-security-validator.js`

**Generated**: 2026-02-15T10:10:53.423Z

---

## const

```javascript
const
```

* 文件安全性验证器
 *
 * 职责：
 * - 验证文件类型安全性
 * - 检查文件大小限制
 * - 防止恶意文件

---

## const SECURITY_CONFIG =

```javascript
const SECURITY_CONFIG =
```

* 安全配置

---

## class FileSecurityValidator

```javascript
class FileSecurityValidator
```

* 文件安全性验证器类

---

## validate(file)

```javascript
validate(file)
```

* 验证文件安全性
   * @param {Object} file - 文件对象
   * @param {string} file.display_name - 文件名
   * @param {number} file.file_size - 文件大小（字节）
   * @param {string} file.mime_type - MIME类型
   * @returns {Object} 验证结果

---

## checkFileSize(size)

```javascript
checkFileSize(size)
```

* 检查文件大小
   * @param {number} size - 文件大小（字节）
   * @returns {Object} 检查结果

---

## checkFileExtension(fileName)

```javascript
checkFileExtension(fileName)
```

* 检查文件扩展名
   * @param {string} fileName - 文件名
   * @returns {Object} 检查结果

---

## checkMimeType(mimeType)

```javascript
checkMimeType(mimeType)
```

* 检查MIME类型
   * @param {string} mimeType - MIME类型
   * @returns {Object} 检查结果

---

## checkFileName(fileName)

```javascript
checkFileName(fileName)
```

* 检查文件名
   * @param {string} fileName - 文件名
   * @returns {Object} 检查结果

---

## validateBatch(files)

```javascript
validateBatch(files)
```

* 批量验证文件
   * @param {Array} files - 文件列表
   * @returns {Object} 批量验证结果

---

## getConfig()

```javascript
getConfig()
```

* 获取安全配置
   * @returns {Object} 当前安全配置

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新安全配置
   * @param {Object} newConfig - 新配置

---

## isImage(file)

```javascript
isImage(file)
```

* 检查文件是否为图片
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为图片

---

## isVideo(file)

```javascript
isVideo(file)
```

* 检查文件是否为视频
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为视频

---

## isDocument(file)

```javascript
isDocument(file)
```

* 检查文件是否为文档
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否为文档

---

## getRiskLevel(file)

```javascript
getRiskLevel(file)
```

* 获取文件风险等级
   * @param {Object} file - 文件对象
   * @returns {string} 风险等级: low, medium, high

---

