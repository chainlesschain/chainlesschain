# extended-tools

**Source**: `src\main\ai-engine\extended-tools.js`

**Generated**: 2026-01-27T06:44:03.880Z

---

## const

```javascript
const
```

* 扩展工具实现
 * 包含所有新增工具的处理函数
 *
 * 这些工具需要在 FunctionCaller 中注册才能使用

---

## static registerAll(functionCaller)

```javascript
static registerAll(functionCaller)
```

* 注册所有扩展工具到 FunctionCaller
   * @param {FunctionCaller} functionCaller - FunctionCaller 实例

---

## static _formatDate(date, format = 'YYYY-MM-DD HH:mm:ss')

```javascript
static _formatDate(date, format = 'YYYY-MM-DD HH:mm:ss')
```

* 格式化日期
   * @private

---

## static _addTime(date, amount, unit)

```javascript
static _addTime(date, amount, unit)
```

* 添加时间
   * @private

---

