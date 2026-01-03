# 在应用内执行修复（最简单方法）

## 步骤 1: 打开开发者工具

- **Windows/Linux**: `Ctrl + Shift + I`
- **macOS**: `Cmd + Option + I`

## 步骤 2: 在控制台执行修复命令

### 复制粘贴以下代码，然后按回车：

```javascript
// ============================================================
// 一键修复所有项目路径
// ============================================================

(async function() {
  console.log('%c============================================================', 'color: cyan; font-weight: bold');
  console.log('%c批量修复项目路径', 'color: cyan; font-weight: bold');
  console.log('%c============================================================', 'color: cyan; font-weight: bold');
  console.log('');

  try {
    // 执行修复
    console.log('%c正在修复...', 'color: yellow');
    const result = await window.electronAPI.project.repairAllRootPaths();

    console.log('');
    console.log('%c============================================================', 'color: cyan; font-weight: bold');
    console.log('%c✓ 修复完成！', 'color: green; font-weight: bold; font-size: 16px');
    console.log('%c============================================================', 'color: cyan; font-weight: bold');
    console.log('');
    console.log('%c成功: ' + result.fixed + ' 个', 'color: green; font-weight: bold');
    console.log('%c失败: ' + result.failed + ' 个', result.failed > 0 ? 'color: red; font-weight: bold' : 'color: green');
    console.log('');

    if (result.details && result.details.length > 0) {
      console.log('%c详细信息:', 'color: blue; font-weight: bold');
      result.details.forEach((item, index) => {
        const color = item.status === 'fixed' ? 'green' : 'red';
        const icon = item.status === 'fixed' ? '✓' : '✗';
        console.log(`%c  ${icon} [${index + 1}] ${item.name}`, `color: ${color}`);
        if (item.rootPath) {
          console.log(`     路径: ${item.rootPath}`);
        }
        if (item.error) {
          console.log(`     错误: ${item.error}`);
        }
      });
    }

    console.log('');
    console.log('%c下一步:', 'color: yellow; font-weight: bold');
    console.log('  1. 按 F5 刷新页面');
    console.log('  2. 重新打开项目');
    console.log('  3. 检查控制台是否显示: [ProjectDetail] 文件系统监听已启动');
    console.log('');

    return result;

  } catch (error) {
    console.error('%c❌ 修复失败:', 'color: red; font-weight: bold', error);
    console.error('错误详情:', error.message);
    console.log('');
    console.log('%c请尝试重启应用后再试', 'color: yellow');
    return null;
  }
})();
```

## 步骤 3: 刷新页面

修复完成后：
1. 按 **F5** 刷新页面
2. 或者按 **Ctrl/Cmd + R**

## 步骤 4: 验证修复

### 方法 1: 查看日志

重新打开项目，检查控制台应该显示：
```
[Main] 项目根路径: C:\code\chainlesschain\data\projects\{project-id}
[ProjectDetail] 文件系统监听已启动
```

### 方法 2: 检查具体项目

```javascript
// 检查你的项目
const projectId = '0163dd71-5cde-4aea-a061-15d6fc6ec797';  // 替换为你的项目ID
const project = await window.electronAPI.project.get(projectId);
console.log('项目路径:', project.root_path);
// 应该显示: C:\code\chainlesschain\data\projects\0163dd71-5cde-4aea-a061-15d6fc6ec797
```

### 方法 3: 检查文件系统

打开文件管理器，检查目录是否已创建：
```
C:\code\chainlesschain\data\projects\
  ├── 0163dd71-5cde-4aea-a061-15d6fc6ec797\
  ├── b3cbcaab-fd91-49a2-92d0-648db0d45f21\
  └── ...
```

## 如果还有问题

### 修复单个项目

```javascript
// 使用更全面的修复方法
const projectId = '你的项目ID';
const result = await window.electronAPI.project.fixPath(projectId);
console.log('修复结果:', result);
```

### 查看所有项目状态

```javascript
// 获取所有项目
const projects = await window.electronAPI.project.getAll();
console.log('项目列表:');
projects.forEach(p => {
  console.log(`${p.name}: ${p.root_path || '❌ 无路径'}`);
});
```

---

**现在就复制上面的代码到控制台执行吧！** 🚀
