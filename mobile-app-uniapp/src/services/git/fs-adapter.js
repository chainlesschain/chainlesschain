/**
 * 文件系统适配器 (移动端版本)
 *
 * 将uni-app的文件系统API适配为isomorphic-git所需的fs接口
 *
 * isomorphic-git需要的fs接口:
 * - readFile(filepath, options)
 * - writeFile(filepath, data, options)
 * - unlink(filepath)
 * - readdir(dirpath)
 * - mkdir(dirpath, options)
 * - rmdir(dirpath)
 * - stat(filepath)
 * - lstat(filepath)
 * - readlink(filepath)
 * - symlink(target, filepath)
 */

/**
 * 文件系统管理器适配器
 */
class FSAdapter {
  constructor() {
    // 获取uni-app文件系统管理器
    this.fs = uni.getFileSystemManager()

    // 获取用户目录路径
    // #ifdef APP-PLUS
    this.basePath = plus.io.getStorageRootDir() + 'git-repos/'
    // #endif

    // #ifdef H5
    this.basePath = '/git-repos/'
    // #endif

    // #ifdef MP-WEIXIN
    this.basePath = `${wx.env.USER_DATA_PATH}/git-repos/`
    // #endif

    console.log('[FSAdapter] 初始化，基础路径:', this.basePath)

    // 确保基础目录存在
    this.ensureBasePath()
  }

  /**
   * 确保基础路径存在
   */
  ensureBasePath() {
    try {
      this.fs.accessSync(this.basePath)
    } catch (e) {
      // 目录不存在，创建它
      try {
        this.fs.mkdirSync(this.basePath, true)
        console.log('[FSAdapter] 创建基础目录:', this.basePath)
      } catch (mkdirError) {
        console.error('[FSAdapter] 创建基础目录失败:', mkdirError)
      }
    }
  }

