# order-export

**Source**: `src/main/blockchain/order-export.js`

**Generated**: 2026-02-22T01:23:36.753Z

---

## const

```javascript
const
```

* 订单导出模块
 * 支持导出订单为 PDF 和图片格式

---

## function generateOrderHTML(order)

```javascript
function generateOrderHTML(order)
```

* 生成订单 HTML 模板
 * @param {Object} order - 订单数据
 * @returns {string} HTML 字符串

---

## function getTempDir()

```javascript
function getTempDir()
```

* 获取临时目录
 * @returns {string} 临时目录路径

---

## async function exportOrderToPDF(order, options =

```javascript
async function exportOrderToPDF(order, options =
```

* 导出订单为 PDF
 * @param {Object} order - 订单数据
 * @param {Object} options - 导出选项
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}

---

## async function exportOrderToImage(order, options =

```javascript
async function exportOrderToImage(order, options =
```

* 导出订单为图片
 * @param {Object} order - 订单数据
 * @param {Object} options - 导出选项
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}

---

## class ShareLinkManager

```javascript
class ShareLinkManager
```

* 分享链接管理器

---

## _ensureTable()

```javascript
_ensureTable()
```

* 确保分享链接表存在

---

## async saveLink(linkData)

```javascript
async saveLink(linkData)
```

* 保存分享链接
   * @param {Object} linkData - 链接数据
   * @returns {Promise<{success: boolean, id?: number, error?: string}>}

---

## async validateLink(token)

```javascript
async validateLink(token)
```

* 验证分享链接
   * @param {string} token - 链接令牌
   * @returns {Promise<{valid: boolean, link?: Object, error?: string}>}

---

## async revokeLink(orderId, token = null)

```javascript
async revokeLink(orderId, token = null)
```

* 撤销分享链接
   * @param {string} orderId - 订单 ID
   * @param {string} token - 可选，指定令牌；不传则撤销该订单所有链接
   * @returns {Promise<{success: boolean, count?: number, error?: string}>}

---

## async getLinksForOrder(orderId)

```javascript
async getLinksForOrder(orderId)
```

* 获取订单的所有分享链接
   * @param {string} orderId - 订单 ID
   * @returns {Promise<Array>}

---

