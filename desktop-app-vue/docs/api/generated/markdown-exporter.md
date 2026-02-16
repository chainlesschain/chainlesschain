# markdown-exporter

**Source**: `src/main/git/markdown-exporter.js`

**Generated**: 2026-02-16T13:44:34.663Z

---

## const

```javascript
const
```

* Markdown导出器
 *
 * 将SQLite数据库中的知识库项导出为Markdown文件

---

## class MarkdownExporter

```javascript
class MarkdownExporter
```

* Markdown导出器类

---

## async exportAll()

```javascript
async exportAll()
```

* 导出所有知识库项

---

## async exportItem(item)

```javascript
async exportItem(item)
```

* 导出单个知识库项
   * @param {Object} item - 知识库项

---

## generateFilename(item)

```javascript
generateFilename(item)
```

* 生成文件名
   * @param {Object} item - 知识库项

---

## generateMarkdown(item)

```javascript
generateMarkdown(item)
```

* 生成Markdown内容
   * @param {Object} item - 知识库项

---

## async exportById(id)

```javascript
async exportById(id)
```

* 导出单个项（通过ID）
   * @param {string} id - 项ID

---

## deleteExportedFile(filename)

```javascript
deleteExportedFile(filename)
```

* 删除导出的文件
   * @param {string} filename - 文件名

---

## cleanAll()

```javascript
cleanAll()
```

* 清理所有导出的文件

---

## async sync()

```javascript
async sync()
```

* 同步数据库到文件
   * - 导出所有项
   * - 删除不存在的项对应的文件

---

