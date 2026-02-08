/**
 * 可验证凭证模板管理器
 *
 * 提供预定义的凭证模板，简化凭证创建流程
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

/**
 * 内置模板
 */
const BUILT_IN_TEMPLATES = {
  // JavaScript 技能证书
  "javascript-skill": {
    id: "built-in:javascript-skill",
    name: "JavaScript 技能证书",
    type: "SkillCertificate",
    description: "用于证明 JavaScript 编程能力",
    icon: "🔧",
    fields: [
      {
        key: "skill",
        label: "技能名称",
        type: "text",
        required: true,
        defaultValue: "JavaScript",
        placeholder: "例如: JavaScript",
      },
      {
        key: "level",
        label: "熟练程度",
        type: "select",
        required: true,
        options: ["Beginner", "Intermediate", "Advanced", "Expert"],
        defaultValue: "Intermediate",
      },
      {
        key: "yearsOfExperience",
        label: "工作年限",
        type: "number",
        required: true,
        defaultValue: 2,
        min: 0,
        max: 50,
      },
      {
        key: "certifications",
        label: "相关认证",
        type: "text",
        required: false,
        placeholder: "例如: AWS Certified Developer",
      },
    ],
    isBuiltIn: true,
  },

  // 教育凭证
  "education-degree": {
    id: "built-in:education-degree",
    name: "学历证书",
    type: "EducationCredential",
    description: "用于证明教育背景和学历",
    icon: "🎓",
    fields: [
      {
        key: "degree",
        label: "学位",
        type: "select",
        required: true,
        options: ["高中", "专科", "本科", "硕士", "博士"],
        defaultValue: "本科",
      },
      {
        key: "major",
        label: "专业",
        type: "text",
        required: true,
        placeholder: "例如: 计算机科学",
      },
      {
        key: "institution",
        label: "学校",
        type: "text",
        required: true,
        placeholder: "例如: 清华大学",
      },
      {
        key: "graduationYear",
        label: "毕业年份",
        type: "number",
        required: true,
        min: 1950,
        max: new Date().getFullYear() + 10,
      },
      {
        key: "gpa",
        label: "GPA",
        type: "text",
        required: false,
        placeholder: "例如: 3.8/4.0",
      },
    ],
    isBuiltIn: true,
  },

  // 工作经历
  "work-experience": {
    id: "built-in:work-experience",
    name: "工作经历",
    type: "WorkExperience",
    description: "用于证明工作经验和职位",
    icon: "💼",
    fields: [
      {
        key: "position",
        label: "职位",
        type: "text",
        required: true,
        placeholder: "例如: 高级软件工程师",
      },
      {
        key: "company",
        label: "公司",
        type: "text",
        required: true,
        placeholder: "例如: 科技公司",
      },
      {
        key: "startDate",
        label: "开始时间",
        type: "month",
        required: true,
        placeholder: "例如: 2020-01",
      },
      {
        key: "endDate",
        label: "结束时间",
        type: "month",
        required: false,
        placeholder: "留空表示至今",
      },
      {
        key: "responsibilities",
        label: "工作职责",
        type: "textarea",
        required: true,
        placeholder: "描述主要工作内容和职责",
      },
      {
        key: "achievements",
        label: "主要成就",
        type: "textarea",
        required: false,
        placeholder: "列出重要的项目成果",
      },
    ],
    isBuiltIn: true,
  },

  // 信任背书
  "trust-endorsement": {
    id: "built-in:trust-endorsement",
    name: "信任背书",
    type: "TrustEndorsement",
    description: "为他人提供信任评价和推荐",
    icon: "🤝",
    fields: [
      {
        key: "trustLevel",
        label: "信任级别",
        type: "select",
        required: true,
        options: ["Low", "Medium", "High", "Very High"],
        defaultValue: "High",
      },
      {
        key: "relationship",
        label: "关系",
        type: "select",
        required: true,
        options: ["同事", "朋友", "合作伙伴", "客户", "导师", "学生"],
        defaultValue: "同事",
      },
      {
        key: "endorsement",
        label: "背书内容",
        type: "textarea",
        required: true,
        placeholder: "描述为何信任此人，以及他们的优点和特长",
      },
      {
        key: "duration",
        label: "认识时长",
        type: "text",
        required: false,
        placeholder: "例如: 3 years",
      },
    ],
    isBuiltIn: true,
  },

  // 自我声明
  "self-declaration": {
    id: "built-in:self-declaration",
    name: "自我声明",
    type: "SelfDeclaration",
    description: "声明个人信息、偏好或立场",
    icon: "📝",
    fields: [
      {
        key: "statement",
        label: "声明内容",
        type: "textarea",
        required: true,
        placeholder: "例如: 我是一名全栈开发者",
      },
      {
        key: "category",
        label: "类别",
        type: "select",
        required: false,
        options: ["职业", "兴趣", "技能", "观点", "其他"],
        defaultValue: "职业",
      },
      {
        key: "details",
        label: "补充说明",
        type: "textarea",
        required: false,
        placeholder: "提供更多细节和背景信息",
      },
    ],
    isBuiltIn: true,
  },
};

