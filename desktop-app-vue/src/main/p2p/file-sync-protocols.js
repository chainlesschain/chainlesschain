/**
 * 外部设备文件同步协议定义
 *
 * 定义PC端与Android端之间的文件索引同步和文件传输协议
 */

const FILE_SYNC_PROTOCOLS = {
  // ============================
  // 索引同步协议
  // ============================

  /**
   * 索引请求
   * PC端 -> Android端
   * 请求获取Android端的文件索引列表
   */
  INDEX_REQUEST: 'file:index-request',

  /**
   * 索引响应
   * Android端 -> PC端
   * 返回文件索引列表（支持分页）
   */
  INDEX_RESPONSE: 'file:index-response',

  /**
   * 索引变更通知
   * Android端 -> PC端
   * 当文件索引发生变更时主动通知PC端
   */
  INDEX_CHANGED: 'file:index-changed',

  // ============================
  // 文件传输协议
  // ============================

  /**
   * 文件拉取请求
   * PC端 -> Android端
   * 请求拉取指定文件
   */
  FILE_PULL_REQUEST: 'file:pull-request',

  /**
   * 文件拉取响应
   * Android端 -> PC端
   * 确认文件拉取请求，返回文件元数据
   */
  FILE_PULL_RESPONSE: 'file:pull-response',

  /**
   * 文件推送请求
   * PC端 -> Android端
   * 请求推送文件到Android端
   */
  FILE_PUSH_REQUEST: 'file:push-request',

  /**
   * 文件推送响应
   * Android端 -> PC端
   * 确认文件推送请求
   */
  FILE_PUSH_RESPONSE: 'file:push-response',

  // ============================
  // 文件分块传输协议（复用现有协议）
  // ============================

  /**
   * 文件分块数据
   * 发送文件的分块数据（64KB/块）
   * 复用 file-transfer-manager 的现有协议
   */
  FILE_CHUNK: 'file:chunk',

  /**
   * 文件传输完成
   * 通知文件传输完成
   */
  FILE_TRANSFER_COMPLETE: 'file:transfer-complete',

  /**
   * 文件传输错误
   * 通知文件传输过程中的错误
   */
  FILE_TRANSFER_ERROR: 'file:transfer-error',

  /**
   * 文件传输进度
   * 实时报告文件传输进度
   */
  FILE_TRANSFER_PROGRESS: 'file:transfer-progress',

  /**
   * 文件传输取消
   * 取消正在进行的文件传输
   */
  FILE_TRANSFER_CANCEL: 'file:transfer-cancel',

  // ============================
  // 文件校验协议
  // ============================

  /**
   * 文件校验请求
   * 请求验证文件的完整性（checksum）
   */
  FILE_VERIFY_REQUEST: 'file:verify-request',

  /**
   * 文件校验响应
   * 返回文件校验结果
   */
  FILE_VERIFY_RESPONSE: 'file:verify-response',
};

/**
 * 文件分类枚举
 */
const FILE_CATEGORIES = {
  DOCUMENT: 'DOCUMENT',  // 文档（PDF, DOC, TXT等）
  IMAGE: 'IMAGE',        // 图片
  VIDEO: 'VIDEO',        // 视频
  AUDIO: 'AUDIO',        // 音频
  CODE: 'CODE',          // 代码文件
  OTHER: 'OTHER',        // 其他
};

/**
 * 同步状态枚举
 */
const SYNC_STATUS = {
  PENDING: 'pending',    // 待同步
  SYNCING: 'syncing',    // 同步中
  SYNCED: 'synced',      // 已同步
  ERROR: 'error',        // 同步错误
};

/**
 * 传输状态枚举
 */
const TRANSFER_STATUS = {
  PENDING: 'pending',       // 等待中
  IN_PROGRESS: 'in_progress', // 传输中
  COMPLETED: 'completed',   // 已完成
  FAILED: 'failed',         // 失败
  CANCELLED: 'cancelled',   // 已取消
};

/**
 * 传输类型枚举
 */
const TRANSFER_TYPE = {
  PULL: 'pull',  // 拉取（PC <- Android）
  PUSH: 'push',  // 推送（PC -> Android）
};

/**
 * 同步类型枚举
 */
const SYNC_TYPE = {
  INDEX_SYNC: 'index_sync',  // 索引同步
  FILE_PULL: 'file_pull',    // 文件拉取
};

module.exports = {
  FILE_SYNC_PROTOCOLS,
  FILE_CATEGORIES,
  SYNC_STATUS,
  TRANSFER_STATUS,
  TRANSFER_TYPE,
  SYNC_TYPE,
};
