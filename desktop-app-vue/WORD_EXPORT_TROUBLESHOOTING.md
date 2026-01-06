# Word导出功能故障排查指南

## 问题描述
用户反馈Word导出功能没有生成文件

## 已完成的修复
1. ✅ 添加了返回值检查和错误处理
2. ✅ 添加了详细的调试日志
3. ✅ 验证了Word引擎功能正常（test-word-export.js测试通过）
4. ✅ 验证了IPC通道注册正确

## 测试步骤

### 1. 重启应用
```bash
cd desktop-app-vue
npm run dev
```

### 2. 打开浏览器开发者工具
- 按 F12 或 Ctrl+Shift+I
- 切换到 Console 标签页

### 3. 打开Markdown文件并导出
1. 在应用中打开一个 `.md` 文件
2. 点击编辑器顶部的"导出"下拉菜单
3. 选择"导出Word"
4. 在保存对话框中选择保存位置并确认

### 4. 观察控制台日志
应该看到以下日志序列：

```
[MarkdownEditor] 🔄 开始导出Word...
[MarkdownEditor] 文件名: xxx.md
[MarkdownEditor] 内容长度: xxx 字符
[MarkdownEditor] 📂 打开保存对话框...
[MarkdownEditor] 对话框结果: { canceled: false/true, filePath: '...' }
```

如果 `canceled: true`，说明用户取消了保存对话框。

如果 `canceled: false`，继续看：

```
[MarkdownEditor] ✅ 用户选择路径: /path/to/file.docx
[MarkdownEditor] 📝 调用 markdownToWord IPC...
[MarkdownEditor] IPC返回结果: { success: true/false, ... }
```

### 5. 根据日志定位问题

#### 场景1: 没有任何日志
**原因**: 导出函数没有被调用
**可能的问题**:
- 点击事件没有正确绑定
- 热重载没有生效，需要完全重启应用

#### 场景2: 对话框结果 `canceled: true`
**原因**: 用户点击了取消按钮或关闭了对话框
**解决**: 重新尝试，确保点击"保存"按钮

#### 场景3: IPC返回 `success: false`
**原因**: Word生成失败
**排查**: 查看主进程日志（终端中的输出），会有详细的错误信息

#### 场景4: 在调用IPC后卡住，没有返回结果
**原因**: IPC通信问题
**排查**:
1. 检查主进程是否正常运行
2. 检查是否有JavaScript错误

## 已知的工作环境
- ✅ macOS 21.6.0 (Darwin)
- ✅ Node.js 环境
- ✅ 依赖包已安装：docx@9.5.1, mammoth@1.11.0, marked@14.1.4

## 测试用例验证
运行以下命令验证Word引擎功能：
```bash
cd desktop-app-vue
node test-word-export.js
```

应该在 `test-output/` 目录下生成3个Word文件：
- test-markdown.docx (约8KB)
- test-html.docx (约8KB)
- test-empty.docx (约8KB)

## 主进程日志检查
同时观察终端中的主进程日志，应该看到：
```
[File IPC] Markdown转Word
[WordEngine] Markdown转Word
[WordEngine] 写入Word文档: /path/to/file.docx
```

## 文件生成位置
确认选择的保存路径：
- 必须是有写入权限的目录
- 路径中不能包含非法字符
- 文件名必须以 `.docx` 结尾

## 下一步排查方向
如果上述步骤都正常，但文件还是没有生成：
1. 检查磁盘空间是否充足
2. 检查目标目录是否存在并有写权限
3. 检查是否有杀毒软件拦截文件生成
4. 尝试选择不同的保存目录（如桌面）

## 联系开发者
如果问题依然存在，请提供：
1. 完整的浏览器控制台日志
2. 完整的终端（主进程）日志
3. 操作系统信息
4. 选择的保存路径
