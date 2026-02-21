# excel-engine

**Source**: `src/main/engines/excel-engine.js`

**Generated**: 2026-02-21T20:04:16.253Z

---

## const

```javascript
const
```

* Excel处理引擎
 * 提供Excel文件的读取、写入、编辑和转换功能

---

## async readExcel(filePath)

```javascript
async readExcel(filePath)
```

* 读取Excel文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 包含工作表数据的对象

---

## async readCSV(filePath)

```javascript
async readCSV(filePath)
```

* 读取CSV文件

---

## async readLargeCSV(filePath)

```javascript
async readLargeCSV(filePath)
```

* 流式读取大CSV文件

---

## async writeExcel(filePath, data)

```javascript
async writeExcel(filePath, data)
```

* 写入Excel文件
   * @param {string} filePath - 文件路径
   * @param {Object} data - 表格数据

---

## async writeCSV(filePath, data)

```javascript
async writeCSV(filePath, data)
```

* 写入CSV文件

---

## async excelToJSON(filePath, options =

```javascript
async excelToJSON(filePath, options =
```

* 转换Excel为JSON

---

## async jsonToExcel(jsonData, filePath, options =

```javascript
async jsonToExcel(jsonData, filePath, options =
```

* 转换JSON为Excel

---

## extractCellStyle(cell)

```javascript
extractCellStyle(cell)
```

* 提取单元格样式

---

## applyCellStyle(cell, style)

```javascript
applyCellStyle(cell, style)
```

* 应用单元格样式

---

## validateExcelData(data)

```javascript
validateExcelData(data)
```

* 数据验证

---

## getSheetStats(sheet)

```javascript
getSheetStats(sheet)
```

* 获取工作表统计信息

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务（用于任务规划系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 执行结果

---

## async generateTableStructureFromDescription(description, llmManager)

```javascript
async generateTableStructureFromDescription(description, llmManager)
```

* 从描述生成Excel表格结构
   * @param {string} description - 表格描述
   * @param {Object} llmManager - LLM管理器
   * @returns {Promise<Object>} 表格结构

---

## normalizeTableStructure(structure, description)

```javascript
normalizeTableStructure(structure, description)
```

* 规范化表格结构

---

## getDefaultTableStructure(description)

```javascript
getDefaultTableStructure(description)
```

* 获取默认表格结构

---

## async queryBackendAI(prompt)

```javascript
async queryBackendAI(prompt)
```

* 查询后端AI服务（降级方案）

---