/**
 * VC 模板管理器类
 */
class VCTemplateManager extends EventEmitter {
  constructor(databaseManager) {
    super();
    this.db = databaseManager;
  }

  /**
   * 初始化模板管理器
   */
  async initialize() {
    logger.info("[VCTemplateManager] 初始化凭证模板管理器...");

    try {
      // 确保数据库表存在
      await this.ensureTables();

      logger.info("[VCTemplateManager] 凭证模板管理器初始化成功");
      this.emit("initialized");

      return true;
    } catch (error) {
      logger.error("[VCTemplateManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    try {
      const result = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='vc_templates'",
        )
        .all();

      if (!result || result.length === 0) {
        // 创建模板表
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS vc_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            icon TEXT,
            fields TEXT NOT NULL,
            created_by_did TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            usage_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // 创建索引
        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_template_type ON vc_templates(type)
        `,
          )
          .run();
        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_template_creator ON vc_templates(created_by_did)
        `,
          )
          .run();
        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_template_public ON vc_templates(is_public)
        `,
          )
          .run();

        logger.info("[VCTemplateManager] vc_templates 表已创建");
      }
    } catch (error) {
      logger.error("[VCTemplateManager] 检查数据库表失败:", error);
      throw error;
    }
  }

  /**
   * 获取所有模板（内置 + 用户自定义）
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模板列表
   */
  getAllTemplates(filters = {}) {
    try {
      // 获取内置模板
      let builtInTemplates = Object.values(BUILT_IN_TEMPLATES);

      // 按类型过滤
      if (filters.type) {
        builtInTemplates = builtInTemplates.filter(
          (t) => t.type === filters.type,
        );
      }

      // 获取用户自定义模板
      let query = "SELECT * FROM vc_templates WHERE 1=1";
      const params = [];

      if (filters.type) {
        query += " AND type = ?";
        params.push(filters.type);
      }

      if (filters.createdBy) {
        query += " AND created_by_did = ?";
        params.push(filters.createdBy);
      }

      if (filters.isPublic !== undefined) {
        query += " AND is_public = ?";
        params.push(filters.isPublic ? 1 : 0);
      }

      query += " ORDER BY usage_count DESC, created_at DESC";

      const rows = this.db.prepare(query).all(...params);

      let userTemplates = [];
      if (rows && rows.length > 0) {
        userTemplates = rows.map((row) => {
          // 解析 fields JSON
          const template = { ...row };
          template.fields = JSON.parse(template.fields);
          template.isBuiltIn = false;

          return template;
        });
      }

      // 合并内置模板和用户模板
      return [...builtInTemplates, ...userTemplates];
    } catch (error) {
      logger.error("[VCTemplateManager] 获取模板列表失败:", error);
      return Object.values(BUILT_IN_TEMPLATES);
    }
  }

  /**
   * 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Object|null} 模板对象
   */
  getTemplateById(id) {
    try {
      // 检查是否是内置模板
      if (id.startsWith("built-in:")) {
        const templateKey = id.replace("built-in:", "");
        return BUILT_IN_TEMPLATES[templateKey] || null;
      }

      // 查询用户自定义模板
      const result = this.db
        .prepare("SELECT * FROM vc_templates WHERE id = ?")
        .all([id]);

      if (
        !result ||
        result.length === 0 ||
        !result[0].values ||
        result[0].values.length === 0
      ) {
        return null;
      }

      const columns = result[0].columns;
      const row = result[0].values[0];

      const template = {};
      columns.forEach((col, index) => {
        template[col] = row[index];
      });

      // 解析 fields JSON
      template.fields = JSON.parse(template.fields);
      template.isBuiltIn = false;

      return template;
    } catch (error) {
      logger.error("[VCTemplateManager] 获取模板失败:", error);
      return null;
    }
  }

  /**
   * 创建自定义模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板
   */
  async createTemplate(templateData) {
    const { name, type, description, icon, fields, createdBy, isPublic } =
      templateData;

    logger.info("[VCTemplateManager] 创建自定义模板:", name);

    try {
      const id = `custom:${uuidv4()}`;
      const now = Date.now();

      const template = {
        id,
        name,
        type,
        description: description || "",
        icon: icon || "📄",
        fields: JSON.stringify(fields),
        created_by_did: createdBy,
        is_public: isPublic ? 1 : 0,
        usage_count: 0,
        created_at: now,
      };

      this.db
        .prepare(
          `
        INSERT INTO vc_templates (
          id, name, type, description, icon, fields,
          created_by_did, is_public, usage_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          template.id,
          template.name,
          template.type,
          template.description,
          template.icon,
          template.fields,
          template.created_by_did,
          template.is_public,
          template.usage_count,
          template.created_at,
        );

      this.db.saveToFile();

      logger.info("[VCTemplateManager] 自定义模板已创建:", id);
      this.emit("template-created", { id, name, type });

      return {
        ...template,
        fields: JSON.parse(template.fields),
        isBuiltIn: false,
      };
    } catch (error) {
      logger.error("[VCTemplateManager] 创建模板失败:", error);
      throw error;
    }
  }

