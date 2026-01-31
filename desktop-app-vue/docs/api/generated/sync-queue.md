# sync-queue

**Source**: `src\main\sync\sync-queue.js`

**Generated**: 2026-01-27T06:44:03.803Z

---

## class SyncQueue extends EventEmitter

```javascript
class SyncQueue extends EventEmitter
```

* 异步任务队列
 * 用于控制同步任务的并发执行

---

## enqueue(task, priority = 0)

```javascript
enqueue(task, priority = 0)
```

* 将任务加入队列
   * @param {Function} task - 异步任务函数
   * @param {number} priority - 优先级（数字越大优先级越高）
   * @returns {Promise} 任务结果

---

## async process()

```javascript
async process()
```

* 处理队列中的任务

---

## clear()

```javascript
clear()
```

* 清空队列

---

## get length()

```javascript
get length()
```

* 获取队列长度

---

## get active()

```javascript
get active()
```

* 获取活跃任务数

---

