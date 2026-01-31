# memory-optimization

**Source**: `src\renderer\utils\memory-optimization.js`

**Generated**: 2026-01-27T06:44:03.897Z

---

## export class ObjectPool

```javascript
export class ObjectPool
```

* Object Pool and Memory Optimization Utilities
 * 对象池和内存优化工具
 *
 * Features:
 * - Object pooling for frequent allocations
 * - Memory leak detection
 * - Automatic garbage collection hints
 * - Weak reference management
 * - Memory usage tracking

---

## export class ObjectPool

```javascript
export class ObjectPool
```

* Generic Object Pool
 * 通用对象池
 *
 * Reuse objects instead of creating new ones to reduce GC pressure

---

## acquire()

```javascript
acquire()
```

* Acquire object from pool

---

## release(obj)

```javascript
release(obj)
```

* Release object back to pool

---

## getStats()

```javascript
getStats()
```

* Get pool stats

---

## clear()

```javascript
clear()
```

* Clear pool

---

## drain()

```javascript
drain()
```

* Drain pool (remove all available objects)

---

## export class MemoryLeakDetector

```javascript
export class MemoryLeakDetector
```

* Memory Leak Detector
 * 内存泄漏检测器

---

## start()

```javascript
start()
```

* Start monitoring

---

## stop()

```javascript
stop()
```

* Stop monitoring

---

## checkMemory()

```javascript
checkMemory()
```

* Check memory usage

---

## analyzeTrend()

```javascript
analyzeTrend()
```

* Analyze memory trend

---

## onLeak(callback)

```javascript
onLeak(callback)
```

* Add leak listener

---

## getStats()

```javascript
getStats()
```

* Get current memory stats

---

## export class WeakReferenceManager

```javascript
export class WeakReferenceManager
```

* Weak Reference Manager
 * 弱引用管理器
 *
 * Use WeakMap and WeakSet for automatic garbage collection

---

## getWeakMap(name)

```javascript
getWeakMap(name)
```

* Create or get weak map

---

## getWeakSet(name)

```javascript
getWeakSet(name)
```

* Create or get weak set

---

## clear()

```javascript
clear()
```

* Clear all weak references

---

## export class MemoryOptimizer

```javascript
export class MemoryOptimizer
```

* Memory Optimizer
 * 内存优化器
 *
 * Provides hints to garbage collector

---

## static requestGC()

```javascript
static requestGC()
```

* Request garbage collection (if available)

---

## static clearObject(obj)

```javascript
static clearObject(obj)
```

* Clear large objects

---

## static nullifyRefs(...refs)

```javascript
static nullifyRefs(...refs)
```

* Nullify references to help GC

---

## static getMemoryUsage()

```javascript
static getMemoryUsage()
```

* Get memory usage

---

## export const domElementPool = new ObjectPool(

```javascript
export const domElementPool = new ObjectPool(
```

* Create common object pools

---

## export default

```javascript
export default
```

* Export default object

---

