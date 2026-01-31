/**
 * 冲突错误类
 * 用于乐观锁冲突场景
 */
class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'CONFLICT';
    this.details = details;

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConflictError);
    }
  }

  /**
   * 序列化为可传输的对象
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

module.exports = ConflictError;
