/**
 * LLM 性能页面测试数据生成脚本
 *
 * 使用方法:
 * 1. 重启应用（如果刚更新了代码）
 * 2. 打开 DevTools (Ctrl+Shift+I 或 F12)
 * 3. 在控制台中粘贴并执行以下代码
 */

// ============================================
// 复制以下代码到 DevTools 控制台执行:
// ============================================

// 生成 30 天的测试数据，每天约 50 条，清除现有数据
window.electronAPI
  .invoke("llm:generate-test-data", {
    days: 30,
    recordsPerDay: 50,
    clear: true,
  })
  .then((result) => {
    console.log("测试数据生成完成！");
    console.log(`总记录数: ${result.totalRecords}`);
    console.log(`总 Token 数: ${result.totalTokens.toLocaleString()}`);
    console.log(`总成本 (USD): $${result.totalCostUsd.toFixed(4)}`);
    console.log(`总成本 (CNY): ¥${result.totalCostCny.toFixed(4)}`);
    console.log("\n现在导航到 LLM 性能页面查看数据！");
  })
  .catch((err) => {
    console.error("生成测试数据失败:", err);
  });

// ============================================
// 或者使用简化版本:
// ============================================

// 快速生成（使用默认参数）
// await window.electronAPI.invoke('llm:generate-test-data', { clear: true });

// 生成更多数据（60天，每天100条）
// await window.electronAPI.invoke('llm:generate-test-data', { days: 60, recordsPerDay: 100, clear: true });

// 追加数据（不清除现有数据）
// await window.electronAPI.invoke('llm:generate-test-data', { days: 7, recordsPerDay: 30, clear: false });
