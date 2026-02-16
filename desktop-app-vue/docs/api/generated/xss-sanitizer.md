# xss-sanitizer

**Source**: `src/main/security/xss-sanitizer.js`

**Generated**: 2026-02-16T22:06:51.434Z

---

## const DANGEROUS_TAGS = [

```javascript
const DANGEROUS_TAGS = [
```

* XSS Sanitizer
 *
 * XSS防护工具 - 主进程端
 * - HTML内容清理
 * - Markdown内容清理
 * - URL验证
 * - 脚本注入检测

---

## const DANGEROUS_TAGS = [

```javascript
const DANGEROUS_TAGS = [
```

* 危险的HTML标签

---

## const DANGEROUS_ATTRS = [

```javascript
const DANGEROUS_ATTRS = [
```

* 危险的HTML属性

---

## const ALLOWED_PROTOCOLS = [

```javascript
const ALLOWED_PROTOCOLS = [
```

* 允许的URL协议

---

## static sanitizeHTML(html, options =

```javascript
static sanitizeHTML(html, options =
```

* 清理HTML内容
   * @param {string} html - HTML内容
   * @param {Object} options - 选项
   * @returns {string} 清理后的HTML

---

## static sanitizeMarkdown(markdown)

```javascript
static sanitizeMarkdown(markdown)
```

* 清理Markdown内容
   * @param {string} markdown - Markdown内容
   * @returns {string} 清理后的Markdown

---

## static validateURL(url)

```javascript
static validateURL(url)
```

* 验证URL安全性
   * @param {string} url - URL地址
   * @returns {Object} 验证结果

---

## static detectXSS(content)

```javascript
static detectXSS(content)
```

* 检测XSS攻击模式
   * @param {string} content - 内容
   * @returns {Array} 检测到的威胁

---

## static encodeHTMLEntities(str)

```javascript
static encodeHTMLEntities(str)
```

* 编码HTML实体
   * @param {string} str - 字符串
   * @returns {string} 编码后的字符串

---

## static decodeHTMLEntities(str)

```javascript
static decodeHTMLEntities(str)
```

* 解码HTML实体
   * @param {string} str - 字符串
   * @returns {string} 解码后的字符串

---

## static sanitizeJSON(obj)

```javascript
static sanitizeJSON(obj)
```

* 清理JSON内容中的XSS
   * @param {Object} obj - JSON对象
   * @returns {Object} 清理后的对象

---

## static sanitizeUserInput(input, options =

```javascript
static sanitizeUserInput(input, options =
```

* 清理用户输入
   * @param {string} input - 用户输入
   * @param {Object} options - 选项
   * @returns {string} 清理后的输入

---

## static generateCSP()

```javascript
static generateCSP()
```

* 生成内容安全策略 (CSP) 头
   * @returns {string} CSP字符串

---

