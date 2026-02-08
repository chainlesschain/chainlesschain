#!/usr/bin/env node

/**
 * 字体优化脚本
 *
 * 替代 Google Fonts，使用系统字体栈
 * 优点：
 * 1. 无需外部请求，速度更快
 * 2. 国内移动网络无法访问 Google Fonts
 * 3. 减少首屏渲染时间
 */

console.log("🔤 字体优化建议");
console.log("================\n");

console.log("📊 当前使用：Google Fonts - Inter 字体");
console.log("   问题：国内移动网络可能被阻断，影响加载速度\n");

console.log("✅ 推荐方案：系统字体栈\n");

const systemFontStack = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`;

console.log("CSS 更新：");
console.log("```css");
console.log("body {");
console.log(`  font-family: ${systemFontStack};`);
console.log("}");
console.log("```\n");

console.log("📈 预期优化效果：");
console.log("   ✓ 移除外部 DNS 请求");
console.log("   ✓ 减少 15-20KB 字体文件下载");
console.log("   ✓ 首屏渲染提速 500-1000ms");
console.log("   ✓ 完美支持中英文混排\n");

console.log("💡 备选方案（如果必须使用 Inter）：");
console.log("   1. 使用 cdnjs.cloudflare.com (国内可访问)");
console.log("   2. 下载字体到本地 fonts/ 目录");
console.log("   3. 使用 font-display: swap 避免阻塞渲染\n");

console.log("🔧 操作步骤：");
console.log("   1. 在 index.html 中删除 Google Fonts 引用");
console.log("   2. 在关键 CSS 中更新 font-family");
console.log("   3. 测试中英文显示效果\n");