  /**
   * 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<boolean>} 操作结果
   */
  async updateTemplate(id, updates) {
    try {
      // 不能更新内置模板
      if (id.startsWith("built-in:")) {
        throw new Error("不能修改内置模板");
      }

      const template = this.getTemplateById(id);
      if (!template) {
        throw new Error("模板不存在");
      }

      const fields = [];
      const params = [];

      if (updates.name !== undefined) {
        fields.push("name = ?");
        params.push(updates.name);
      }

      if (updates.description !== undefined) {
        fields.push("description = ?");
        params.push(updates.description);
      }

      if (updates.icon !== undefined) {
        fields.push("icon = ?");
        params.push(updates.icon);
      }

      if (updates.fields !== undefined) {
        fields.push("fields = ?");
        params.push(JSON.stringify(updates.fields));
      }

      if (updates.isPublic !== undefined) {
        fields.push("is_public = ?");
        params.push(updates.isPublic ? 1 : 0);
      }

      if (fields.length === 0) {
        return false;
      }

      params.push(id);

      this.db
        .prepare(`UPDATE vc_templates SET ${fields.join(", ")} WHERE id = ?`)
        .run(params);

      this.db.saveToFile();

      logger.info("[VCTemplateManager] 模板已更新:", id);
      this.emit("template-updated", { id });

      return true;
    } catch (error) {
      logger.error("[VCTemplateManager] 更新模板失败:", error);
      throw error;
    }
  }

