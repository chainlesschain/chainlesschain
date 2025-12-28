# Excel编辑器功能说明

## 📋 功能概述

ChainlessChain现在支持完整的Excel编辑功能，可以直接在应用内编辑、预览和导出Excel文件（.xlsx, .xls, .csv）。

## ✨ 核心特性

### 1. 文件支持
- **Excel格式**: .xlsx, .xls
- **CSV格式**: .csv
- **多工作表**: 支持创建、编辑、删除多个工作表

### 2. 编辑功能
- ✅ 单元格编辑（文本、数字、公式）
- ✅ 行/列插入和删除
- ✅ 单元格格式化（粗体、斜体、对齐）
- ✅ 数据排序（升序/降序）
- ✅ 数据筛选
- ✅ 自动保存（2秒延迟）

### 3. 数据操作
- ✅ 求和计算
- ✅ 平均值计算
- ✅ 选区操作
- ✅ 复制粘贴

### 4. 导出功能
- ✅ 导出为Excel (.xlsx)
- ✅ 导出为CSV (.csv)
- ✅ 导出为JSON (.json)

## 🚀 使用方法

### 安装依赖

首先确保已安装必要的npm包：

```bash
cd desktop-app-vue
npm install exceljs jspreadsheet-ce papaparse
```

### 打开Excel文件

1. 在项目详情页，从左侧文件树选择Excel文件（.xlsx, .xls, .csv）
2. 系统自动识别文件类型并启动Excel编辑器
3. 文件内容加载到交互式表格中

### 基本操作

#### 编辑单元格
- 单击单元格开始编辑
- 输入文本、数字或公式
- 按Enter保存，Esc取消

#### 插入行/列
1. 点击工具栏"插入"按钮
2. 选择"在上方插入行"、"在下方插入行"等
3. 新行/列自动添加

#### 删除行/列
1. 选中要删除的行/列
2. 点击工具栏"删除"按钮
3. 选择"删除选中行"或"删除选中列"

#### 格式化单元格
1. 选中单元格或单元格范围
2. 点击工具栏"格式"按钮
3. 选择格式选项：
   - 粗体
   - 斜体
   - 左对齐/居中/右对齐

#### 数据操作
1. 选中数据范围
2. 点击工具栏"数据"按钮
3. 选择操作：
   - 升序排序
   - 降序排序
   - 筛选
   - 求和
   - 平均值

#### 管理工作表
- **新建工作表**: 点击工作表标签右侧的"+"按钮
- **切换工作表**: 点击工作表标签
- **删除工作表**: 点击工作表标签右侧的"×"按钮（至少保留一个）

### 导出Excel

#### 导出为Excel
1. 点击工具栏"导出" → "导出为Excel"
2. 选择保存位置和文件名
3. 文件保存为.xlsx格式

#### 导出为CSV
1. 点击工具栏"导出" → "导出为CSV"
2. 选择保存位置和文件名
3. 仅导出当前工作表

#### 导出为JSON
1. 点击工具栏"导出" → "导出为JSON"
2. 第一行作为键名
3. 其余行转换为JSON对象数组

### 自动保存

Excel编辑器默认启用自动保存：
- 编辑后2秒自动保存
- 状态栏显示"未保存"或"已保存"
- 离开页面前会提示保存未保存的更改

## 🔧 技术架构

### 后端引擎
**文件**: `desktop-app-vue/src/main/engines/excel-engine.js`

功能：
- Excel文件读写（基于exceljs）
- CSV文件处理（基于papaparse）
- Excel ↔ JSON转换
- 单元格样式提取和应用
- 数据验证

### 前端组件
**文件**: `desktop-app-vue/src/renderer/components/editors/ExcelEditor.vue`

功能：
- 基于jspreadsheet-ce的交互式表格
- 工具栏操作
- 工作表管理
- 实时编辑和保存

### IPC通信
**文件**: `desktop-app-vue/src/main/ipc/file-ipc.js`

API：
- `file:readExcel` - 读取Excel文件
- `file:writeExcel` - 写入Excel文件
- `file:excelToJSON` - Excel转JSON
- `file:jsonToExcel` - JSON转Excel

### 前端API
**文件**: `desktop-app-vue/src/preload/index.js`

暴露的方法：
```javascript
window.electronAPI.file.readExcel(filePath)
window.electronAPI.file.writeExcel(filePath, data)
window.electronAPI.file.excelToJSON(filePath, options)
window.electronAPI.file.jsonToExcel(jsonData, filePath, options)
```

## 📝 数据格式

### Excel数据结构

