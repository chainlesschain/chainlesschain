/**
 * Database settings table CRUD — extracted from database.js as part of
 * H3 split (v0.45.32).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

function initDefaultSettings(dbManager, logger) {
  const now = Date.now();
  const path = require("path");
  const { app } = require("electron");

  // 获取默认的项目根目录
  const defaultProjectRoot = path.join(app.getPath("userData"), "projects");

  const defaultSettings = [
    // 项目配置
    {
      key: "project.rootPath",
      value: defaultProjectRoot,
      type: "string",
      description: "项目文件存储根目录",
    },
    {
      key: "project.maxSizeMB",
      value: "1000",
      type: "number",
      description: "单个项目最大大小（MB）",
    },
    {
      key: "project.autoSync",
      value: "true",
      type: "boolean",
      description: "自动同步项目到后端",
    },
    {
      key: "project.syncIntervalSeconds",
      value: "300",
      type: "number",
      description: "同步间隔（秒）",
    },

    // LLM 配置 - 优先级和智能选择
    {
      key: "llm.provider",
      value: "volcengine",
      type: "string",
      description: "LLM服务提供商（当前激活）",
    },
    {
      key: "llm.priority",
      value: JSON.stringify(["volcengine", "ollama", "deepseek"]),
      type: "json",
      description: "LLM服务优先级列表",
    },
    {
      key: "llm.autoFallback",
      value: "true",
      type: "boolean",
      description: "自动切换到备用LLM服务",
    },
    {
      key: "llm.autoSelect",
      value: "true",
      type: "boolean",
      description: "AI自主选择最优LLM",
    },
    {
      key: "llm.selectionStrategy",
      value: "balanced",
      type: "string",
      description:
        "选择策略：cost（成本优先）、speed（速度优先）、quality（质量优先）、balanced（平衡）",
    },

    // Ollama 配置
    {
      key: "llm.ollamaHost",
      value: "http://localhost:11434",
      type: "string",
      description: "Ollama服务地址",
    },
    {
      key: "llm.ollamaModel",
      value: "qwen2:7b",
      type: "string",
      description: "Ollama模型名称",
    },

    // OpenAI 配置
    {
      key: "llm.openaiApiKey",
      value: "",
      type: "string",
      description: "OpenAI API Key",
    },
    {
      key: "llm.openaiBaseUrl",
      value: "https://api.openai.com/v1",
      type: "string",
      description: "OpenAI API地址",
    },
    {
      key: "llm.openaiModel",
      value: "gpt-3.5-turbo",
      type: "string",
      description: "OpenAI模型",
    },

    // 火山引擎（豆包）配置
    {
      key: "llm.volcengineApiKey",
      value: "",
      type: "string",
      description: "火山引擎API Key",
    },
    {
      key: "llm.volcengineModel",
      value: "doubao-seed-1.6-lite",
      type: "string",
      description: "火山引擎模型",
    },

    // 阿里通义千问配置
    {
      key: "llm.dashscopeApiKey",
      value: "",
      type: "string",
      description: "阿里通义千问API Key",
    },
    {
      key: "llm.dashscopeModel",
      value: "qwen-turbo",
      type: "string",
      description: "阿里通义千问模型",
    },

    // 智谱AI配置
    {
      key: "llm.zhipuApiKey",
      value: "",
      type: "string",
      description: "智谱AI API Key",
    },
    {
      key: "llm.zhipuModel",
      value: "glm-4",
      type: "string",
      description: "智谱AI模型",
    },

    // DeepSeek配置
    {
      key: "llm.deepseekApiKey",
      value: "",
      type: "string",
      description: "DeepSeek API Key",
    },
    {
      key: "llm.deepseekModel",
      value: "deepseek-chat",
      type: "string",
      description: "DeepSeek模型",
    },

    // 向量数据库配置
    {
      key: "vector.qdrantHost",
      value: "http://localhost:6333",
      type: "string",
      description: "Qdrant服务地址",
    },
    {
      key: "vector.qdrantPort",
      value: "6333",
      type: "number",
      description: "Qdrant端口",
    },
    {
      key: "vector.qdrantCollection",
      value: "chainlesschain_vectors",
      type: "string",
      description: "Qdrant集合名称",
    },
    {
      key: "vector.embeddingModel",
      value: "bge-base-zh-v1.5",
      type: "string",
      description: "Embedding模型",
    },
    {
      key: "vector.embeddingDimension",
      value: "768",
      type: "number",
      description: "向量维度",
    },

    // Git 配置
    {
      key: "git.enabled",
      value: "false",
      type: "boolean",
      description: "启用Git同步",
    },
    {
      key: "git.autoSync",
      value: "false",
      type: "boolean",
      description: "自动提交和推送",
    },
    {
      key: "git.autoSyncInterval",
      value: "300",
      type: "number",
      description: "Git同步间隔（秒）",
    },
    {
      key: "git.userName",
      value: "",
      type: "string",
      description: "Git用户名",
    },
    {
      key: "git.userEmail",
      value: "",
      type: "string",
      description: "Git邮箱",
    },
    {
      key: "git.remoteUrl",
      value: "",
      type: "string",
      description: "Git远程仓库URL",
    },

    // 后端服务配置
    {
      key: "backend.projectServiceUrl",
      value: "http://localhost:9090",
      type: "string",
      description: "项目服务地址",
    },
    {
      key: "backend.aiServiceUrl",
      value: "http://localhost:8001",
      type: "string",
      description: "AI服务地址",
    },

    // 数据库配置
    {
      key: "database.sqlcipherKey",
      value: "",
      type: "string",
      description: "SQLCipher加密密钥",
    },

    // P2P 网络配置
    {
      key: "p2p.transports.webrtc.enabled",
      value: "true",
      type: "boolean",
      description: "启用WebRTC传输（推荐）",
    },
    {
      key: "p2p.transports.websocket.enabled",
      value: "true",
      type: "boolean",
      description: "启用WebSocket传输",
    },
    {
      key: "p2p.transports.tcp.enabled",
      value: "true",
      type: "boolean",
      description: "启用TCP传输（向后兼容）",
    },
    {
      key: "p2p.transports.autoSelect",
      value: "true",
      type: "boolean",
      description: "智能自动选择传输层",
    },

    // STUN 配置（仅公共免费服务器）
    {
      key: "p2p.stun.servers",
      value: JSON.stringify([
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ]),
      type: "json",
      description: "STUN服务器列表",
    },

    // Circuit Relay 配置
    {
      key: "p2p.relay.enabled",
      value: "true",
      type: "boolean",
      description: "启用Circuit Relay v2中继",
    },
    {
      key: "p2p.relay.maxReservations",
      value: "2",
      type: "number",
      description: "最大中继预留数量",
    },
    {
      key: "p2p.relay.autoUpgrade",
      value: "true",
      type: "boolean",
      description: "自动升级中继为直连（DCUTr）",
    },

    // NAT 穿透配置
    {
      key: "p2p.nat.autoDetect",
      value: "true",
      type: "boolean",
      description: "启动时自动检测NAT类型",
    },
    {
      key: "p2p.nat.detectionInterval",
      value: "3600000",
      type: "number",
      description: "NAT检测间隔（毫秒，默认1小时）",
    },

    // 连接配置
    {
      key: "p2p.connection.dialTimeout",
      value: "30000",
      type: "number",
      description: "连接超时时间（毫秒）",
    },
    {
      key: "p2p.connection.maxRetries",
      value: "3",
      type: "number",
      description: "最大重试次数",
    },
    {
      key: "p2p.connection.healthCheckInterval",
      value: "60000",
      type: "number",
      description: "健康检查间隔（毫秒）",
    },

    // WebSocket 端口配置
    {
      key: "p2p.websocket.port",
      value: "9001",
      type: "number",
      description: "WebSocket监听端口",
    },

    // 向后兼容
    {
      key: "p2p.compatibility.detectLegacy",
      value: "true",
      type: "boolean",
      description: "自动检测并兼容旧版TCP节点",
    },
  ];

  const stmt = dbManager.db.prepare(
    "SELECT key FROM system_settings WHERE key = ?",
  );

  for (const setting of defaultSettings) {
    const existing = stmt.get([setting.key]);

    if (!existing) {
      const insertStmt = dbManager.db.prepare(
        "INSERT INTO system_settings (key, value, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertStmt.run([
        setting.key,
        setting.value,
        setting.type,
        setting.description,
        now,
        now,
      ]);
      insertStmt.free();
    }
  }

  stmt.free();
  dbManager.saveToFile();
}

function getSetting(dbManager, logger, key) {
  const stmt = dbManager.db.prepare(
    "SELECT value, type FROM system_settings WHERE key = ?",
  );
  const row = stmt.get([key]);
  stmt.free();

  if (!row) {
    return null;
  }

  // 根据类型转换值
  switch (row.type) {
    case "number":
      return parseFloat(row.value);
    case "boolean":
      return row.value === "true";
    case "json":
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    default:
      return row.value;
  }
}

function getAllSettings(dbManager, logger) {
  const stmt = dbManager.db.prepare(
    "SELECT key, value, type FROM system_settings",
  );
  const rows = stmt.all();
  stmt.free();

  const config = {
    project: {},
    llm: {},
    vector: {},
    git: {},
    backend: {},
    database: {},
  };

  for (const row of rows) {
    const [section, key] = row.key.split(".");
    let value = row.value;

    // 根据类型转换值
    switch (row.type) {
      case "number":
        value = parseFloat(value);
        break;
      case "boolean":
        value = value === "true";
        break;
      case "json":
        try {
          value = JSON.parse(value);
        } catch {
          value = null;
        }
        break;
    }

    if (config[section]) {
      config[section][key] = value;
    }
  }

  return config;
}

function setSetting(dbManager, logger, key, value) {
  const now = Date.now();

  // 确定值的类型
  let type = "string";
  let stringValue = String(value);

  if (typeof value === "number") {
    type = "number";
  } else if (typeof value === "boolean") {
    type = "boolean";
    stringValue = value ? "true" : "false";
  } else if (typeof value === "object") {
    type = "json";
    stringValue = JSON.stringify(value);
  }

  const stmt = dbManager.db.prepare(
    "INSERT OR REPLACE INTO system_settings (key, value, type, updated_at, created_at) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM system_settings WHERE key = ?), ?))",
  );
  stmt.run([key, stringValue, type, now, key, now]);
  stmt.free();

  dbManager.saveToFile();
  return true;
}

function updateSettings(dbManager, logger, config) {
  for (const section in config) {
    if (typeof config[section] === "object" && config[section] !== null) {
      for (const key in config[section]) {
        dbManager.setSetting(`${section}.${key}`, config[section][key]);
      }
    }
  }
  return true;
}

function deleteSetting(dbManager, logger, key) {
  const stmt = dbManager.db.prepare(
    "DELETE FROM system_settings WHERE key = ?",
  );
  stmt.run([key]);
  stmt.free();
  dbManager.saveToFile();
  return true;
}

function resetSettings(dbManager, logger) {
  dbManager.db.run("DELETE FROM system_settings");
  dbManager.initDefaultSettings();
  return true;
}

module.exports = {
  initDefaultSettings,
  getSetting,
  getAllSettings,
  setSetting,
  updateSettings,
  deleteSetting,
  resetSettings,
};
