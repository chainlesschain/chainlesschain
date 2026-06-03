// 此文件包含应用中使用的所有类型定义
// 虽然使用JavaScript,但我们在注释中保留类型信息以便理解

/**
 * 知识库项
 * @typedef {Object} KnowledgeItem
 * @property {string} id
 * @property {string} title
 * @property {'note'|'document'|'conversation'|'web_clip'} type
 * @property {string|null} content_path
 * @property {string|null} embedding_path
 * @property {number} created_at
 * @property {number} updated_at
 * @property {string|null} git_commit_hash
 * @property {string|null} device_id
 * @property {'synced'|'pending'|'conflict'} sync_status
 * @property {Tag[]} tags
 * @property {string} content
 */

/**
 * 标签
 * @typedef {Object} Tag
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {number} created_at
 */

/**
 * 消息
 * @typedef {Object} Message
 * @property {string} id
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {number} timestamp
 * @property {number} tokens
 */

/**
 * U盾状态
 * @typedef {Object} UKeyStatus
 * @property {boolean} detected
 * @property {boolean} unlocked
 * @property {string} deviceId
 * @property {string} publicKey
 */

/**
 * Git同步状态
 * @typedef {Object} GitStatus
 * @property {string} branch
 * @property {number} ahead
 * @property {number} behind
 * @property {string[]} modified
 * @property {string[]} untracked
 * @property {number|null} lastSync
 */

/**
 * LLM服务状态
 * @typedef {Object} LLMServiceStatus
 * @property {boolean} available
 * @property {string[]} models
 * @property {string} currentModel
 * @property {string} error
 */

/**
 * 应用配置
 * @typedef {Object} AppConfig
 * @property {'light'|'dark'} theme
 * @property {string} llmModel
 * @property {string|null} gitRemote
 * @property {boolean} autoSync
 * @property {number} syncInterval
 */

// 导出空对象（JavaScript不需要实际导出类型）
export default {};
