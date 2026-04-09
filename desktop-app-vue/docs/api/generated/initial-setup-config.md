# initial-setup-config

**Source**: `src/main/config/initial-setup-config.js`

**Generated**: 2026-04-09T06:50:46.686Z

---

## async applyToSystem(appConfig, llmConfig, database)

```javascript
async applyToSystem(appConfig, llmConfig, database)
```

* 应用配置到系统各个配置管理器

---

## async function prewarmInitialSetupConfig(userDataPath)

```javascript
async function prewarmInitialSetupConfig(userDataPath)
```

* M2: 异步预热入口。bootstrap 早期 await 此函数后，
 * 后续 `new InitialSetupConfig(userDataPath)` 将命中缓存避免阻塞 IO。

---

