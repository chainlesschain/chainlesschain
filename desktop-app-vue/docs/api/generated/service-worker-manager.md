# service-worker-manager

**Source**: `src\renderer\utils\service-worker-manager.js`

**Generated**: 2026-01-27T06:44:03.894Z

---

## class ServiceWorkerManager

```javascript
class ServiceWorkerManager
```

* Service Worker Manager
 * Handles service worker registration and communication

---

## async register()

```javascript
async register()
```

* Register service worker

---

## async unregister()

```javascript
async unregister()
```

* Unregister service worker

---

## async update()

```javascript
async update()
```

* Update service worker

---

## async skipWaiting()

```javascript
async skipWaiting()
```

* Skip waiting and activate new service worker

---

## async cacheUrls(urls)

```javascript
async cacheUrls(urls)
```

* Cache specific URLs

---

## async clearCache()

```javascript
async clearCache()
```

* Clear all caches

---

## async getCacheSize()

```javascript
async getCacheSize()
```

* Get cache size

---

## async sendMessage(type, payload =

```javascript
async sendMessage(type, payload =
```

* Send message to service worker

---

## handleMessage(data)

```javascript
handleMessage(data)
```

* Handle message from service worker

---

## addListener(callback)

```javascript
addListener(callback)
```

* Add event listener

---

## emit(event, data)

```javascript
emit(event, data)
```

* Emit event to all listeners

---

## checkOnline()

```javascript
checkOnline()
```

* Check if online

---

## getStatus()

```javascript
getStatus()
```

* Get registration status

---

## async prefetchProject(projectId)

```javascript
async prefetchProject(projectId)
```

* Prefetch project data for offline access

---

## async isProjectCached(projectId)

```javascript
async isProjectCached(projectId)
```

* Check if project is available offline

---

