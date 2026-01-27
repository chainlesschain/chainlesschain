# dragUploadManager

**Source**: `src\renderer\utils\dragUploadManager.js`

**Generated**: 2026-01-27T06:44:03.900Z

---

## import

```javascript
import
```

* 拖拽上传管理器
 * 提供全局拖拽上传功能

---

## class DragUploadManager

```javascript
class DragUploadManager
```

* 拖拽上传管理器

---

## init()

```javascript
init()
```

* 初始化

---

## preventDefaults(e)

```javascript
preventDefaults(e)
```

* 阻止默认行为

---

## handleDragEnter(e)

```javascript
handleDragEnter(e)
```

* 处理拖拽进入

---

## handleDragLeave(e)

```javascript
handleDragLeave(e)
```

* 处理拖拽离开

---

## handleDragOver(e)

```javascript
handleDragOver(e)
```

* 处理拖拽悬停

---

## async handleDrop(e)

```javascript
async handleDrop(e)
```

* 处理文件放下

---

## async handleFiles(files)

```javascript
async handleFiles(files)
```

* 处理文件

---

## validateFile(file)

```javascript
validateFile(file)
```

* 验证文件

---

## onUpload(handler)

```javascript
onUpload(handler)
```

* 注册上传处理器

---

## setAllowedTypes(types)

```javascript
setAllowedTypes(types)
```

* 设置允许的文件类型

---

## setMaxFileSize(size)

```javascript
setMaxFileSize(size)
```

* 设置最大文件大小

---

## destroy()

```javascript
destroy()
```

* 销毁

---

## export function useDragUpload()

```javascript
export function useDragUpload()
```

* 组合式函数：使用拖拽上传

---

