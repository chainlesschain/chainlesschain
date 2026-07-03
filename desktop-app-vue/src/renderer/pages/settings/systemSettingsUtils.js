/**
 * Pure helpers extracted from SystemSettings.vue (opportunistic split).
 * No reactive state — unit-testable in isolation.
 */

// 深度合并配置对象（source 覆盖 target；嵌套 plain object 递归合并，数组整体替换）
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}
