# archive-manager

**Source**: `src/main/archive/archive-manager.js`

**Generated**: 2026-02-21T20:04:16.277Z

---

## const

```javascript
const
```

* 压缩包管理器
 * 支持 ZIP, RAR, 7Z 格式的预览和提取

---

## async ensureTempDir()

```javascript
async ensureTempDir()
```

* 确保临时目录存在

---

## async listContents(archivePath)

```javascript
async listContents(archivePath)
```

* 列出压缩包内容
   * @param {string} archivePath - 压缩包路径
   * @returns {Promise<Array>} 文件列表

---

## async listZipContents(zipPath)

```javascript
async listZipContents(zipPath)
```

* 列出ZIP内容

---

## async list7zContents(archivePath)

```javascript
async list7zContents(archivePath)
```

* 列出7Z内容

---

## async listRarContents(rarPath)

```javascript
async listRarContents(rarPath)
```

* 列出RAR内容（使用7z）

---

## async extractFile(archivePath, filePath)

```javascript
async extractFile(archivePath, filePath)
```

* 提取单个文件到临时目录
   * @param {string} archivePath - 压缩包路径
   * @param {string} filePath - 文件在压缩包内的路径
   * @returns {Promise<string>} 提取后的文件路径

---

## async extractZipFile(zipPath, filePath, outputPath)

```javascript
async extractZipFile(zipPath, filePath, outputPath)
```

* 从ZIP提取文件

---

## async extract7zFile(archivePath, filePath, outputPath)

```javascript
async extract7zFile(archivePath, filePath, outputPath)
```

* 从7Z/RAR提取文件

---

## async getArchiveInfo(archivePath)

```javascript
async getArchiveInfo(archivePath)
```

* 获取压缩包信息
   * @param {string} archivePath - 压缩包路径
   * @returns {Promise<Object>} 压缩包信息

---

## buildTree(flatList)

```javascript
buildTree(flatList)
```

* 构建文件树结构

---

## getFileType(fileName)

```javascript
getFileType(fileName)
```

* 获取文件类型

---

## get7zBinary()

```javascript
get7zBinary()
```

* 获取7z二进制路径

---

## async cleanup()

```javascript
async cleanup()
```

* 清理临时文件

---

