# logger

**Source**: `src\renderer\utils\logger.js`

**Generated**: 2026-01-27T06:44:03.897Z

---

## import

```javascript
import
```

* 渲染进程日志管理器
 * 通过IPC发送日志到主进程

---

## log(level, message, data =

```javascript
log(level, message, data =
```

* 写入日志

---

## debug(message, data)

```javascript
debug(message, data)
```

* DEBUG级别日志

---

## info(message, data)

```javascript
info(message, data)
```

* INFO级别日志

---

## warn(message, data)

```javascript
warn(message, data)
```

* WARN级别日志

---

## error(message, data)

```javascript
error(message, data)
```

* ERROR级别日志

---

## fatal(message, data)

```javascript
fatal(message, data)
```

* FATAL级别日志

---

## perfStart(label)

```javascript
perfStart(label)
```

* 性能监控 - 开始

---

## perfEnd(label, data =

```javascript
perfEnd(label, data =
```

* 性能监控 - 结束

---

## child(subModule)

```javascript
child(subModule)
```

* 创建子日志器

---

## setConfig(config)

```javascript
setConfig(config)
```

* 更新配置

---

## captureErrors()

```javascript
captureErrors()
```

* 捕获未处理的错误

---

