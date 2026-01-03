# Office文件预览测试清单

## ✅ 测试前准备

- [ ] 应用已启动（npm run dev）
- [ ] 浏览器开发者工具已打开（F12）
- [ ] Console标签页已选中
- [ ] 后端AI服务已启动（如需生成新文档）

## 📝 测试步骤

### 测试1: 生成Word文档并预览

#### 1.1 生成文档
1. 在应用中点击"新建项目"
2. 输入提示：**"写一份本周工作总结Word"**
3. 等待文档生成完成

**期望结果**：
- 后端日志显示：`[DocumentEngine] 生成文档: doc_type=report, format=word`
- 生成的文件扩展名为 `.docx`

#### 1.2 预览文档
1. 在项目列表中找到刚生成的项目
2. 点击进入项目详情
3. 在文件列表中点击 `.docx` 文件

**观察点**：
```
浏览器Console应该显示：
[PreviewPanel] 加载Word文档: { 原始路径, 构建路径, projectId, file对象 }
[PreviewPanel] Word文档解析后路径: C:\code\chainlesschain\data\projects\xxx\工作总结.docx
[PreviewPanel] Word预览结果: { success: true, data: { html: "..." } }
[PreviewPanel] Word内容已设置，长度: 12345
```

**期望结果**：
- [ ] 能看到Word文档内容
- [ ] 格式正确（标题、段落等）
- [ ] 没有错误信息

#### 1.3 检查问题（如果预览失败）
- [ ] 文件路径是否正确？
- [ ] 文件大小是否为0？
- [ ] 是否有错误日志？

---

### 测试2: 生成PPT并预览

#### 2.1 生成PPT
1. 点击"新建项目"
2. 输入提示：**"做一个项目汇报PPT"** 或 **"生成一份演示文稿"**
3. 等待生成完成

**期望结果**：
- 后端日志显示：`[DocumentEngine] 生成文档: doc_type=report, format=ppt`
- 生成的文件扩展名为 `.pptx`

#### 2.2 预览PPT
1. 进入项目详情
2. 点击 `.pptx` 文件

**观察点**：
```
浏览器Console应该显示：
[PreviewPanel] 加载PowerPoint: { 原始路径, 构建路径, projectId }
[PreviewPanel] PowerPoint解析后路径: C:\code\chainlesschain\data\projects\xxx\项目汇报.pptx
[PreviewPanel] PowerPoint预览结果: { success: true, data: { slides: [...] } }
[PreviewPanel] PowerPoint内容已设置，幻灯片数量: 5
```

**期望结果**：
- [ ] 能看到幻灯片内容
- [ ] 可以切换幻灯片
- [ ] 内容显示正确

---

### 测试3: 使用调试工具

#### 3.1 打开调试工具
在浏览器中打开：
```
file:///C:/code/chainlesschain/desktop-app-vue/debug-preview.html
```

#### 3.2 获取项目信息
1. 从应用中复制一个项目的ID
   - 方法：打开项目详情，URL中的ID部分
   - 例如：`/projects/abc123-def456`，ID就是 `abc123-def456`
2. 复制文件名（例如：`工作总结.docx`）

#### 3.3 按步骤测试
1. **步骤1**: 输入项目ID和文件名
2. **步骤2**: 点击"测试路径解析"
   - [ ] 是否显示绿色"成功"状态？
   - [ ] 绝对路径是否正确？
3. **步骤3**: 点击"检查文件"
   - [ ] 文件是否存在？
4. **步骤4**: 点击"获取文件信息"
   - [ ] 文件大小是否大于0？
   - [ ] 如果为0，说明文件生成有问题
5. **步骤5**: 点击对应的预览按钮
   - [ ] 预览是否成功？
   - [ ] 内容是否正确？

---

## 🐛 常见问题自查

### 问题1: 预览显示空白

**自查步骤**：
1. [ ] 打开浏览器Console（F12）
2. [ ] 查找红色错误信息
3. [ ] 搜索 `[PreviewPanel]` 查看日志
4. [ ] 检查路径是否正确

**可能原因**：
- 文件路径解析错误
- 文件不存在
- 文件为空
- 预览库未安装

### 问题2: 文件类型不对

**症状**：要求生成PPT，但生成的是Word

