# ai-engine-config

**Source**: `src/main/ai-engine/ai-engine-config.js`

**Generated**: 2026-02-15T08:42:37.277Z

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* AI引擎优化配置
 * 集中管理槽位填充、工具沙箱、性能监控等优化模块的配置
 *
 * 版本: v0.18.0 (P2优化)
 * 更新: 2026-01-01

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## const PRODUCTION_CONFIG =

```javascript
const PRODUCTION_CONFIG =
```

* 生产环境配置（更保守）

---

## const DEVELOPMENT_CONFIG =

```javascript
const DEVELOPMENT_CONFIG =
```

* 开发环境配置（更激进，快速失败）

---

## const TEST_CONFIG =

```javascript
const TEST_CONFIG =
```

* 测试环境配置（性能监控关闭，避免干扰测试）

---

## function getAIEngineConfig()

```javascript
function getAIEngineConfig()
```

* 获取当前环境配置

---

## function mergeConfig(userConfig =

```javascript
function mergeConfig(userConfig =
```

* 合并用户自定义配置
 * @param {Object} userConfig - 用户自定义配置
 * @returns {Object} 合并后的配置

---

