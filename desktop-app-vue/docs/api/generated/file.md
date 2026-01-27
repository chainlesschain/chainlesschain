# file

**Source**: `src\renderer\stores\file.js`

**Generated**: 2026-01-27T06:44:03.892Z

---

## export const useFileStore = defineStore('file', () =>

```javascript
export const useFileStore = defineStore('file', () =>
```

* 文件管理Store - Phase 2
 * 负责文件上传、下载、共享、版本控制等功能

---

## const filesByType = computed(() =>

```javascript
const filesByType = computed(() =>
```

* 按类型分组的文件

---

## const lockedFiles = computed(() =>

```javascript
const lockedFiles = computed(() =>
```

* 锁定的文件

---

## const myLockedFiles = computed(() =>

```javascript
const myLockedFiles = computed(() =>
```

* 我锁定的文件

---

## const fileStats = computed(() =>

```javascript
const fileStats = computed(() =>
```

* 文件统计

---

## async function loadFiles(queryFilters =

```javascript
async function loadFiles(queryFilters =
```

* 加载文件列表

---

## async function uploadFile(fileData)

```javascript
async function uploadFile(fileData)
```

* 上传文件

---

## async function deleteFile(fileId)

```javascript
async function deleteFile(fileId)
```

* 删除文件

---

## async function lockFile(fileId, expiresIn = 3600000)

```javascript
async function lockFile(fileId, expiresIn = 3600000)
```

* 锁定文件

---

## async function unlockFile(fileId)

```javascript
async function unlockFile(fileId)
```

* 解锁文件

---

## async function loadFileVersions(fileId)

```javascript
async function loadFileVersions(fileId)
```

* 加载文件版本列表

---

## async function rollbackToVersion(fileId, targetVersion)

```javascript
async function rollbackToVersion(fileId, targetVersion)
```

* 回滚到指定版本

---

## async function shareFile(shareData)

```javascript
async function shareFile(shareData)
```

* 共享文件

---

## async function loadSharedFiles(orgId)

```javascript
async function loadSharedFiles(orgId)
```

* 加载共享文件列表

---

## async function openFileDetail(fileId)

```javascript
async function openFileDetail(fileId)
```

* 打开文件详情

---

## function closeFileDetail()

```javascript
function closeFileDetail()
```

* 关闭文件详情

---

## function updateFilters(newFilters)

```javascript
function updateFilters(newFilters)
```

* 更新筛选条件

---

## function clearFilters()

```javascript
function clearFilters()
```

* 清除筛选条件

---

## function reset()

```javascript
function reset()
```

* 重置Store

---

