/**
 * 批量修复所有缺失root_path的document项目
 *
 * 这个脚本会：
 * 1. 扫描数据库中所有document类型的项目
 * 2. 找出缺失root_path的项目
 * 3. 为每个项目创建目录并设置root_path
 *
 * 使用方法：
 * 在开发者工具控制台中运行：
 * await window.electronAPI.project.repairAllRootPaths()
 */

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        批量修复项目 root_path 工具                         ║
║                                                            ║
║  这个工具会自动修复所有缺失 root_path 的 document 项目    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

使用步骤：
1. 打开 ChainlessChain 应用
2. 按 F12 打开开发者工具
3. 在 Console 标签页中粘贴以下命令：

   await window.electronAPI.project.repairAllRootPaths()

4. 查看修复结果

命令执行后会返回类似以下的结果：
{
  success: true,
  message: "修复完成：成功 5 个，失败 0 个",
  fixed: 5,
  failed: 0,
  details: [
    { id: "xxx", name: "项目1", status: "fixed", rootPath: "C:\\..." },
    { id: "yyy", name: "项目2", status: "fixed", rootPath: "C:\\..." },
    ...
  ]
}

如果某些项目修复失败，details 中会包含错误信息。
`);
