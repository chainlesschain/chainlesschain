# file-importer

**Source**: `src/main/import/file-importer.js`

**Generated**: 2026-02-22T01:23:36.725Z

---

## const

```javascript
const
```

* 文件导入器
 * 支持 PDF、Word、Markdown 等多种文件格式的导入
 *
 * v0.17.0: 集成文件安全验证

---

## isSupportedFile(filePath)

```javascript
isSupportedFile(filePath)
```

* 检查文件格式是否支持

---

## getFileType(filePath)

```javascript
getFileType(filePath)
```

* 获取文件类型

---

## async importFile(filePath, options =

```javascript
async importFile(filePath, options =
```

* 导入单个文件

---

## async importFiles(filePaths, options =

```javascript
async importFiles(filePaths, options =
```

* 批量导入文件

---

## async importMarkdown(filePath, options =

```javascript
async importMarkdown(filePath, options =
```

* 导入 Markdown 文件

---

## async importPDF(filePath, options =

```javascript
async importPDF(filePath, options =
```

* 导入 PDF 文件
   * 需要 pdf-parse 库
   *
   * v0.18.0: 新增流式导入支持（大文件优化）

---

## async importWord(filePath, options =

```javascript
async importWord(filePath, options =
```

* 导入 Word 文件
   * 需要 mammoth 库

---

## async importText(filePath, options =

```javascript
async importText(filePath, options =
```

* 导入纯文本文件

---

## getSupportedFormats()

```javascript
getSupportedFormats()
```

* 获取支持的文件格式列表

---

## getSupportedExtensions()

```javascript
getSupportedExtensions()
```

* 获取支持的文件扩展名列表（用于文件选择对话框）

---