```javascript
{
  type: 'excel',
  sheets: [
    {
      name: 'Sheet1',
      id: 1,
      rows: [
        {
          rowNumber: 1,
          values: [
            {
              col: 1,
              value: 'Cell Value',
              type: 'string',
              formula: null,
              style: {
                font: { bold: true },
                fill: { /* ... */ },
                alignment: { /* ... */ }
              }
            },
            // ... more cells
          ],
          height: 20
        },
        // ... more rows
      ],
      columns: [
        {
          index: 0,
          header: 'Column A',
          width: 100
        },
        // ... more columns
      ],
      merges: []
    }
  ],
  metadata: {
    creator: 'ChainlessChain',
    created: Date,
    modified: Date
  }
}
```

### CSV数据转换

CSV文件读取时：
- 第一行作为表头
- 自动转换为标准表格格式
- 所有值视为字符串类型

### JSON转换

Excel → JSON:
```javascript
// Excel表格:
// | Name  | Age | City     |
// | Alice | 25  | New York |
// | Bob   | 30  | London   |

// 转换为JSON:
[
  { "Name": "Alice", "Age": 25, "City": "New York" },
  { "Name": "Bob", "Age": 30, "City": "London" }
]
```

## 🐛 已知限制

1. **公式支持**: 当前版本支持基本公式，复杂公式可能需要手动计算
2. **图表**: 暂不支持图表，仅支持表格数据
3. **宏**: 不支持VBA宏
4. **文件大小**: 建议单个文件不超过10MB
5. **并发编辑**: 暂不支持多用户实时协作

## 🔍 故障排查

### Excel文件无法打开

**问题**: 点击Excel文件后无法打开或显示错误

**解决方案**:
1. 检查文件是否损坏
2. 确认文件扩展名是否正确（.xlsx, .xls, .csv）
3. 查看控制台错误信息
4. 尝试使用"导入"功能重新导入文件

### 编辑器加载缓慢

**问题**: Excel编辑器打开很慢

**解决方案**:
1. 检查文件大小（建议 < 10MB）
2. 减少工作表数量
3. 清理浏览器缓存
4. 重启应用

### 保存失败

**问题**: 无法保存Excel文件

**解决方案**:
1. 检查文件权限
2. 确认磁盘空间充足
3. 尝试"另存为"到其他位置
4. 检查文件是否被其他程序占用

### exceljs未安装

**问题**: 提示"ExcelJS库未安装"

**解决方案**:
```bash
cd desktop-app-vue
npm install exceljs
```

## 📚 API参考

### ExcelEngine API

#### readExcel(filePath)
读取Excel文件

```javascript
const data = await excelEngine.readExcel('/path/to/file.xlsx');
```

#### writeExcel(filePath, data)
写入Excel文件

```javascript
await excelEngine.writeExcel('/path/to/output.xlsx', data);
```

#### excelToJSON(filePath, options)
转换Excel为JSON

```javascript
const jsonData = await excelEngine.excelToJSON('/path/to/file.xlsx', {
  sheetIndex: 0  // 工作表索引
});
```

#### jsonToExcel(jsonData, filePath, options)
转换JSON为Excel

```javascript
await excelEngine.jsonToExcel(
  [{ name: 'Alice', age: 25 }],
  '/path/to/output.xlsx',
  { sheetName: 'Users' }
);
```

### ExcelEditor组件API

#### Props
- `file` (Object): 文件对象
- `initialData` (Object): 初始数据
- `readOnly` (Boolean): 只读模式
- `autoSave` (Boolean): 自动保存

#### Events
- `@change`: 数据变化事件
- `@save`: 保存事件

#### Methods
- `save()`: 手动保存
- `getData()`: 获取当前数据

## 🎯 下一步计划

### 短期
- [ ] 支持更多Excel函数（SUM, AVERAGE, IF等）
- [ ] 单元格样式编辑器（颜色选择器）
- [ ] 数据验证规则
- [ ] 条件格式化

### 中期
- [ ] 图表支持
- [ ] 数据透视表
- [ ] 协作编辑（多用户）
- [ ] 版本历史

### 长期
- [ ] 完整的公式引擎
- [ ] 打印预览和导出PDF
- [ ] 模板库
- [ ] AI辅助数据分析

## 💡 最佳实践

1. **定期保存**: 虽然有自动保存，建议重要操作后手动保存
2. **备份数据**: 在大量编辑前先备份原文件
3. **性能优化**: 大文件建议分割为多个小文件
4. **格式一致**: 保持数据格式一致，便于后续处理
5. **使用模板**: 创建常用的Excel模板以提高效率

## 🆘 获取帮助

- **文档**: 查看本README和系统设计文档
- **问题反馈**: 在GitHub Issues中报告bug
- **功能建议**: 在GitHub Discussions中提出

---

**版本**: v1.0.0
**最后更新**: 2025-12-25
**作者**: ChainlessChain Team