  /**
   * 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 操作结果
   */
  async deleteTemplate(id) {
    try {
      // 不能删除内置模板
      if (id.startsWith("built-in:")) {
        throw new Error("不能删除内置模板");
      }

      const template = this.getTemplateById(id);
      if (!template) {
        throw new Error("模板不存在");
      }

      this.db.prepare("DELETE FROM vc_templates WHERE id = ?").run([id]);
      this.db.saveToFile();

      logger.info("[VCTemplateManager] 模板已删除:", id);
      this.emit("template-deleted", { id });

      return true;
    } catch (error) {
      logger.error("[VCTemplateManager] 删除模板失败:", error);
      throw error;
    }
  }

  /**
   * 增加模板使用次数
   * @param {string} id - 模板 ID
   */
  async incrementUsageCount(id) {
    try {
      // 内置模板不记录使用次数
      if (id.startsWith("built-in:")) {
        return;
      }

      this.db
        .prepare(
          "UPDATE vc_templates SET usage_count = usage_count + 1 WHERE id = ?",
        )
        .run([id]);

      this.db.saveToFile();
    } catch (error) {
      logger.error("[VCTemplateManager] 更新使用次数失败:", error);
    }
  }

  /**
   * 从模板填充凭证数据
   * @param {string} templateId - 模板 ID
   * @param {Object} values - 用户填写的值
   * @returns {Object} 凭证声明数据
   */
  fillTemplateValues(templateId, values) {
    const template = this.getTemplateById(templateId);
    if (!template) {
      throw new Error("模板不存在");
    }

    const claims = {};

    template.fields.forEach((field) => {
      const value = values[field.key];

      // 必填字段检查
      if (
        field.required &&
        (value === undefined || value === null || value === "")
      ) {
        throw new Error(`字段 "${field.label}" 是必填的`);
      }

      // 使用用户提供的值或默认值
      if (value !== undefined && value !== null && value !== "") {
        claims[field.key] = value;
      } else if (field.defaultValue !== undefined) {
        claims[field.key] = field.defaultValue;
      }
    });

    return claims;
  }

