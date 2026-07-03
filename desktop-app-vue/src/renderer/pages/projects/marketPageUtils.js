/**
 * Pure helpers extracted from MarketPage.vue (opportunistic split).
 *
 * Category display mappings, deterministic avatar-color hashing, and the
 * default seed data shown when the marketplace backend returns nothing.
 * Kept free of reactive state so they are unit-testable in isolation.
 */

// 分类颜色
export function getCategoryColor(category) {
  const colorMap = {
    web: "blue",
    document: "green",
    data: "orange",
    app: "purple",
    other: "default",
  };
  return colorMap[category] || "default";
}

// 分类名称
export function getCategoryName(category) {
  const nameMap = {
    web: "Web开发",
    document: "文档模板",
    data: "数据分析",
    app: "应用开发",
    other: "其他",
  };
  return nameMap[category] || category;
}

// 头像颜色（对 DID 做稳定哈希 → 固定调色板，空 DID 回退首色）
export function getAvatarColor(did) {
  const colors = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae", "#87d068"];
  const hash =
    did?.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  return colors[hash % colors.length];
}

// 默认示例数据（后端无数据时展示）
export function getDefaultMarketProjects() {
  return [
    {
      id: "market-1",
      name: "React电商后台管理系统",
      description:
        "完整的电商后台管理系统，包含商品管理、订单管理、用户管理等功能",
      category: "web",
      price: 299,
      thumbnail: "",
      seller: { did: "did:chainless:seller1", name: "前端大师", rating: 4.8 },
      views: 1250,
      sales: 86,
      rating: 4.7,
      featured: true,
      listedAt: Date.now() - 86400000,
    },
    {
      id: "market-2",
      name: "Vue3企业级项目模板",
      description:
        "Vue3 + TypeScript + Vite企业级项目模板，包含完整的工程化配置",
      category: "web",
      price: 199,
      thumbnail: "",
      seller: { did: "did:chainless:seller2", name: "Vue开发者", rating: 4.9 },
      views: 980,
      sales: 124,
      rating: 4.9,
      featured: false,
      listedAt: Date.now() - 172800000,
    },
    {
      id: "market-3",
      name: "Python数据分析工具包",
      description: "包含数据清洗、可视化、机器学习等常用工具的Python包",
      category: "data",
      price: 399,
      thumbnail: "",
      seller: { did: "did:chainless:seller3", name: "数据科学家", rating: 5.0 },
      views: 756,
      sales: 45,
      rating: 5.0,
      featured: true,
      listedAt: Date.now() - 259200000,
    },
    {
      id: "market-4",
      name: "技术文档Markdown模板",
      description: "专业的技术文档模板，适用于API文档、技术方案等",
      category: "document",
      price: 49,
      thumbnail: "",
      seller: { did: "did:chainless:seller4", name: "文档专家", rating: 4.6 },
      views: 2100,
      sales: 312,
      rating: 4.5,
      featured: false,
      listedAt: Date.now() - 345600000,
    },
  ];
}