  /**
   * 读取文件
   * @param {string} filepath - 文件路径
   * @param {Object} options - 选项 { encoding: 'utf8' | null }
   * @returns {Promise<string|Uint8Array>}
   */
  async readFile(filepath, options = {}) {
    return new Promise((resolve, reject) => {
      const encoding = options.encoding || options

      this.fs.readFile({
        filePath: filepath,
        encoding: encoding === 'utf8' ? 'utf8' : null,
        success: (res) => {
          if (encoding === 'utf8' || typeof encoding === 'string') {
            resolve(res.data)
          } else {
            // 返回ArrayBuffer，需要转为Uint8Array
            resolve(new Uint8Array(res.data))
          }
        },
        fail: (err) => {
          reject(new Error(`读取文件失败: ${filepath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 写入文件
   * @param {string} filepath - 文件路径
   * @param {string|Uint8Array} data - 数据
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async writeFile(filepath, data, options = {}) {
    return new Promise((resolve, reject) => {
      const encoding = options.encoding || options

      this.fs.writeFile({
        filePath: filepath,
        data: data,
        encoding: encoding === 'utf8' ? 'utf8' : 'binary',
        success: () => {
          resolve()
        },
        fail: (err) => {
          reject(new Error(`写入文件失败: ${filepath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 删除文件
   * @param {string} filepath - 文件路径
   * @returns {Promise<void>}
   */
  async unlink(filepath) {
    return new Promise((resolve, reject) => {
      this.fs.unlink({
        filePath: filepath,
        success: () => {
          resolve()
        },
        fail: (err) => {
          reject(new Error(`删除文件失败: ${filepath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 读取目录
   * @param {string} dirpath - 目录路径
   * @returns {Promise<string[]>}
   */
  async readdir(dirpath) {
    return new Promise((resolve, reject) => {
      this.fs.readdir({
        dirPath: dirpath,
        success: (res) => {
          resolve(res.files || [])
        },
        fail: (err) => {
          reject(new Error(`读取目录失败: ${dirpath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 创建目录
   * @param {string} dirpath - 目录路径
   * @param {Object} options - 选项 { recursive: boolean }
   * @returns {Promise<void>}
   */
  async mkdir(dirpath, options = {}) {
    return new Promise((resolve, reject) => {
      this.fs.mkdir({
        dirPath: dirpath,
        recursive: options.recursive || false,
        success: () => {
          resolve()
        },
        fail: (err) => {
          // 如果目录已存在，不算错误
          if (err.errMsg && err.errMsg.includes('file already exists')) {
            resolve()
          } else {
            reject(new Error(`创建目录失败: ${dirpath}, ${err.errMsg}`))
          }
        }
      })
    })
  }

  /**
   * 删除目录
   * @param {string} dirpath - 目录路径
   * @returns {Promise<void>}
   */
  async rmdir(dirpath) {
    return new Promise((resolve, reject) => {
      this.fs.rmdir({
        dirPath: dirpath,
        recursive: false,
        success: () => {
          resolve()
        },
        fail: (err) => {
          reject(new Error(`删除目录失败: ${dirpath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 获取文件/目录状态
   * @param {string} filepath - 文件路径
   * @returns {Promise<Object>}
   */
  async stat(filepath) {
    return new Promise((resolve, reject) => {
      this.fs.stat({
        path: filepath,
        success: (res) => {
          const stats = res.stats[0] || res.stats

          // 转换为isomorphic-git期望的格式
          resolve({
            type: stats.isDirectory() ? 'dir' : 'file',
            mode: stats.mode || 0o100644, // 默认文件权限
            size: stats.size || 0,
            ino: 0,
            mtimeMs: stats.lastModifiedTime || Date.now(),
            isFile: () => !stats.isDirectory(),
            isDirectory: () => stats.isDirectory(),
            isSymbolicLink: () => false
          })
        },
        fail: (err) => {
          reject(new Error(`获取文件状态失败: ${filepath}, ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * lstat (对于移动端，同stat)
   * @param {string} filepath - 文件路径
   * @returns {Promise<Object>}
   */
  async lstat(filepath) {
    return this.stat(filepath)
  }

  /**
   * 读取符号链接 (移动端不支持，返回null)
   * @param {string} filepath - 文件路径
   * @returns {Promise<string>}
   */
  async readlink(filepath) {
    throw new Error('符号链接在移动端不支持')
  }

  /**
   * 创建符号链接 (移动端不支持)
   * @param {string} target - 目标路径
   * @param {string} filepath - 链接路径
   * @returns {Promise<void>}
   */
  async symlink(target, filepath) {
    throw new Error('符号链接在移动端不支持')
  }

  /**
   * 检查文件/目录是否存在
   * @param {string} filepath - 文件路径
   * @returns {Promise<boolean>}
   */
  async exists(filepath) {
    try {
      await this.stat(filepath)
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * 递归删除目录
   * @param {string} dirpath - 目录路径
   * @returns {Promise<void>}
   */
  async rmdirRecursive(dirpath) {
    try {
      const files = await this.readdir(dirpath)

      for (const file of files) {
        const filepath = `${dirpath}/${file}`
        const stats = await this.stat(filepath)

        if (stats.isDirectory()) {
          await this.rmdirRecursive(filepath)
        } else {
          await this.unlink(filepath)
        }
      }

      await this.rmdir(dirpath)
    } catch (error) {
      console.error('[FSAdapter] 递归删除目录失败:', error)
      throw error
    }
  }

  /**
   * 同步版本 (用于某些isomorphic-git操作)
   */

  readFileSync(filepath, options = {}) {
    // uni-app没有同步API，需要使用plus.io (仅App)
    // #ifdef APP-PLUS
    try {
      const encoding = options.encoding || options
      const file = plus.io.getFileInfo(filepath)

      if (!file) {
        throw new Error(`文件不存在: ${filepath}`)
      }

      // 读取文件内容
      const content = plus.io.readFile(filepath, encoding === 'utf8' ? 'utf-8' : 'binary')
      return content
    } catch (error) {
      throw new Error(`readFileSync失败: ${error.message}`)
    }
    // #endif

    // #ifndef APP-PLUS
    throw new Error('同步文件读取仅在App环境支持')
    // #endif
  }

  writeFileSync(filepath, data, options = {}) {
    // #ifdef APP-PLUS
    try {
      const encoding = options.encoding || options
      plus.io.writeFile(filepath, data, encoding === 'utf8' ? 'utf-8' : 'binary')
    } catch (error) {
      throw new Error(`writeFileSync失败: ${error.message}`)
    }
    // #endif

    // #ifndef APP-PLUS
    throw new Error('同步文件写入仅在App环境支持')
    // #endif
  }

  mkdirSync(dirpath, options = {}) {
    // #ifdef APP-PLUS
    try {
      plus.io.createDir(dirpath, options.recursive || false)
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw new Error(`mkdirSync失败: ${error.message}`)
      }
    }
    // #endif

    // #ifndef APP-PLUS
    throw new Error('同步目录创建仅在App环境支持')
    // #endif
  }

  /**
   * 获取仓库基础路径
   * @param {string} repoName - 仓库名称
   * @returns {string}
   */
  getRepoPath(repoName) {
    return `${this.basePath}${repoName}`
  }

  /**
   * 清理所有仓库数据 (慎用！)
   * @returns {Promise<void>}
   */
  async clearAll() {
    console.warn('[FSAdapter] 清理所有Git仓库数据...')

    try {
      await this.rmdirRecursive(this.basePath)
      this.ensureBasePath()
      console.log('[FSAdapter] ✅ 清理完成')
    } catch (error) {
      console.error('[FSAdapter] 清理失败:', error)
      throw error
    }
  }
}

// 创建单例
let fsAdapterInstance = null

/**
 * 获取文件系统适配器实例
 * @returns {FSAdapter}
 */
export function getFSAdapter() {
  if (!fsAdapterInstance) {
    fsAdapterInstance = new FSAdapter()
  }
  return fsAdapterInstance
}

export default FSAdapter
