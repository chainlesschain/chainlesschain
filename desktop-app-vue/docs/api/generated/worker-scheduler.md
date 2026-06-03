# worker-scheduler

**Source**: `src\renderer\utils\worker-scheduler.js`

**Generated**: 2026-01-27T06:44:03.893Z

---

## export class WorkerPool

```javascript
export class WorkerPool
```

* Web Workers Task Scheduler
 * Web Workers任务调度系统
 *
 * Features:
 * - Worker pool management
 * - Task queue with priority
 * - Load balancing
 * - Task cancellation and timeout
 * - Error handling and retry
 * - Worker health monitoring

---

## export class WorkerPool

```javascript
export class WorkerPool
```

* Worker Pool Manager
 * Worker池管理器

---

## init()

```javascript
init()
```

* Initialize worker pool

---

## createWorker(id)

```javascript
createWorker(id)
```

* Create worker

---

## async execute(data, options =

```javascript
async execute(data, options =
```

* Execute task

---

## enqueueTask(task)

```javascript
enqueueTask(task)
```

* Enqueue task

---

## sortQueue()

```javascript
sortQueue()
```

* Sort queue by priority

---

## processQueue()

```javascript
processQueue()
```

* Process task queue

---

## executeTask(worker, task)

```javascript
executeTask(worker, task)
```

* Execute task on worker

---

## handleWorkerMessage(worker, event)

```javascript
handleWorkerMessage(worker, event)
```

* Handle worker message

---

## handleTaskSuccess(worker, task, result)

```javascript
handleTaskSuccess(worker, task, result)
```

* Handle task success

---

## handleTaskError(worker, task, error)

```javascript
handleTaskError(worker, task, error)
```

* Handle task error

---

## handleTaskTimeout(worker, task)

```javascript
handleTaskTimeout(worker, task)
```

* Handle task timeout

---

## handleWorkerError(worker, error)

```javascript
handleWorkerError(worker, error)
```

* Handle worker error

---

## releaseWorker(worker)

```javascript
releaseWorker(worker)
```

* Release worker

---

## terminate()

```javascript
terminate()
```

* Terminate all workers

---

## getStats()

```javascript
getStats()
```

* Get pool stats

---

## export class TaskScheduler

```javascript
export class TaskScheduler
```

* Task Scheduler
 * 任务调度器

---

## registerPool(name, workerScript, options)

```javascript
registerPool(name, workerScript, options)
```

* Register worker pool

---

## async schedule(poolName, data, options =

```javascript
async schedule(poolName, data, options =
```

* Schedule task

---

## scheduleRecurring(poolName, data, interval, options =

```javascript
scheduleRecurring(poolName, data, interval, options =
```

* Schedule recurring task

---

## cancelRecurring(taskId)

```javascript
cancelRecurring(taskId)
```

* Cancel recurring task

---

## getPool(name)

```javascript
getPool(name)
```

* Get pool

---

## getAllStats()

```javascript
getAllStats()
```

* Get all pool stats

---

## terminate()

```javascript
terminate()
```

* Terminate all pools

---

## export default

```javascript
export default
```

* Export default object

---

