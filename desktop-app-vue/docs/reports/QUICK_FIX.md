# 🚀 快速修复项目路径 - 30秒搞定！

## ✅ Bug已修复
- 修复了 6 处 `await updateProject` 的错误用法
- 增强了 `updateProject` 方法支持 `root_path` 字段
- 代码已编译并就绪

---

## 📝 立即执行（3步）

### 第1步：重启应用
关闭应用并重新启动，以加载最新编译的代码。

### 第2步：打开控制台
按 **`Ctrl + Shift + I`** (Windows) 或 **`Cmd + Option + I`** (Mac)

### 第3步：复制执行以下代码

```javascript
// 一键修复所有项目
(async function() {
  console.log('%c🔧 开始修复...', 'color: cyan; font-size: 14px; font-weight: bold');

  const result = await window.electronAPI.project.repairAllRootPaths();

  console.log('%c✅ 修复完成！', 'color: green; font-size: 16px; font-weight: bold');
  console.log(`成功: ${result.fixed} 个 | 失败: ${result.failed} 个`);

  result.details?.forEach((item, i) => {
    console.log(`${item.status === 'fixed' ? '✓' : '✗'} ${item.name}`);
  });

  console.log('\n%c按 F5 刷新页面', 'color: yellow; font-weight: bold');
  return result;
})();
```

### 第4步：刷新页面
修复完成后按 **`F5`**

---

## 🎯 验证修复

刷新后执行：

```javascript
// 检查你的项目（替换为实际项目ID）
const project = await window.electronAPI.project.get('0163dd71-5cde-4aea-a061-15d6fc6ec797');
console.log('✓ 项目路径:', project.root_path);
```

**预期输出**:
```
✓ 项目路径: C:\code\chainlesschain\data\projects\0163dd71-5cde-4aea-a061-15d6fc6ec797
```

重新打开项目，控制台应显示：
```
[Main] 项目根路径: C:\code\chainlesschain\data\projects\...
[ProjectDetail] 文件系统监听已启动 ✅
```

---

## 📚 详细文档

- **`BUGS_FIXED.md`** - 完整的Bug修复报告
- **`FIX_IN_APP.md`** - 详细修复步骤
- **`docs/FIX_PROJECT_PATHS.md`** - 故障排查指南

---

## 💡 单个项目修复

如果批量修复失败，可以修复单个项目：

```javascript
const result = await window.electronAPI.project.fixPath('your-project-id');
console.log(result);
```

---

**总耗时**: 30秒
**状态**: ✅ 就绪
**下一步**: 立即执行！
