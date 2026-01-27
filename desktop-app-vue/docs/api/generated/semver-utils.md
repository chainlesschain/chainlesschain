# semver-utils

**Source**: `src\main\plugins\semver-utils.js`

**Generated**: 2026-01-27T06:44:03.828Z

---

## function parseVersion(version)

```javascript
function parseVersion(version)
```

* 轻量级 Semver 版本检查工具
 * 支持基本的语义化版本比较和范围检查

---

## function parseVersion(version)

```javascript
function parseVersion(version)
```

* 解析版本号字符串
 * @param {string} version - 版本号 (如 "1.2.3", "1.2.3-beta.1")
 * @returns {Object|null} 解析后的版本对象

---

## function compareVersions(v1, v2)

```javascript
function compareVersions(v1, v2)
```

* 比较两个版本号
 * @param {string} v1 - 版本号 1
 * @param {string} v2 - 版本号 2
 * @returns {number} -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)

---

## function parseRange(range)

```javascript
function parseRange(range)
```

* 解析版本范围
 * 支持: >=1.0.0, >1.0.0, <=1.0.0, <1.0.0, =1.0.0, ^1.0.0, ~1.0.0, 1.0.x, *
 * @param {string} range - 版本范围表达式
 * @returns {Object} 范围对象 { type, version, min, max }

---

## function satisfies(version, range)

```javascript
function satisfies(version, range)
```

* 检查版本是否满足范围要求
 * @param {string} version - 要检查的版本
 * @param {string} range - 版本范围
 * @returns {boolean} 是否满足

---

## function gt(v1, v2)

```javascript
function gt(v1, v2)
```

* 检查版本 v1 是否大于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}

---

## function gte(v1, v2)

```javascript
function gte(v1, v2)
```

* 检查版本 v1 是否大于等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}

---

## function lt(v1, v2)

```javascript
function lt(v1, v2)
```

* 检查版本 v1 是否小于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}

---

## function lte(v1, v2)

```javascript
function lte(v1, v2)
```

* 检查版本 v1 是否小于等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}

---

## function eq(v1, v2)

```javascript
function eq(v1, v2)
```

* 检查版本 v1 是否等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}

---

## function valid(version)

```javascript
function valid(version)
```

* 检查版本号是否有效
 * @param {string} version
 * @returns {boolean}

---

## function clean(version)

```javascript
function clean(version)
```

* 清理版本号（移除前缀等）
 * @param {string} version
 * @returns {string|null}

---

