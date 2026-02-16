# database-performance-wrapper

**Source**: `src/main/performance/database-performance-wrapper.js`

**Generated**: 2026-02-16T22:06:51.453Z

---

## class DatabasePerformanceWrapper

```javascript
class DatabasePerformanceWrapper
```

* 数据库性能包装器
 * 自动跟踪所有数据库查询的性能

---

## async query(sql, params = [])

```javascript
async query(sql, params = [])
```

* 包装查询方法

---

## async execute(sql, params = [])

```javascript
async execute(sql, params = [])
```

* 包装执行方法

---

## async run(sql, params = [])

```javascript
async run(sql, params = [])
```

* 包装run方法

---

## async get(sql, params = [])

```javascript
async get(sql, params = [])
```

* 包装get方法

---

## async all(sql, params = [])

```javascript
async all(sql, params = [])
```

* 包装all方法

---

## _proxyMethod(methodName)

```javascript
_proxyMethod(methodName)
```

* 代理其他方法到原始数据库对象

---

## function wrapDatabaseWithPerformanceMonitoring(database)

```javascript
function wrapDatabaseWithPerformanceMonitoring(database)
```

* 创建数据库性能包装器

---

