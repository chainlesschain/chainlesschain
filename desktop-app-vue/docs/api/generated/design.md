# design

**Source**: `src\renderer\stores\design.js`

**Generated**: 2026-01-27T06:44:03.892Z

---

## export const useDesignStore = defineStore('design', () =>

```javascript
export const useDesignStore = defineStore('design', () =>
```

* 设计编辑器状态管理 Store

---

## async function loadProject(projectId)

```javascript
async function loadProject(projectId)
```

* 加载设计项目

---

## async function loadArtboard(artboardId)

```javascript
async function loadArtboard(artboardId)
```

* 加载画板

---

## async function createArtboard(name, width = 1920, height = 1080)

```javascript
async function createArtboard(name, width = 1920, height = 1080)
```

* 创建新画板

---

## async function switchArtboard(artboardId)

```javascript
async function switchArtboard(artboardId)
```

* 切换画板

---

## async function saveArtboard(objects)

```javascript
async function saveArtboard(objects)
```

* 保存画板

---

## function setActiveTool(tool)

```javascript
function setActiveTool(tool)
```

* 设置激活工具

---

## function setSelectedObjects(objects)

```javascript
function setSelectedObjects(objects)
```

* 设置选中对象

---

## async function updateObjectProperties(objectId, properties)

```javascript
async function updateObjectProperties(objectId, properties)
```

* 更新对象属性

---

## function setFillColor(color)

```javascript
function setFillColor(color)
```

* 设置填充颜色

---

## function setStrokeColor(color)

```javascript
function setStrokeColor(color)
```

* 设置描边颜色

---

## function setStrokeWidth(width)

```javascript
function setStrokeWidth(width)
```

* 设置描边宽度

---

## async function aiGenerateDesign(prompt)

```javascript
async function aiGenerateDesign(prompt)
```

* AI 生成设计

---

## async function aiOptimizeDesign(objects)

```javascript
async function aiOptimizeDesign(objects)
```

* AI 优化设计

---

## function addToHistory(action)

```javascript
function addToHistory(action)
```

* 添加到历史记录

---

## function undo()

```javascript
function undo()
```

* 撤销

---

## function redo()

```javascript
function redo()
```

* 重做

---

## function clearHistory()

```javascript
function clearHistory()
```

* 清空历史记录

---

## async function exportCode(framework)

```javascript
async function exportCode(framework)
```

* 导出代码

---

## function broadcastChange(change)

```javascript
function broadcastChange(change)
```

* 广播变更（协作同步）

---

## async function createComment(commentData)

```javascript
async function createComment(commentData)
```

* 创建评论

---

## function setZoom(value)

```javascript
function setZoom(value)
```

* 设置缩放

---

## function toggleGrid()

```javascript
function toggleGrid()
```

* 切换网格显示

---

## function copySelection()

```javascript
function copySelection()
```

* 复制选中对象

---

## function pasteFromClipboard()

```javascript
function pasteFromClipboard()
```

* 粘贴对象

---

## function reset()

```javascript
function reset()
```

* 重置状态

---

## function groupTokensByType(tokens)

```javascript
function groupTokensByType(tokens)
```

* 按类型分组 Design Tokens

---

