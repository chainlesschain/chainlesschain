# pptx-parser

**Source**: `src/main/utils/pptx-parser.js`

**Generated**: 2026-02-21T22:04:25.763Z

---

## const

```javascript
const
```

* 自定义 PPTX 解析器
 * 使用 JSZip 和 xml2js 直接解析 PPTX 文件

---

## async function parsePPTX(filePath)

```javascript
async function parsePPTX(filePath)
```

* 解析 PPTX 文件
 * @param {string} filePath - PPTX 文件路径
 * @returns {Promise<Array>} 幻灯片数组

---

## function extractTexts(obj, texts = [])

```javascript
function extractTexts(obj, texts = [])
```

* 从 XML 对象中递归提取所有文本
 * @param {Object} obj - XML 解析后的对象
 * @param {Array} texts - 文本数组（用于递归）
 * @returns {Array} 文本数组

---

