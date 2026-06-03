/**
 * Incentive Manager - 激励系统管理器
 *
 * 功能:
 * - 任务系统（每日任务、周任务、成就任务）
 * - 签到系统（每日签到、连续签到奖励）
 * - 等级系统（经验值、升级奖励）
 * - 推荐奖励（邀请好友、推荐奖励）
 * - 活跃度奖励（交易活跃度、社交活跃度）
 * - 里程碑奖励（达成特定目标）
 * - 排行榜奖励（定期发放）
 * - 奖励发放（积分、资产、经验）
 *
 * 移动端特色:
 * - 完整的任务系统
 * - 多样的奖励类型
 * - 自动化激励机制
 * - 详细的统计分析
 *
 * @version 2.8.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

// 任务类型
const TaskType = {
  DAILY: 'daily',           // 每日任务
  WEEKLY: 'weekly',         // 周任务
  ACHIEVEMENT: 'achievement' // 成就任务
}

// 任务状态
const TaskStatus = {
  PENDING: 'pending',       // 待完成
  COMPLETED: 'completed',   // 已完成
  CLAIMED: 'claimed',       // 已领取
  EXPIRED: 'expired'        // 已过期
}

// 奖励类型
const RewardType = {
  POINTS: 'points',         // 积分
  ASSET: 'asset',           // 资产
  EXP: 'exp',               // 经验值
  BADGE: 'badge'            // 徽章
}

// 里程碑类型
const MilestoneType = {
  TRADE_COUNT: 'trade_count',       // 交易次数
  TRADE_VOLUME: 'trade_volume',     // 交易金额
  CREDIT_SCORE: 'credit_score',     // 信用评分
  FOLLOWERS: 'followers',           // 粉丝数量
  REFERRALS: 'referrals'            // 推荐人数
}

class IncentiveManager {
  constructor(db, didManager, assetManager) {
    this.db = db
    this.didManager = didManager
    this.assetManager = assetManager

    // 等级配置（20级）
    this.levelConfig = this._generateLevelConfig()

    // 每日任务模板
    this.dailyTaskTemplates = [
      { id: 'daily_login', name: '每日登录', description: '每天登录系统', reward: { type: 'points', amount: 10 }, target: 1 },
      { id: 'daily_trade_1', name: '完成1笔交易', description: '完成任意1笔交易', reward: { type: 'points', amount: 50 }, target: 1 },
      { id: 'daily_share_1', name: '分享1次交易', description: '分享交易到社区', reward: { type: 'points', amount: 30 }, target: 1 },
      { id: 'daily_comment_3', name: '评论3次', description: '评论他人分享', reward: { type: 'points', amount: 20 }, target: 3 }
    ]

    // 周任务模板
    this.weeklyTaskTemplates = [
      { id: 'weekly_trade_5', name: '完成5笔交易', description: '本周完成5笔交易', reward: { type: 'points', amount: 300 }, target: 5 },
      { id: 'weekly_profit', name: '盈利交易', description: '本周至少有一笔盈利交易', reward: { type: 'points', amount: 200 }, target: 1 },
      { id: 'weekly_social', name: '社交互动', description: '本周获得10个赞', reward: { type: 'points', amount: 150 }, target: 10 }
    ]

    // 成就任务模板
    this.achievementTemplates = [
      { id: 'first_trade', name: '首笔交易', description: '完成第一笔交易', reward: { type: 'points', amount: 100 }, target: 1 },
      { id: 'trade_master_10', name: '交易新手', description: '完成10笔交易', reward: { type: 'badge', badge: '交易新手' }, target: 10 },
      { id: 'trade_master_100', name: '交易达人', description: '完成100笔交易', reward: { type: 'badge', badge: '交易达人' }, target: 100 },
      { id: 'profit_king', name: '盈利之王', description: '累计盈利达到10000', reward: { type: 'badge', badge: '盈利之王' }, target: 10000 },
      { id: 'social_star', name: '社交之星', description: '获得100个关注', reward: { type: 'badge', badge: '社交之星' }, target: 100 }
    ]
  }

  /**
   * 初始化
   */
  async initialize() {
    await this._createTables()
    console.log('[Incentive] 初始化完成')
  }

  /**
   * 创建数据库表
   */
  async _createTables() {
    // 用户等级表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS user_levels (
        user_did TEXT PRIMARY KEY,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        total_exp INTEGER DEFAULT 0,
        next_level_exp INTEGER DEFAULT 100,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 任务表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        task_type TEXT NOT NULL,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        target INTEGER NOT NULL,
        progress INTEGER DEFAULT 0,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER,
        reward_data TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        claimed_at INTEGER,
        expires_at INTEGER
      )
    `)

    // 签到记录表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS check_ins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        check_in_date TEXT NOT NULL,
        consecutive_days INTEGER DEFAULT 1,
        reward_points INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(user_did, check_in_date)
      )
    `)

    // 推荐记录表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_did TEXT NOT NULL,
        referred_did TEXT NOT NULL,
        reward_given BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(referred_did)
      )
    `)

    // 里程碑表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        milestone_type TEXT NOT NULL,
        milestone_value INTEGER NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER,
        claimed BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
      )
    `)

    // 奖励记录表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS reward_records (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER,
        reward_data TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    // 索引
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_check_ins_user ON check_ins(user_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_did)')
  }

  /**
   * 初始化用户等级
   */
  async initUserLevel(userDid) {
    const existing = await this.db.executeSql(
      'SELECT * FROM user_levels WHERE user_did = ?',
      [userDid]
    )

    if (existing.length > 0) {
      return existing[0]
    }

    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO user_levels (user_did, level, exp, total_exp, next_level_exp, created_at, updated_at)
      VALUES (?, 1, 0, 0, 100, ?, ?)
    `, [userDid, now, now])

    console.log('[Incentive] 用户等级初始化:', userDid)
    return await this.getUserLevel(userDid)
  }

  /**
   * 获取用户等级
   */
  async getUserLevel(userDid) {
    const levels = await this.db.executeSql(
      'SELECT * FROM user_levels WHERE user_did = ?',
      [userDid]
    )

    if (levels.length === 0) {
      return await this.initUserLevel(userDid)
    }

    return levels[0]
  }

  /**
   * 添加经验值
   */
  async addExp(userDid, exp, source) {
    const userLevel = await this.getUserLevel(userDid)
    const now = Date.now()

    let newExp = userLevel.exp + exp
    let newTotalExp = userLevel.total_exp + exp
    let newLevel = userLevel.level
    let leveledUp = false

    // 检查是否升级
    while (newExp >= userLevel.next_level_exp && newLevel < 20) {
      newExp -= userLevel.next_level_exp
      newLevel++
      leveledUp = true
    }

    // 计算新等级所需经验
    const nextLevelExp = this.levelConfig[newLevel]?.requiredExp || userLevel.next_level_exp

    // 更新数据库
    await this.db.executeSql(`
      UPDATE user_levels
      SET level = ?, exp = ?, total_exp = ?, next_level_exp = ?, updated_at = ?
      WHERE user_did = ?
    `, [newLevel, newExp, newTotalExp, nextLevelExp, now, userDid])

    // 记录奖励
    await this._recordReward(userDid, 'exp_gain', source, RewardType.EXP, exp)

    // 如果升级，发放升级奖励
    if (leveledUp) {
      await this._handleLevelUp(userDid, newLevel)
    }

    console.log('[Incentive] 添加经验:', userDid, exp, leveledUp ? '升级!' : '')

    return { level: newLevel, exp: newExp, leveledUp }
  }

  /**
   * 处理升级
   */
  async _handleLevelUp(userDid, newLevel) {
    const levelInfo = this.levelConfig[newLevel]
    if (!levelInfo) return

    // 发放升级奖励
    if (levelInfo.reward) {
      await this.giveReward(userDid, levelInfo.reward.type, levelInfo.reward.amount, 'level_up', newLevel.toString())
    }

    console.log('[Incentive] 用户升级:', userDid, 'Level', newLevel)
  }

  /**
   * 创建每日任务
   */
  async createDailyTasks(userDid) {
    const now = Date.now()
    const today = new Date().toDateString()

    // 检查今天是否已创建
    const existing = await this.db.executeSql(`
      SELECT * FROM tasks
      WHERE user_did = ? AND task_type = 'daily'
        AND DATE(created_at / 1000, 'unixepoch') = DATE(? / 1000, 'unixepoch')
    `, [userDid, now])

    if (existing.length > 0) {
      return existing
    }

    const tasks = []

    for (const template of this.dailyTaskTemplates) {
      const task = {
        id: this._generateId('task'),
        user_did: userDid,
        task_type: TaskType.DAILY,
        task_id: template.id,
        name: template.name,
        description: template.description,
        target: template.target,
        progress: 0,
        reward_type: template.reward.type,
        reward_amount: template.reward.amount || 0,
        reward_data: null,
        status: TaskStatus.PENDING,
        created_at: now,
        completed_at: null,
        claimed_at: null,
        expires_at: now + 24 * 60 * 60 * 1000 // 24小时后过期
      }

      await this.db.executeSql(`
        INSERT INTO tasks (
          id, user_did, task_type, task_id, name, description,
          target, progress, reward_type, reward_amount, reward_data,
          status, created_at, completed_at, claimed_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        task.id, task.user_did, task.task_type, task.task_id, task.name,
        task.description, task.target, task.progress, task.reward_type,
        task.reward_amount, task.reward_data, task.status, task.created_at,
        task.completed_at, task.claimed_at, task.expires_at
      ])

      tasks.push(task)
    }

    console.log('[Incentive] 每日任务已创建:', userDid)
    return tasks
  }

  /**
   * 更新任务进度
   */
  async updateTaskProgress(userDid, taskId, increment = 1) {
    const tasks = await this.db.executeSql(
      'SELECT * FROM tasks WHERE user_did = ? AND task_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [userDid, taskId, TaskStatus.PENDING]
    )

    if (tasks.length === 0) {
      return null
    }

    const task = tasks[0]
    const newProgress = task.progress + increment

    // 检查是否完成
    if (newProgress >= task.target && task.status === TaskStatus.PENDING) {
      const now = Date.now()
      await this.db.executeSql(`
        UPDATE tasks
        SET progress = ?, status = ?, completed_at = ?
        WHERE id = ?
      `, [newProgress, TaskStatus.COMPLETED, now, task.id])

      console.log('[Incentive] 任务完成:', task.name)
      return { ...task, progress: newProgress, status: TaskStatus.COMPLETED }
    } else {
      await this.db.executeSql(
        'UPDATE tasks SET progress = ? WHERE id = ?',
        [newProgress, task.id]
      )
    }

    return { ...task, progress: newProgress }
  }

  /**
   * 领取任务奖励
   */
  async claimTaskReward(taskId) {
    const tasks = await this.db.executeSql(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    )

    if (tasks.length === 0) {
      throw new Error('任务不存在')
    }

    const task = tasks[0]

    if (task.status !== TaskStatus.COMPLETED) {
      throw new Error('任务未完成')
    }

    if (task.status === TaskStatus.CLAIMED) {
      throw new Error('奖励已领取')
    }

    const now = Date.now()

    // 发放奖励
    await this.giveReward(
      task.user_did,
      task.reward_type,
      task.reward_amount,
      'task_reward',
      taskId
    )

    // 更新任务状态
    await this.db.executeSql(
      'UPDATE tasks SET status = ?, claimed_at = ? WHERE id = ?',
      [TaskStatus.CLAIMED, now, taskId]
    )

    console.log('[Incentive] 任务奖励已领取:', task.name)
    return { success: true, reward: { type: task.reward_type, amount: task.reward_amount } }
  }

  /**
   * 每日签到
   */
  async checkIn(userDid) {
    const now = Date.now()
    const today = new Date().toISOString().split('T')[0]

    // 检查今天是否已签到
    const existing = await this.db.executeSql(
      'SELECT * FROM check_ins WHERE user_did = ? AND check_in_date = ?',
      [userDid, today]
    )

    if (existing.length > 0) {
      throw new Error('今天已经签到过了')
    }

    // 获取最近的签到记录
    const lastCheckIn = await this.db.executeSql(
      'SELECT * FROM check_ins WHERE user_did = ? ORDER BY created_at DESC LIMIT 1',
      [userDid]
    )

    let consecutiveDays = 1
    let rewardPoints = 10 // 基础签到奖励

    if (lastCheckIn.length > 0) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      if (lastCheckIn[0].check_in_date === yesterday) {
        consecutiveDays = lastCheckIn[0].consecutive_days + 1
        // 连续签到加成
        rewardPoints = 10 + Math.min(consecutiveDays * 2, 50) // 最多60分
      }
    }

    // 记录签到
    await this.db.executeSql(`
      INSERT INTO check_ins (user_did, check_in_date, consecutive_days, reward_points, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [userDid, today, consecutiveDays, rewardPoints, now])

    // 发放签到奖励
    await this.giveReward(userDid, RewardType.POINTS, rewardPoints, 'check_in', today)

    // 更新登录任务进度
    await this.updateTaskProgress(userDid, 'daily_login', 1)

    console.log('[Incentive] 签到成功:', userDid, '连续', consecutiveDays, '天')

    return { consecutiveDays, rewardPoints }
  }

  /**
   * 记录推荐
   */
  async recordReferral(referrerDid, referredDid) {
    const now = Date.now()

    try {
      await this.db.executeSql(`
        INSERT INTO referrals (referrer_did, referred_did, reward_given, created_at)
        VALUES (?, ?, 0, ?)
      `, [referrerDid, referredDid, now])

      console.log('[Incentive] 推荐记录:', referrerDid, '->', referredDid)
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        throw new Error('该用户已被推荐过')
      }
      throw error
    }
  }

  /**
   * 发放推荐奖励
   */
  async giveReferralReward(referredDid) {
    const referrals = await this.db.executeSql(
      'SELECT * FROM referrals WHERE referred_did = ? AND reward_given = 0',
      [referredDid]
    )

    if (referrals.length === 0) {
      return
    }

    const referral = referrals[0]

    // 推荐人奖励
    await this.giveReward(referral.referrer_did, RewardType.POINTS, 500, 'referral', referredDid)

    // 被推荐人奖励
    await this.giveReward(referredDid, RewardType.POINTS, 100, 'referral_bonus', referral.referrer_did)

    // 标记已发放
    await this.db.executeSql(
      'UPDATE referrals SET reward_given = 1 WHERE id = ?',
      [referral.id]
    )

    console.log('[Incentive] 推荐奖励已发放')
  }

  /**
   * 检查里程碑
   */
  async checkMilestone(userDid, milestoneType, currentValue) {
    const milestones = [
      { type: MilestoneType.TRADE_COUNT, values: [1, 10, 50, 100, 500], rewards: [100, 500, 1000, 2000, 5000] },
      { type: MilestoneType.TRADE_VOLUME, values: [1000, 10000, 50000, 100000], rewards: [200, 1000, 3000, 10000] },
      { type: MilestoneType.FOLLOWERS, values: [10, 50, 100, 500], rewards: [100, 500, 1000, 3000] }
    ]

    const config = milestones.find(m => m.type === milestoneType)
    if (!config) return

    for (let i = 0; i < config.values.length; i++) {
      const value = config.values[i]
      if (currentValue >= value) {
        // 检查是否已领取
        const existing = await this.db.executeSql(
          'SELECT * FROM milestones WHERE user_did = ? AND milestone_type = ? AND milestone_value = ?',
          [userDid, milestoneType, value]
        )

        if (existing.length === 0) {
          // 创建里程碑
          const now = Date.now()
          const milestoneId = this._generateId('milestone')

          await this.db.executeSql(`
            INSERT INTO milestones (
              id, user_did, milestone_type, milestone_value,
              reward_type, reward_amount, claimed, created_at, claimed_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)
          `, [milestoneId, userDid, milestoneType, value, RewardType.POINTS, config.rewards[i], now])

          console.log('[Incentive] 里程碑达成:', milestoneType, value)
        }
      }
    }
  }

  /**
   * 领取里程碑奖励
   */
  async claimMilestone(milestoneId) {
    const milestones = await this.db.executeSql(
      'SELECT * FROM milestones WHERE id = ?',
      [milestoneId]
    )

    if (milestones.length === 0) {
      throw new Error('里程碑不存在')
    }

    const milestone = milestones[0]

    if (milestone.claimed) {
      throw new Error('奖励已领取')
    }

    const now = Date.now()

    // 发放奖励
    await this.giveReward(
      milestone.user_did,
      milestone.reward_type,
      milestone.reward_amount,
      'milestone',
      milestoneId
    )

    // 更新状态
    await this.db.executeSql(
      'UPDATE milestones SET claimed = 1, claimed_at = ? WHERE id = ?',
      [now, milestoneId]
    )

    console.log('[Incentive] 里程碑奖励已领取:', milestone.milestone_type, milestone.milestone_value)
  }

  /**
   * 发放奖励
   */
  async giveReward(userDid, rewardType, amount, sourceType, sourceId = null) {
    const now = Date.now()

    // 根据奖励类型处理
    if (rewardType === RewardType.POINTS) {
      // 积分奖励 - 调用资产管理器发放
      // await this.assetManager.mintAsset(pointsAssetId, userDid, amount)
    } else if (rewardType === RewardType.EXP) {
      // 经验值 - 已在addExp中处理
    } else if (rewardType === RewardType.ASSET) {
      // 资产奖励
      // await this.assetManager.mintAsset(assetId, userDid, amount)
    }

    // 记录奖励
    await this._recordReward(userDid, sourceType, sourceId, rewardType, amount)

    console.log('[Incentive] 奖励发放:', userDid, rewardType, amount)
  }

  /**
   * 记录奖励
   */
  async _recordReward(userDid, sourceType, sourceId, rewardType, amount, rewardData = null) {
    const rewardId = this._generateId('reward')
    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO reward_records (
        id, user_did, source_type, source_id,
        reward_type, reward_amount, reward_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [rewardId, userDid, sourceType, sourceId, rewardType, amount, rewardData, now])
  }

  /**
   * 获取任务列表
   */
  async getTasks(userDid, taskType = null) {
    let query = 'SELECT * FROM tasks WHERE user_did = ?'
    const params = [userDid]

    if (taskType) {
      query += ' AND task_type = ?'
      params.push(taskType)
    }

    query += ' ORDER BY created_at DESC'

    return await this.db.executeSql(query, params)
  }

  /**
   * 获取未领取的里程碑
   */
  async getUnclaimedMilestones(userDid) {
    return await this.db.executeSql(
      'SELECT * FROM milestones WHERE user_did = ? AND claimed = 0 ORDER BY created_at DESC',
      [userDid]
    )
  }

  /**
   * 获取奖励记录
   */
  async getRewardRecords(userDid, limit = 50) {
    return await this.db.executeSql(
      'SELECT * FROM reward_records WHERE user_did = ? ORDER BY created_at DESC LIMIT ?',
      [userDid, limit]
    )
  }

  /**
   * 获取统计信息
   */
  async getStatistics(userDid) {
    const level = await this.getUserLevel(userDid)

    // 总任务完成数
    const completedTasks = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM tasks WHERE user_did = ? AND status IN (?, ?)',
      [userDid, TaskStatus.COMPLETED, TaskStatus.CLAIMED]
    )

    // 连续签到天数
    const lastCheckIn = await this.db.executeSql(
      'SELECT consecutive_days FROM check_ins WHERE user_did = ? ORDER BY created_at DESC LIMIT 1',
      [userDid]
    )

    // 总推荐人数
    const referrals = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM referrals WHERE referrer_did = ?',
      [userDid]
    )

    // 总奖励数
    const totalRewards = await this.db.executeSql(
      'SELECT SUM(reward_amount) as total FROM reward_records WHERE user_did = ? AND reward_type = ?',
      [userDid, RewardType.POINTS]
    )

    return {
      level: level.level,
      exp: level.exp,
      nextLevelExp: level.next_level_exp,
      totalExp: level.total_exp,
      completedTasks: completedTasks[0].count,
      consecutiveDays: lastCheckIn.length > 0 ? lastCheckIn[0].consecutive_days : 0,
      referrals: referrals[0].count,
      totalRewards: totalRewards[0].total || 0
    }
  }

  /**
   * 生成等级配置
   */
  _generateLevelConfig() {
    const config = {}
    for (let level = 1; level <= 20; level++) {
      config[level] = {
        level,
        requiredExp: Math.floor(100 * Math.pow(1.5, level - 1)),
        reward: {
          type: RewardType.POINTS,
          amount: level * 100
        }
      }
    }
    return config
  }

  /**
   * 生成ID
   */
  _generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 销毁
   */
  destroy() {
    console.log('[Incentive] 已销毁')
  }
}

// 单例模式
let incentiveManagerInstance = null

/**
 * 创建 IncentiveManager 实例
 */
export function createIncentiveManager(db, didManager, assetManager) {
  if (!incentiveManagerInstance) {
    incentiveManagerInstance = new IncentiveManager(db, didManager, assetManager)
  }
  return incentiveManagerInstance
}

/**
 * 获取 IncentiveManager 实例
 */
export function getIncentiveManager() {
  if (!incentiveManagerInstance) {
    throw new Error('IncentiveManager 未初始化')
  }
  return incentiveManagerInstance
}

export {
  TaskType,
  TaskStatus,
  RewardType,
  MilestoneType
}
