/**
 * Git 同步服务 (移动端)
 *
 * 基于 isomorphic-git 实现移动端Git功能
 * 支持知识库的版本控制和远程同步
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { db } from '../database';

/**
 * Git服务类
 */
class GitService {
  constructor() {
    this.fs = null; // 文件系统适配器
    this.repoPath = '/git-repo'; // 仓库路径
    this.isInitialized = false;

    // Git用户信息
    this.author = {
      name: 'ChainlessChain User',
      email: 'user@chainlesschain.com'
    };

    // 远程仓库配置
    this.remote = {
      name: 'origin',
      url: null
    };

    // 认证信息
    this.auth = null;

    // 自动同步配置
    this.autoSync = {
      enabled: false,
      interval: 5 * 60 * 1000, // 5分钟
      timer: null
    };
  }

  /**
   * 初始化Git服务
   */
  async initialize() {
    console.log('[GitService] 初始化Git服务...');

    try {
      // 初始化文件系统适配器
      await this.initFileSystem();

      // 检查是否已经是git仓库
      const isRepo = await this.isGitRepository();

      if (!isRepo) {
        console.log('[GitService] 初始化新的Git仓库...');
        await git.init({
          fs: this.fs,
          dir: this.repoPath,
          defaultBranch: 'main'
        });
        console.log('[GitService] Git仓库初始化成功');
      } else {
        console.log('[GitService] 使用现有Git仓库');
      }

      // 加载配置
      await this.loadConfig();

      this.isInitialized = true;

      // 启动自动同步
      if (this.autoSync.enabled) {
        this.startAutoSync();
      }

      return true;
    } catch (error) {
      console.error('[GitService] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化文件系统适配器
   * 使用uni-app的文件系统API
   */
  async initFileSystem() {
    // #ifdef APP-PLUS
    // 使用plus.io文件系统
    this.fs = {
      promises: {
        readFile: async (filepath) => {
          return new Promise((resolve, reject) => {
            plus.io.resolveLocalFileSystemURL(filepath, (entry) => {
              entry.file((file) => {
                const reader = new plus.io.FileReader();
                reader.onloadend = (e) => resolve(new Uint8Array(e.target.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
              }, reject);
            }, reject);
          });
        },
        writeFile: async (filepath, data) => {
          return new Promise((resolve, reject) => {
            const dirPath = filepath.substring(0, filepath.lastIndexOf('/'));
            plus.io.resolveLocalFileSystemURL(dirPath, (dirEntry) => {
              const filename = filepath.substring(filepath.lastIndexOf('/') + 1);
              dirEntry.getFile(filename, { create: true }, (fileEntry) => {
                fileEntry.createWriter((writer) => {
                  writer.onwriteend = resolve;
                  writer.onerror = reject;
                  writer.write(new Blob([data]));
                }, reject);
              }, reject);
            }, reject);
          });
        },
        mkdir: async (dirpath) => {
          return new Promise((resolve, reject) => {
            const parentPath = dirpath.substring(0, dirpath.lastIndexOf('/'));
            const dirname = dirpath.substring(dirpath.lastIndexOf('/') + 1);
            plus.io.resolveLocalFileSystemURL(parentPath, (parentEntry) => {
              parentEntry.getDirectory(dirname, { create: true }, resolve, reject);
            }, reject);
          });
        },
        readdir: async (dirpath) => {
          return new Promise((resolve, reject) => {
            plus.io.resolveLocalFileSystemURL(dirpath, (dirEntry) => {
              const reader = dirEntry.createReader();
              reader.readEntries((entries) => {
                resolve(entries.map(e => e.name));
              }, reject);
            }, reject);
          });
        },
        stat: async (filepath) => {
          return new Promise((resolve, reject) => {
            plus.io.resolveLocalFileSystemURL(filepath, (entry) => {
              entry.getMetadata((metadata) => {
                resolve({
                  isDirectory: () => entry.isDirectory,
                  isFile: () => entry.isFile,
                  size: metadata.size,
                  mtimeMs: metadata.modificationTime.getTime()
                });
              }, reject);
            }, reject);
          });
        },
        unlink: async (filepath) => {
          return new Promise((resolve, reject) => {
            plus.io.resolveLocalFileSystemURL(filepath, (entry) => {
              entry.remove(resolve, reject);
            }, reject);
          });
        },
        rmdir: async (dirpath) => {
          return new Promise((resolve, reject) => {
            plus.io.resolveLocalFileSystemURL(dirpath, (entry) => {
              entry.removeRecursively(resolve, reject);
            }, reject);
          });
        }
      }
    };
    // #endif

    // #ifdef H5
    // 使用IndexedDB文件系统（LightningFS）
    const LightningFS = require('@isomorphic-git/lightning-fs');
    this.fs = new LightningFS('git-fs');
    // #endif

    // #ifdef MP-WEIXIN
    // 使用微信小程序文件系统
    const fs = wx.getFileSystemManager();
    this.fs = {
      promises: {
        readFile: (filepath) => {
          return new Promise((resolve, reject) => {
            fs.readFile({
              filePath: filepath,
              success: (res) => resolve(new Uint8Array(res.data)),
              fail: reject
            });
          });
        },
        writeFile: (filepath, data) => {
          return new Promise((resolve, reject) => {
            fs.writeFile({
              filePath: filepath,
              data: data,
              success: resolve,
              fail: reject
            });
          });
        },
        mkdir: (dirpath) => {
          return new Promise((resolve, reject) => {
            fs.mkdir({
              dirPath: dirpath,
              recursive: true,
              success: resolve,
              fail: reject
            });
          });
        },
        readdir: (dirpath) => {
          return new Promise((resolve, reject) => {
            fs.readdir({
              dirPath: dirpath,
              success: (res) => resolve(res.files),
              fail: reject
            });
          });
        },
        stat: (filepath) => {
          return new Promise((resolve, reject) => {
            fs.stat({
              path: filepath,
              success: (res) => resolve({
                isDirectory: () => res.stats.isDirectory(),
                isFile: () => res.stats.isFile(),
                size: res.stats.size,
                mtimeMs: res.stats.mtime
              }),
              fail: reject
            });
          });
        },
        unlink: (filepath) => {
          return new Promise((resolve, reject) => {
            fs.unlink({
              filePath: filepath,
              success: resolve,
              fail: reject
            });
          });
        },
        rmdir: (dirpath) => {
          return new Promise((resolve, reject) => {
            fs.rmdir({
              dirPath: dirpath,
              recursive: true,
              success: resolve,
              fail: reject
            });
          });
        }
      }
    };
    // #endif
  }

  /**
   * 检查是否是Git仓库
   */
  async isGitRepository() {
    try {
      const gitDir = `${this.repoPath}/.git`;
      const stat = await this.fs.promises.stat(gitDir);
      return stat.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      // 从数据库加载Git配置
      const config = await db.getGitConfig();

      if (config) {
        this.author.name = config.authorName || this.author.name;
        this.author.email = config.authorEmail || this.author.email;
        this.remote.url = config.remoteUrl || null;
        this.auth = config.auth || null;
        this.autoSync.enabled = config.autoSync || false;
        this.autoSync.interval = config.syncInterval || this.autoSync.interval;
      }
    } catch (error) {
      console.error('[GitService] 加载配置失败:', error);
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config) {
    try {
      await db.saveGitConfig(config);

      // 更新内存中的配置
      if (config.authorName) this.author.name = config.authorName;
      if (config.authorEmail) this.author.email = config.authorEmail;
      if (config.remoteUrl !== undefined) this.remote.url = config.remoteUrl;
      if (config.auth !== undefined) this.auth = config.auth;
      if (config.autoSync !== undefined) {
        this.autoSync.enabled = config.autoSync;
        if (config.autoSync) {
          this.startAutoSync();
        } else {
          this.stopAutoSync();
        }
      }
      if (config.syncInterval) this.autoSync.interval = config.syncInterval;

      return true;
    } catch (error) {
      console.error('[GitService] 保存配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取仓库状态
   */
  async getStatus() {
    try {
      if (!this.isInitialized) {
        throw new Error('Git服务未初始化');
      }

      // 获取当前分支
      const branch = await git.currentBranch({
        fs: this.fs,
        dir: this.repoPath,
        fullname: false
      }) || 'main';

      // 获取状态矩阵
      const statusMatrix = await git.statusMatrix({
        fs: this.fs,
        dir: this.repoPath
      });

      // 分类文件
      const modified = [];
      const untracked = [];
      const deleted = [];

      for (const [filepath, head, workdir, stage] of statusMatrix) {
        if (head === 1 && workdir === 2 && stage === 2) {
          modified.push(filepath);
        } else if (head === 0 && workdir === 2 && stage === 0) {
          untracked.push(filepath);
        } else if (head === 1 && workdir === 0) {
          deleted.push(filepath);
        }
      }

      // 获取最后同步时间
      const lastSync = await this.getLastCommitDate();

      // 计算ahead/behind
      const { ahead, behind } = await this.calculateAheadBehind(branch);

      return {
        branch,
        ahead,
        behind,
        modified,
        untracked,
        deleted,
        lastSync,
        hasChanges: modified.length > 0 || untracked.length > 0 || deleted.length > 0
      };
    } catch (error) {
      console.error('[GitService] 获取状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取最后提交时间
   */
  async getLastCommitDate() {
    try {
      const commits = await git.log({
        fs: this.fs,
        dir: this.repoPath,
        depth: 1
      });

      if (commits.length > 0) {
        return new Date(commits[0].commit.committer.timestamp * 1000);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 计算本地分支与远程分支的ahead/behind commits
   */
  async calculateAheadBehind(branch) {
    try {
      // 如果没有配置远程仓库，返回0
      if (!this.remote.url) {
        return { ahead: 0, behind: 0 };
      }

      const remoteBranch = `${this.remote.name}/${branch}`;

      // 获取本地分支的commit oid
      let localOid;
      try {
        localOid = await git.resolveRef({
          fs: this.fs,
          dir: this.repoPath,
          ref: branch
        });
      } catch (error) {
        return { ahead: 0, behind: 0 };
      }

      // 获取远程分支的commit oid
      let remoteOid;
      try {
        remoteOid = await git.resolveRef({
          fs: this.fs,
          dir: this.repoPath,
          ref: `refs/remotes/${remoteBranch}`
        });
      } catch (error) {
        // 远程分支不存在
        const localCommits = await git.log({
          fs: this.fs,
          dir: this.repoPath,
          ref: branch
        });
        return { ahead: localCommits.length, behind: 0 };
      }

      // 如果两个oid相同，说明完全同步
      if (localOid === remoteOid) {
        return { ahead: 0, behind: 0 };
      }

      // 获取本地分支的所有commits
      const localCommits = await git.log({
        fs: this.fs,
        dir: this.repoPath,
        ref: branch
      });

      // 获取远程分支的所有commits
      const remoteCommits = await git.log({
        fs: this.fs,
        dir: this.repoPath,
        ref: `refs/remotes/${remoteBranch}`
      });

      // 创建commit oid集合
      const localOids = new Set(localCommits.map(c => c.oid));
      const remoteOids = new Set(remoteCommits.map(c => c.oid));

      // 计算ahead
      let ahead = 0;
      for (const commit of localCommits) {
        if (!remoteOids.has(commit.oid)) {
          ahead++;
        } else {
          break;
        }
      }

      // 计算behind
      let behind = 0;
      for (const commit of remoteCommits) {
        if (!localOids.has(commit.oid)) {
          behind++;
        } else {
          break;
        }
      }

      return { ahead, behind };
    } catch (error) {
      console.error('[GitService] 计算ahead/behind失败:', error);
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * 添加文件到暂存区
   */
  async add(filepaths) {
    try {
      const paths = Array.isArray(filepaths) ? filepaths : [filepaths];

      for (const filepath of paths) {
        await git.add({
          fs: this.fs,
          dir: this.repoPath,
          filepath
        });
      }

      console.log('[GitService] 文件已添加到暂存区:', paths);
      return true;
    } catch (error) {
      console.error('[GitService] 添加文件失败:', error);
      throw error;
    }
  }

  /**
   * 提交更改
   */
  async commit(message) {
    try {
      const sha = await git.commit({
        fs: this.fs,
        dir: this.repoPath,
        message,
        author: this.author
      });

      console.log('[GitService] 提交成功:', sha);
      return sha;
    } catch (error) {
      console.error('[GitService] 提交失败:', error);
      throw error;
    }
  }

  /**
   * 推送到远程仓库
   */
  async push() {
    try {
      if (!this.remote.url) {
        throw new Error('未配置远程仓库');
      }

      const result = await git.push({
        fs: this.fs,
        http,
        dir: this.repoPath,
        remote: this.remote.name,
        ref: await git.currentBranch({
          fs: this.fs,
          dir: this.repoPath,
          fullname: false
        }),
        onAuth: () => this.auth
      });

      console.log('[GitService] 推送成功:', result);
      return result;
    } catch (error) {
      console.error('[GitService] 推送失败:', error);
      throw error;
    }
  }

  /**
   * 从远程仓库拉取
   */
  async pull() {
    try {
      if (!this.remote.url) {
        throw new Error('未配置远程仓库');
      }

      // 先fetch
      await git.fetch({
        fs: this.fs,
        http,
        dir: this.repoPath,
        remote: this.remote.name,
        ref: await git.currentBranch({
          fs: this.fs,
          dir: this.repoPath,
          fullname: false
        }),
        onAuth: () => this.auth
      });

      // 再merge
      await git.merge({
        fs: this.fs,
        dir: this.repoPath,
        ours: await git.currentBranch({
          fs: this.fs,
          dir: this.repoPath,
          fullname: false
        }),
        theirs: `${this.remote.name}/${await git.currentBranch({
          fs: this.fs,
          dir: this.repoPath,
          fullname: false
        })}`,
        author: this.author
      });

      console.log('[GitService] 拉取成功');
      return true;
    } catch (error) {
      console.error('[GitService] 拉取失败:', error);
      throw error;
    }
  }

  /**
   * 克隆远程仓库
   */
  async clone(url, auth) {
    try {
      await git.clone({
        fs: this.fs,
        http,
        dir: this.repoPath,
        url,
        onAuth: () => auth || this.auth
      });

      // 保存远程仓库配置
      this.remote.url = url;
      if (auth) {
        this.auth = auth;
      }

      await this.saveConfig({
        remoteUrl: url,
        auth: auth || this.auth
      });

      console.log('[GitService] 克隆成功');
      return true;
    } catch (error) {
      console.error('[GitService] 克隆失败:', error);
      throw error;
    }
  }

  /**
   * 同步（自动提交、推送、拉取）
   */
  async sync(commitMessage = '自动同步') {
    try {
      console.log('[GitService] 开始同步...');

      // 获取状态
      const status = await this.getStatus();

      // 如果有更改，先提交
      if (status.hasChanges) {
        // 添加所有更改
        const allFiles = [...status.modified, ...status.untracked, ...status.deleted];
        if (allFiles.length > 0) {
          await this.add(allFiles);
        }

        // 提交
        await this.commit(commitMessage);
      }

      // 如果配置了远程仓库，进行推送和拉取
      if (this.remote.url) {
        // 先拉取
        try {
          await this.pull();
        } catch (error) {
          console.warn('[GitService] 拉取失败，继续推送:', error);
        }

        // 再推送
        await this.push();
      }

      console.log('[GitService] 同步完成');
      return true;
    } catch (error) {
      console.error('[GitService] 同步失败:', error);
      throw error;
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    if (this.autoSync.timer) {
      clearInterval(this.autoSync.timer);
    }

    this.autoSync.timer = setInterval(async () => {
      try {
        await this.sync('自动同步');
      } catch (error) {
        console.error('[GitService] 自动同步失败:', error);
      }
    }, this.autoSync.interval);

    console.log('[GitService] 自动同步已启动，间隔:', this.autoSync.interval / 1000, '秒');
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.autoSync.timer) {
      clearInterval(this.autoSync.timer);
      this.autoSync.timer = null;
      console.log('[GitService] 自动同步已停止');
    }
  }

  /**
   * 获取提交历史
   */
  async getCommitHistory(limit = 20) {
    try {
      const commits = await git.log({
        fs: this.fs,
        dir: this.repoPath,
        depth: limit
      });

      return commits.map(commit => ({
        oid: commit.oid,
        message: commit.commit.message,
        author: commit.commit.author.name,
        email: commit.commit.author.email,
        timestamp: new Date(commit.commit.author.timestamp * 1000),
        committer: commit.commit.committer.name
      }));
    } catch (error) {
      console.error('[GitService] 获取提交历史失败:', error);
      return [];
    }
  }
}

// 导出单例
export const gitService = new GitService();
export default gitService;
