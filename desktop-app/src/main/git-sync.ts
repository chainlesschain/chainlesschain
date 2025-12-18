import * as git from 'isomorphic-git';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { IDatabase } from './database-interface';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
}

/**
 * Git同步管理器
 */
export class GitSync {
  private repoPath: string;
  // @ts-ignore - 用于未来实现
  private database: IDatabase;

  constructor(database: IDatabase) {
    this.database = database;

    const userDataPath = app.getPath('userData');
    this.repoPath = path.join(userDataPath, 'knowledge-repo');

    // 确保仓库目录存在
    if (!fs.existsSync(this.repoPath)) {
      fs.mkdirSync(this.repoPath, { recursive: true });
    }
  }

  /**
   * 初始化Git仓库
   */
  async initialize(): Promise<void> {
    try {
      const isRepo = await git.findRoot({ fs, filepath: this.repoPath }).catch(() => null);

      if (!isRepo) {
        console.log('[Git] 初始化新仓库...');
        await git.init({ fs, dir: this.repoPath, defaultBranch: 'main' });
        console.log('[Git] 仓库初始化完成');
      } else {
        console.log('[Git] 仓库已存在');
      }
    } catch (error) {
      console.error('[Git] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 提交更改
   */
  async commit(message: string): Promise<string> {
    try {
      console.log('[Git] 准备提交:', message);

      // 添加所有更改
      const files = await this.getModifiedFiles();
      for (const file of files) {
        await git.add({ fs, dir: this.repoPath, filepath: file });
      }

      // 提交
      const sha = await git.commit({
        fs,
        dir: this.repoPath,
        message,
        author: {
          name: 'ChainlessChain User',
          email: 'user@chainlesschain.local',
        },
      });

      console.log('[Git] 提交成功:', sha);
      return sha;
    } catch (error) {
      console.error('[Git] 提交失败:', error);
      throw error;
    }
  }

  /**
   * 同步远程仓库
   */
  async sync(): Promise<void> {
    try {
      console.log('[Git] 开始同步...');

      // TODO: 实现实际的push/pull逻辑
      // 需要配置远程仓库URL和认证信息

      console.log('[Git] 同步完成');
    } catch (error) {
      console.error('[Git] 同步失败:', error);
      throw error;
    }
  }

  /**
   * 获取仓库状态
   */
  async getStatus(): Promise<GitStatus> {
    try {
      // 获取当前分支
      const branch = await git.currentBranch({ fs, dir: this.repoPath, fullname: false }) || 'main';

      // 获取修改的文件
      const modified = await this.getModifiedFiles();

      // 获取未跟踪的文件
      const untracked = await this.getUntrackedFiles();

      return {
        branch,
        ahead: 0, // TODO: 计算领先commits
        behind: 0, // TODO: 计算落后commits
        modified,
        untracked,
      };
    } catch (error) {
      console.error('[Git] 获取状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取修改的文件列表
   */
  private async getModifiedFiles(): Promise<string[]> {
    const statusMatrix = await git.statusMatrix({ fs, dir: this.repoPath });

    return statusMatrix
      .filter(([, head, workdir, stage]) => {
        // 修改: workdir !== head
        // 暂存: stage !== head
        return workdir !== head || stage !== head;
      })
      .map(([filepath]) => filepath);
  }

  /**
   * 获取未跟踪的文件列表
   */
  private async getUntrackedFiles(): Promise<string[]> {
    const statusMatrix = await git.statusMatrix({ fs, dir: this.repoPath });

    return statusMatrix
      .filter(([, head, workdir]) => {
        // 未跟踪: head === 0 && workdir !== 0
        return head === 0 && workdir !== 0;
      })
      .map(([filepath]) => filepath);
  }

  /**
   * 获取提交历史
   */
  async getLog(depth: number = 10): Promise<any[]> {
    try {
      const commits = await git.log({
        fs,
        dir: this.repoPath,
        depth,
      });

      return commits;
    } catch (error) {
      console.error('[Git] 获取日志失败:', error);
      return [];
    }
  }

  /**
   * 克隆远程仓库
   */
  async clone(url: string, auth?: { username: string; password: string }): Promise<void> {
    try {
      console.log('[Git] 克隆仓库:', url);

      await git.clone({
        fs,
        http: require('isomorphic-git/http/node'),
        dir: this.repoPath,
        url,
        singleBranch: true,
        depth: 1,
        onAuth: () => auth || { username: '', password: '' },
      });

      console.log('[Git] 克隆完成');
    } catch (error) {
      console.error('[Git] 克隆失败:', error);
      throw error;
    }
  }

  /**
   * 配置远程仓库
   */
  async setRemote(name: string, url: string): Promise<void> {
    try {
      await git.addRemote({
        fs,
        dir: this.repoPath,
        remote: name,
        url,
      });

      console.log(`[Git] 远程仓库 '${name}' 配置完成`);
    } catch (error) {
      console.error('[Git] 配置远程仓库失败:', error);
      throw error;
    }
  }
}