  /**
   * 获取模板统计信息
   * @returns {Object} 统计信息
   */
  getStatistics() {
    try {
      const builtInCount = Object.keys(BUILT_IN_TEMPLATES).length;

      const customResult = this.db
        .prepare("SELECT COUNT(*) as count FROM vc_templates")
        .all();
      const customCount = customResult?.[0]?.values?.[0]?.[0] || 0;

      const publicResult = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM vc_templates WHERE is_public = 1",
        )
        .all();
      const publicCount = publicResult?.[0]?.values?.[0]?.[0] || 0;

      return {
        builtIn: builtInCount,
        custom: customCount,
        public: publicCount,
        total: builtInCount + customCount,
      };
    } catch (error) {
      logger.error("[VCTemplateManager] 获取统计信息失败:", error);
      return {
        builtIn: Object.keys(BUILT_IN_TEMPLATES).length,
        custom: 0,
        public: 0,
        total: Object.keys(BUILT_IN_TEMPLATES).length,
      };
    }
  }

  /**
   * 导出模板为 JSON
   * @param {string} id - 模板 ID
   * @returns {Object} 模板 JSON 对象
   */
  exportTemplate(id) {
    try {
      const template = this.getTemplateById(id);
      if (!template) {
        throw new Error("模板不存在");
      }

      // 导出格式
      const exportData = {
        version: "1.0",
        exportedAt: Date.now(),
        template: {
          name: template.name,
          type: template.type,
          description: template.description || "",
          icon: template.icon || "📄",
          fields: template.fields,
          // 不包含使用统计和创建者信息
        },
      };

      logger.info("[VCTemplateManager] 模板已导出:", id);
      return exportData;
    } catch (error) {
      logger.error("[VCTemplateManager] 导出模板失败:", error);
      throw error;
    }
  }

  /**
   * 批量导出模板
   * @param {Array<string>} ids - 模板 ID 数组
   * @returns {Object} 包含多个模板的 JSON 对象
   */
  exportTemplates(ids) {
    try {
      const templates = ids
        .map((id) => {
          const template = this.getTemplateById(id);
          if (!template) {
            logger.warn(`[VCTemplateManager] 模板不存在: ${id}`);
            return null;
          }

          return {
            name: template.name,
            type: template.type,
            description: template.description || "",
            icon: template.icon || "📄",
            fields: template.fields,
          };
        })
        .filter((t) => t !== null);

      const exportData = {
        version: "1.0",
        exportedAt: Date.now(),
        count: templates.length,
        templates,
      };

      logger.info("[VCTemplateManager] 批量导出完成:", templates.length);
      return exportData;
    } catch (error) {
      logger.error("[VCTemplateManager] 批量导出失败:", error);
      throw error;
    }
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入的 JSON 数据
   * @param {string} createdBy - 创建者 DID
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果
   */
  async importTemplate(importData, createdBy, options = {}) {
    try {
      logger.info("[VCTemplateManager] 开始导入模板...");

      // 验证导入数据格式
      if (!importData || !importData.version) {
        throw new Error("无效的导入数据格式");
      }

      if (importData.version !== "1.0") {
        throw new Error(`不支持的版本: ${importData.version}`);
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [],
        imported: [],
      };

      // 单个模板导入
      if (importData.template) {
        try {
          const template = importData.template;
          await this._importSingleTemplate(template, createdBy, options);
          results.success++;
          results.imported.push(template.name);
        } catch (error) {
          results.failed++;
          results.errors.push({
            template: importData.template.name,
            error: error.message,
          });
        }
      }

      // 批量模板导入
      if (importData.templates && Array.isArray(importData.templates)) {
        for (const template of importData.templates) {
          try {
            await this._importSingleTemplate(template, createdBy, options);
            results.success++;
            results.imported.push(template.name);
          } catch (error) {
            results.failed++;
            results.errors.push({
              template: template.name,
              error: error.message,
            });
          }
        }
      }

      logger.info("[VCTemplateManager] 导入完成:", results);
      return results;
    } catch (error) {
      logger.error("[VCTemplateManager] 导入模板失败:", error);
      throw error;
    }
  }

  /**
   * 导入单个模板（内部方法）
   * @param {Object} templateData - 模板数据
   * @param {string} createdBy - 创建者 DID
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 创建的模板
   */
  async _importSingleTemplate(templateData, createdBy, options = {}) {
    const { overwrite = false } = options;

    // 验证必填字段
    if (!templateData.name) {
      throw new Error("模板名称不能为空");
    }

    if (!templateData.type) {
      throw new Error("模板类型不能为空");
    }

    if (!templateData.fields || !Array.isArray(templateData.fields)) {
      throw new Error("模板字段定义无效");
    }

    // 验证字段格式
    for (const field of templateData.fields) {
      if (!field.key || !field.label || !field.type) {
        throw new Error(`字段定义不完整: ${JSON.stringify(field)}`);
      }

      const validTypes = ["text", "number", "select", "month", "textarea"];
      if (!validTypes.includes(field.type)) {
        throw new Error(`不支持的字段类型: ${field.type}`);
      }
    }

    // 检查是否已存在同名模板
    const existingTemplates = this.getAllTemplates({ createdBy });
    const duplicate = existingTemplates.find(
      (t) => t.name === templateData.name && !t.isBuiltIn,
    );

    if (duplicate && !overwrite) {
      throw new Error(
        `模板 "${templateData.name}" 已存在，请启用覆盖选项或重命名`,
      );
    }

    // 如果需要覆盖，先删除旧模板
    if (duplicate && overwrite) {
      await this.deleteTemplate(duplicate.id);
    }

    // 创建新模板
    const newTemplate = await this.createTemplate({
      name: templateData.name,
      type: templateData.type,
      description: templateData.description || "",
      icon: templateData.icon || "📄",
      fields: templateData.fields,
      createdBy,
      isPublic: false,
    });

    return newTemplate;
  }

  /**
   * 关闭管理器
   */
  async close() {
    logger.info("[VCTemplateManager] 关闭凭证模板管理器");
    this.emit("closed");
  }
}

module.exports = VCTemplateManager;