**自查步骤**：
1. [ ] 检查输入的提示是否包含"PPT"、"演示"、"幻灯片"等关键词
2. [ ] 查看后端日志确认 `format=` 的值
3. [ ] 检查意图识别结果

**提示词示例**：
- ✅ "做一个项目汇报PPT"
- ✅ "生成工作总结演示文稿"
- ✅ "准备一份产品介绍幻灯片"
- ❌ "做一个项目汇报" （没有明确格式，默认Word）

### 问题3: 文件为空

**症状**：文件存在但大小为0或预览无内容

**自查步骤**：
1. [ ] 检查后端AI服务是否正常运行
2. [ ] 查看AI服务日志是否有错误
3. [ ] 手动用Office打开文件确认

**常见原因**：
- AI服务未启动
- LLM生成失败
- 文件保存出错

### 问题4: 依赖未安装

**症状**：预览时报错"Cannot find module 'xxx'"

**解决方案**：
```bash
cd desktop-app-vue

# 安装所有Office预览依赖
npm install docx-preview jsdom xlsx pptx2json --save

# 重启应用
npm run dev
```

---

## 📊 测试结果记录

### Word预览测试
- [ ] 测试通过
- [ ] 测试失败 - 错误信息：_______________

### PPT预览测试
- [ ] 测试通过
- [ ] 测试失败 - 错误信息：_______________

### Excel预览测试（可选）
- [ ] 测试通过
- [ ] 测试失败 - 错误信息：_______________

---

## 📝 需要提供的调试信息（如果测试失败）

### 1. 浏览器Console日志
```
// 复制所有 [PreviewPanel] 开头的日志
粘贴在这里...
```

### 2. Electron主进程日志
```
// 从终端复制 [FileIPC] 开头的日志
粘贴在这里...
```

### 3. 文件信息
```bash
# 在PowerShell中运行并复制结果
Get-ChildItem "C:\code\chainlesschain\data\projects\<project-id>" | Format-Table Name, Length, LastWriteTime
```

### 4. 项目信息
- 项目ID: _______________
- 文件名: _______________
- 生成时的提示: _______________
- 期望格式: _______________
- 实际格式: _______________

---

## 🎯 快速验证脚本

在浏览器Console中运行以下脚本快速测试：

```javascript
// 替换为实际的projectId和fileName
const projectId = 'your-project-id';
const fileName = '工作总结.docx';

async function quickTest() {
  console.log('=== 快速预览测试 ===');

  const filePath = `/data/projects/${projectId}/${fileName}`;
  console.log('1. 测试文件路径:', filePath);

  try {
    // 解析路径
    const resolved = await window.electronAPI.project.resolvePath(filePath);
    console.log('2. 解析后路径:', resolved);

    // 检查文件
    const stats = await window.electronAPI.file.stat(resolved);
    console.log('3. 文件信息:', stats);

    if (stats.success && stats.stats.size > 0) {
      console.log('✓ 文件存在且不为空，大小:', stats.stats.size, 'bytes');

      // 预览文件
      const ext = fileName.split('.').pop().toLowerCase();
      let format = 'word';
      if (ext === 'xlsx' || ext === 'xls') format = 'excel';
      if (ext === 'pptx' || ext === 'ppt') format = 'powerpoint';

      console.log('4. 尝试预览，格式:', format);
      const result = await window.electronAPI.file.previewOffice(resolved, format);

      if (result.success) {
        console.log('✓ 预览成功！');
        console.log('5. 预览数据:', result.data);
      } else {
        console.error('✗ 预览失败:', result.error);
      }
    } else {
      console.error('✗ 文件不存在或为空');
    }
  } catch (error) {
    console.error('✗ 测试失败:', error);
  }
}

quickTest();
```

---

## ✨ 测试成功标准

- [x] Word文档能正常预览，显示格式化内容
- [x] PPT能正常预览，显示幻灯片
- [x] 文件类型识别正确（要求PPT就生成PPT）
- [x] 预览速度可接受（<3秒）
- [x] 无Console错误
- [x] 无内存泄漏

---

**测试日期**: _______________
**测试人**: _______________
**测试环境**: Windows / macOS / Linux
**应用版本**: _______________
