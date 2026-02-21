# global-shortcut-manager

**Source**: `src/main/system/global-shortcut-manager.js`

**Generated**: 2026-02-21T22:04:25.772Z

---

## const

```javascript
const
```

* 全局快捷键注册器
 * 管理Electron全局快捷键

---

## register(accelerator, handler, options =

```javascript
register(accelerator, handler, options =
```

* 注册快捷键

---

## unregister(accelerator)

```javascript
unregister(accelerator)
```

* 注销快捷键

---

## unregisterAll()

```javascript
unregisterAll()
```

* 注销所有快捷键

---

## isRegistered(accelerator)

```javascript
isRegistered(accelerator)
```

* 检查快捷键是否已注册

---

## getAll()

```javascript
getAll()
```

* 获取所有快捷键

---

## update(oldAccelerator, newAccelerator, handler)

```javascript
update(oldAccelerator, newAccelerator, handler)
```

* 更新快捷键

---

## loadConfig()

```javascript
loadConfig()
```

* 加载配置

---

## saveConfig(config)

```javascript
saveConfig(config)
```

* 保存配置

---

## resetToDefault()

```javascript
resetToDefault()
```

* 重置为默认配置

---

