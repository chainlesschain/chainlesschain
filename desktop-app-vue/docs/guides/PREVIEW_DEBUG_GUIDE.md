# Office文件预览调试指南

## 已添加的调试功能

### 1. 前端调试日志（PreviewPanel.vue）

在浏览器开发者工具的Console中，您将看到以下日志：

#### Word文档预览
```
[PreviewPanel] 加载Word文档: { 原始路径, 构建路径, projectId, file对象 }
[PreviewPanel] Word文档解析后路径: <绝对路径>
[PreviewPanel] Word预览结果: { success, data }
[PreviewPanel] Word内容已设置，长度: <HTML长度>
```

#### Excel表格预览
```
[PreviewPanel] 加载Excel表格: { 原始路径, 构建路径, projectId }
[PreviewPanel] Excel解析后路径: <绝对路径>
[PreviewPanel] Excel预览结果: { success, data }
[PreviewPanel] Excel内容已设置，工作表数量: <数量>
```

#### PowerPoint预览
```
[PreviewPanel] 加载PowerPoint: { 原始路径, 构建路径, projectId }
[PreviewPanel] PowerPoint解析后路径: <绝对路径>
[PreviewPanel] PowerPoint预览结果: { success, data }
[PreviewPanel] PowerPoint内容已设置，幻灯片数量: <数量>
```

### 2. 后端调试日志（file-ipc.js）

在Electron主进程的Console中，您将看到以下日志：

#### Word文档
```
[FileIPC] 开始预览Word文档: <文件路径>
[FileIPC] Word文件已读取，大小: <字节数> bytes
[FileIPC] Word预览HTML生成成功，长度: <HTML长度>
```

#### Excel表格
```
[FileIPC] 开始预览Excel表格: <文件路径>
[FileIPC] Excel文件已读取，工作表数量: <数量>
[FileIPC] 工作表 "<工作表名>" 已解析，行数: <行数>
[FileIPC] Excel预览解析完成
```

#### PowerPoint
```
[FileIPC] 开始预览PowerPoint: <文件路径>
[FileIPC] PowerPoint解析结果: <JSON数据>
[FileIPC] PowerPoint预览解析完成，幻灯片数量: <数量>
```

## 调试步骤

### 步骤1: 检查文件生成

1. 生成一个文档（Word/PPT）
2. 检查后端日志，确认文件类型识别是否正确：
   ```
   [DocumentEngine] 生成文档: doc_type=report, format=word
   ```
   或
   ```
   [DocumentEngine] 生成文档: doc_type=report, format=ppt
   ```

### 步骤2: 检查文件存储

在项目创建后，检查文件是否正确存储：

```bash
# Windows
dir C:\code\chainlesschain\data\projects\<project-id>

# 应该看到 .docx 或 .pptx 文件
```

### 步骤3: 检查文件路径解析

在浏览器Console中查看：
```
[PreviewPanel] 加载Word文档: {
  原始路径: "工作报告.docx",
  构建路径: "/data/projects/xxx-xxx/工作报告.docx",
  projectId: "xxx-xxx"
}
[PreviewPanel] Word文档解析后路径: "C:\\code\\chainlesschain\\data\\projects\\xxx-xxx\\工作报告.docx"
```

**关键检查点**：
- 原始路径是否正确
- 构建路径是否包含projectId
- 解析后的绝对路径是否存在

### 步骤4: 检查文件读取

在Electron主进程Console中查看：
```
[FileIPC] 开始预览Word文档: C:\code\chainlesschain\data\projects\xxx\工作报告.docx
[FileIPC] Word文件已读取，大小: 12345 bytes
```

**如果看到错误**：
- `文件不存在` → 文件路径解析有问题
- `Word文件为空` → 文件生成时没有写入内容

### 步骤5: 检查内容解析

在浏览器Console中查看：
```
[PreviewPanel] Word预览结果: {
  success: true,
  data: {
    html: "<div>...</div>"
  }
}
[PreviewPanel] Word内容已设置，长度: 5678
```

**如果内容长度为0或很小**：
- 文档可能只有空内容
- 文档解析失败

## 常见问题排查

### 问题1: 预览显示空白

**症状**：点击预览，但是没有内容显示

**排查步骤**：
1. 打开浏览器开发者工具（F12）
2. 查看Console标签页
3. 查找 `[PreviewPanel]` 开头的日志
4. 检查是否有错误信息

