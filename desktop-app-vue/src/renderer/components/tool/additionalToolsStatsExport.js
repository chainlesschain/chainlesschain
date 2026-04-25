/**
 * Pure builders + download helper for the Additional Tools V3 stats
 * dashboard. Extracted from AdditionalToolsStats.vue's <script setup>
 * — these are deterministic data → string transforms with no Vue
 * reactivity, so they live cleanly outside the SFC.
 */

const FILTER_LABEL = (hasActive, count) => (hasActive ? `${count}个` : "无");

export function buildCsvReport(stats) {
  const {
    overview,
    rankings,
    categoryStats,
    dailyStats,
    hasActiveFilters,
    activeFilterCount,
  } = stats;
  let csv = "";

  csv += "=== Additional Tools V3 统计报告 ===\n";
  csv += `生成时间:,${new Date().toLocaleString()}\n`;
  csv += `筛选条件:,${FILTER_LABEL(hasActiveFilters, activeFilterCount)}\n\n`;

  csv += "--- 概览统计 ---\n";
  csv += "指标,数值\n";
  csv += `总工具数,${overview.totalTools}\n`;
  csv += `已启用,${overview.enabledTools}\n`;
  csv += `总调用次数,${overview.totalInvocations}\n`;
  csv += `成功率,${overview.successRate}\n`;
  csv += `平均响应时间,${overview.avgExecutionTime}ms\n\n`;

  csv += "--- 使用次数排行 Top 10 ---\n";
  csv += "排名,工具名称,调用次数,成功次数,平均响应时间\n";
  rankings.mostUsed.slice(0, 10).forEach((tool, index) => {
    csv += `${index + 1},${tool.display_name || tool.name},${tool.usage_count},${tool.success_count},${tool.avg_execution_time}ms\n`;
  });
  csv += "\n";

  csv += "--- 成功率排行 Top 10 ---\n";
  csv += "排名,工具名称,调用次数,成功率\n";
  rankings.highestSuccessRate.slice(0, 10).forEach((tool, index) => {
    csv += `${index + 1},${tool.display_name || tool.name},${tool.usage_count},${tool.success_rate}%\n`;
  });
  csv += "\n";

  csv += "--- 分类统计 ---\n";
  csv += "分类,工具数,使用次数,成功率,平均响应时间\n";
  categoryStats.forEach((cat) => {
    csv += `${cat.category},${cat.toolCount},${cat.totalUsage},${cat.successRate}%,${cat.avgTime}ms\n`;
  });
  csv += "\n";

  csv += "--- 最近7天统计 ---\n";
  csv += "日期,调用次数,成功次数,失败次数,成功率\n";
  dailyStats.forEach((stat) => {
    csv += `${stat.date},${stat.invokes},${stat.success},${stat.failure},${stat.successRate}%\n`;
  });

  return csv;
}

export function buildExcelReport(stats) {
  const {
    overview,
    rankings,
    categoryStats,
    hasActiveFilters,
    activeFilterCount,
  } = stats;
  let html = '<html><head><meta charset="utf-8"></head><body>';
  html += "<h1>Additional Tools V3 统计报告</h1>";
  html += `<p>生成时间: ${new Date().toLocaleString()}</p>`;
  html += `<p>筛选条件: ${FILTER_LABEL(hasActiveFilters, activeFilterCount)}</p><br/>`;

  html += "<h2>概览统计</h2>";
  html += '<table border="1" cellpadding="5" cellspacing="0">';
  html += "<tr><th>指标</th><th>数值</th></tr>";
  html += `<tr><td>总工具数</td><td>${overview.totalTools}</td></tr>`;
  html += `<tr><td>已启用</td><td>${overview.enabledTools}</td></tr>`;
  html += `<tr><td>总调用次数</td><td>${overview.totalInvocations}</td></tr>`;
  html += `<tr><td>成功率</td><td>${overview.successRate}</td></tr>`;
  html += `<tr><td>平均响应时间</td><td>${overview.avgExecutionTime}ms</td></tr>`;
  html += "</table><br/>";

  html += "<h2>使用次数排行 Top 10</h2>";
  html += '<table border="1" cellpadding="5" cellspacing="0">';
  html +=
    "<tr><th>排名</th><th>工具名称</th><th>调用次数</th><th>成功次数</th><th>平均响应时间</th></tr>";
  rankings.mostUsed.slice(0, 10).forEach((tool, index) => {
    html += `<tr><td>${index + 1}</td><td>${tool.display_name || tool.name}</td><td>${tool.usage_count}</td><td>${tool.success_count}</td><td>${tool.avg_execution_time}ms</td></tr>`;
  });
  html += "</table><br/>";

  html += "<h2>分类统计</h2>";
  html += '<table border="1" cellpadding="5" cellspacing="0">';
  html +=
    "<tr><th>分类</th><th>工具数</th><th>使用次数</th><th>成功率</th><th>平均响应时间</th></tr>";
  categoryStats.forEach((cat) => {
    html += `<tr><td>${cat.category}</td><td>${cat.toolCount}</td><td>${cat.totalUsage}</td><td>${cat.successRate}%</td><td>${cat.avgTime}ms</td></tr>`;
  });
  html += "</table><br/>";

  html += "</body></html>";
  return html;
}

export function buildPdfReport(stats) {
  const {
    overview,
    rankings,
    categoryStats,
    hasActiveFilters,
    activeFilterCount,
  } = stats;
  let text = "=".repeat(60) + "\n";
  text += "  Additional Tools V3 统计报告\n";
  text += "=".repeat(60) + "\n\n";
  text += `生成时间: ${new Date().toLocaleString()}\n`;
  text += `筛选条件: ${FILTER_LABEL(hasActiveFilters, activeFilterCount)}\n\n`;

  text += "-".repeat(60) + "\n";
  text += "概览统计\n";
  text += "-".repeat(60) + "\n";
  text += `总工具数:       ${overview.totalTools}\n`;
  text += `已启用:         ${overview.enabledTools}\n`;
  text += `总调用次数:     ${overview.totalInvocations}\n`;
  text += `成功率:         ${overview.successRate}\n`;
  text += `平均响应时间:   ${overview.avgExecutionTime}ms\n\n`;

  text += "-".repeat(60) + "\n";
  text += "使用次数排行 Top 10\n";
  text += "-".repeat(60) + "\n";
  rankings.mostUsed.slice(0, 10).forEach((tool, index) => {
    text += `${(index + 1).toString().padStart(2)}. ${(tool.display_name || tool.name).padEnd(30)} ${tool.usage_count}次\n`;
  });
  text += "\n";

  text += "-".repeat(60) + "\n";
  text += "分类统计\n";
  text += "-".repeat(60) + "\n";
  categoryStats.forEach((cat) => {
    text += `${cat.category.padEnd(15)} 工具数:${cat.toolCount} 使用:${cat.totalUsage}次 成功率:${cat.successRate}%\n`;
  });
  text += "\n";

  text += "=".repeat(60) + "\n";
  text += "报告结束\n";
  text += "=".repeat(60) + "\n";

  return text;
}

export function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
