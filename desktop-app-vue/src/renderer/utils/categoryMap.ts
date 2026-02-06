/**
 * 分类名称中英文映射
 * 用于将数据库中的英文category转换为中文显示
 */

// ==================== 类型定义 ====================

/**
 * 职业分类
 */
export type ProfessionalCategory = 'medical' | 'legal' | 'education' | 'research';

/**
 * 通用分类
 */
export type GeneralCategory =
  | 'writing'
  | 'translation'
  | 'analysis'
  | 'qa'
  | 'creative'
  | 'programming'
  | 'rag'
  | 'marketing'
  | 'excel'
  | 'resume'
  | 'ppt'
  | 'lifestyle'
  | 'podcast'
  | 'design'
  | 'web';

/**
 * 其他分类
 */
export type OtherCategory =
  | 'video'
  | 'social-media'
  | 'creative-writing'
  | 'code-project'
  | 'data-science'
  | 'tech-docs'
  | 'ecommerce'
  | 'marketing-pro'
  | 'learning'
  | 'health'
  | 'time-management'
  | 'productivity'
  | 'career'
  | 'travel'
  | 'cooking'
  | 'finance'
  | 'gaming'
  | 'music'
  | 'photography';

/**
 * 特殊分类
 */
export type SpecialCategory = 'all' | 'other' | 'general';

/**
 * 所有分类
 */
export type Category =
  | ProfessionalCategory
  | GeneralCategory
  | OtherCategory
  | SpecialCategory;

/**
 * 分类映射类型
 */
export type CategoryMap = Record<Category, string>;

// ==================== 常量 ====================

/**
 * 职业专用分类列表
 */
const PROFESSIONAL_CATEGORIES: ProfessionalCategory[] = [
  'medical',
  'legal',
  'education',
  'research',
];

/**
 * 分类名称映射
 */
export const categoryMap: CategoryMap = {
  // 职业专用分类
  medical: '🏥 医疗',
  legal: '⚖️ 法律',
  education: '👨‍🏫 教育',
  research: '🔬 研究',

  // 通用分类
  writing: '写作',
  translation: '翻译',
  analysis: '分析',
  qa: '问答',
  creative: '创意',
  programming: '编程',
  rag: '检索增强',
  marketing: '营销',
  excel: 'Excel',
  resume: '简历',
  ppt: 'PPT',
  lifestyle: '生活',
  podcast: '播客',
  design: '设计',
  web: '网页',

  // 其他分类
  video: '视频',
  'social-media': '社交媒体',
  'creative-writing': '创意写作',
  'code-project': '代码项目',
  'data-science': '数据科学',
  'tech-docs': '技术文档',
  ecommerce: '电商',
  'marketing-pro': '营销推广',
  learning: '学习',
  health: '健康',
  'time-management': '时间管理',
  productivity: '效率',
  career: '职业',
  travel: '旅游',
  cooking: '烹饪',
  finance: '财务',
  gaming: '游戏',
  music: '音乐',
  photography: '摄影',

  // 默认
  all: '全部',
  other: '其他',
  general: '通用',
};

// ==================== 工具函数 ====================

/**
 * 获取分类的中文名称
 * @param category - 英文分类名
 * @returns 中文分类名
 */
export function getCategoryName(category: string | null | undefined): string {
  if (!category) {
    return '未分类';
  }
  return categoryMap[category as Category] || category;
}

/**
 * 获取所有分类的映射对象
 * @returns 分类映射对象
 */
export function getAllCategories(): CategoryMap {
  return { ...categoryMap };
}

/**
 * 检查是否为职业专用分类
 * @param category - 分类名
 * @returns 是否为职业专用分类
 */
export function isProfessionalCategory(category: string): boolean {
  return PROFESSIONAL_CATEGORIES.includes(category as ProfessionalCategory);
}