**可能原因**：
- 文件路径错误 → 检查路径解析日志
- 文件为空 → 检查文件大小
- 解析失败 → 查看错误信息

### 问题2: 路径解析失败

**症状**：日志显示"文件不存在"

**排查步骤**：
1. 检查 `原始路径` 和 `构建路径`
2. 检查 `解析后路径` 是否指向正确位置
3. 手动检查该路径文件是否存在

**解决方案**：
```javascript
// 如果路径解析有问题，检查 ProjectDetailPage.vue 中的文件路径设置
const file = {
  file_name: "工作报告.docx",
  file_path: "/data/projects/<project-id>/工作报告.docx"  // 应该是相对路径
}
```

### 问题3: 文件内容为空

**症状**：文件读取成功但内容为空

**排查步骤**：
1. 检查后端日志中的文件大小
2. 手动用Office打开文件检查内容
3. 检查AI生成日志

**可能原因**：
- AI生成失败
- 文件保存时出错
- 后端服务未正确启动

### 问题4: PPT预览失败

**症状**：PPT文件无法预览

**排查步骤**：
1. 检查是否安装了 `pptx2json` 依赖
   ```bash
   cd desktop-app-vue
   npm list pptx2json
   ```

2. 如果未安装，执行：
   ```bash
   npm install pptx2json --save
   ```

3. 重启应用

### 问题5: Word预览失败

**症状**：Word文件无法预览

**排查步骤**：
1. 检查是否安装了 `docx-preview` 和 `jsdom`
   ```bash
   cd desktop-app-vue
   npm list docx-preview jsdom
   ```

2. 如果未安装，执行：
   ```bash
   npm install docx-preview jsdom --save
   ```

3. 重启应用

## 手动测试命令

### 测试文件是否存在
```bash
# PowerShell
Test-Path "C:\code\chainlesschain\data\projects\<project-id>\工作报告.docx"

# 应该返回 True
```

### 测试文件大小
```bash
# PowerShell
(Get-Item "C:\code\chainlesschain\data\projects\<project-id>\工作报告.docx").Length

# 应该大于 0
```

### 手动打开文件
```bash
# PowerShell
Start-Process "C:\code\chainlesschain\data\projects\<project-id>\工作报告.docx"

# 应该用Office打开文件
```

## 需要收集的调试信息

如果问题仍然存在，请提供以下信息：

1. **浏览器Console日志**（F12 → Console）
   - 复制所有 `[PreviewPanel]` 开头的日志

2. **Electron主进程日志**
   - 复制所有 `[FileIPC]` 开头的日志

3. **文件信息**
   ```bash
   # PowerShell
   Get-ChildItem "C:\code\chainlesschain\data\projects\<project-id>" | Format-Table Name, Length, LastWriteTime
   ```

4. **项目配置**
   - projectId
   - 项目类型
   - 文件列表

5. **生成时的用户提示**
   - 例如："做一个工作报告PPT"

## 快速测试脚本

创建一个测试文件来快速验证预览功能：

```javascript
// 在浏览器Console中运行
async function testPreview() {
  // 替换为实际的projectId
  const projectId = 'your-project-id';
  const filePath = `/data/projects/${projectId}/工作报告.docx`;

  console.log('测试文件路径:', filePath);

  try {
    // 1. 解析路径
    const resolved = await window.electronAPI.project.resolvePath(filePath);
    console.log('解析后路径:', resolved);

    // 2. 检查文件是否存在
    const stats = await window.electronAPI.file.stat(resolved);
    console.log('文件信息:', stats);

    // 3. 预览文件
    const result = await window.electronAPI.file.previewOffice(resolved, 'word');
    console.log('预览结果:', result);

    if (result.success && result.data.html) {
      console.log('✓ 预览成功！HTML长度:', result.data.html.length);
    } else {
      console.log('✗ 预览失败:', result.error);
    }
  } catch (error) {
    console.error('✗ 测试失败:', error);
  }
}

testPreview();
```

## 下一步

运行应用并尝试预览一个文件，然后：

1. 打开浏览器开发者工具（F12）
2. 查看Console标签页
3. 找到所有调试日志
4. 如果有错误，根据上述排查步骤解决
5. 如果问题仍然存在，提供完整的日志信息

**重要提示**：每次修改代码后，需要重启应用才能看到效果！
