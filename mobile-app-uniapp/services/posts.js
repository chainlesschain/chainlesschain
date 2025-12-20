/**
 * 社交动态服务
 *
 * 功能：
 * - 发布动态
 * - 动态时间线（好友动态流）
 * - 点赞和评论
 * - 动态隐私控制
 */

import database from './database'
import didService from './did'
import friendService from './friends'

class PostsService {
  constructor() {
    this.posts = []
    this.myPosts = []
  }

  /**
   * 初始化动态服务
   */
  async init() {
    try {
      // 确保数据库已初始化
      if (!database.isOpen) {
        console.log('[PostsService] 数据库未初始化，尝试初始化...')
        await database.initWithoutPin()
      }

      await this.loadTimeline()
      console.log('动态服务初始化完成')
    } catch (error) {
      console.error('动态服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 发布动态
   * @param {Object} postData - 动态内容
   * @returns {Promise<Object>}
   */
  async createPost(postData) {
    try {
      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      const { content, images = [], visibility = 'friends' } = postData

      if (!content || content.trim().length === 0) {
        throw new Error('动态内容不能为空')
      }

      // 创建动态记录
      const post = {
        id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        authorDid: currentIdentity.did,
        content: content.trim(),
        images: images,
        visibility: visibility, // 'public', 'friends', 'private'
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // 对动态进行签名（证明是本人发布）
      const signatureData = `${post.id}:${post.authorDid}:${post.createdAt}`
      post.signature = await didService.signMessage(signatureData)

      // 保存到数据库
      await database.savePost(post)

      // 重新加载动态
      await this.loadMyPosts()

      // TODO: 通过WebSocket广播给好友（Week 3-4后期实现）

      return {
        success: true,
        post
      }
    } catch (error) {
      console.error('发布动态失败:', error)
      throw error
    }
  }

  /**
   * 获取时间线（好友动态）
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getTimeline(options = {}) {
    try {
      const { limit = 20, offset = 0 } = options

      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        return []
      }

      // 获取好友列表
      const friends = await friendService.getFriends()
      const friendDids = friends.map(f => f.friendDid)

      // 添加自己
      friendDids.push(currentIdentity.did)

      // 获取好友动态
      const posts = await database.getPostsByAuthors(friendDids, {
        limit,
        offset
      })

      // 为每个动态获取作者信息
      for (const post of posts) {
        try {
          // 获取作者DID文档
          const authorDidDoc = await didService.resolveDID(post.authorDid)
          post.authorInfo = authorDidDoc

          // 如果是好友，获取好友信息
          if (post.authorDid !== currentIdentity.did) {
            const friend = friends.find(f => f.friendDid === post.authorDid)
            if (friend) {
              post.friendInfo = friend
            }
          }

          // 检查是否已点赞
          post.isLiked = await this.hasLiked(post.id)

          // 获取评论列表
          post.comments = await this.getComments(post.id, { limit: 3 })
        } catch (error) {
          console.error(`加载动态 ${post.id} 的信息失败:`, error)
        }
      }

      return posts
    } catch (error) {
      console.error('获取时间线失败:', error)
      return []
    }
  }

  /**
   * 获取我的动态
   * @returns {Promise<Array>}
   */
  async getMyPosts() {
    try {
      await this.loadMyPosts()
      return [...this.myPosts]
    } catch (error) {
      console.error('获取我的动态失败:', error)
      return []
    }
  }

  /**
   * 获取动态详情
   * @param {string} postId - 动态ID
   * @returns {Promise<Object>}
   */
  async getPost(postId) {
    try {
      const post = await database.getPostById(postId)

      if (!post) {
        throw new Error('动态不存在')
      }

      // 加载作者信息
      const authorDidDoc = await didService.resolveDID(post.authorDid)
      post.authorInfo = authorDidDoc

      // 加载点赞状态
      post.isLiked = await this.hasLiked(postId)

      // 加载所有评论
      post.comments = await this.getComments(postId)

      return post
    } catch (error) {
      console.error('获取动态详情失败:', error)
      throw error
    }
  }

  /**
   * 点赞动态
   * @param {string} postId - 动态ID
   * @returns {Promise<Object>}
   */
  async likePost(postId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 检查是否已点赞
      const hasLiked = await this.hasLiked(postId)
      if (hasLiked) {
        throw new Error('已经点赞过了')
      }

      // 创建点赞记录
      const like = {
        id: `like_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        postId: postId,
        userDid: currentIdentity.did,
        createdAt: new Date().toISOString()
      }

      // 保存点赞
      await database.saveLike(like)

      // 更新动态的点赞数
      await database.incrementPostLikeCount(postId)

      return {
        success: true,
        like
      }
    } catch (error) {
      console.error('点赞失败:', error)
      throw error
    }
  }

  /**
   * 取消点赞
   * @param {string} postId - 动态ID
   * @returns {Promise<Object>}
   */
  async unlikePost(postId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 删除点赞记录
      await database.deleteLike(postId, currentIdentity.did)

      // 更新动态的点赞数
      await database.decrementPostLikeCount(postId)

      return {
        success: true
      }
    } catch (error) {
      console.error('取消点赞失败:', error)
      throw error
    }
  }

  /**
   * 检查是否已点赞
   * @param {string} postId - 动态ID
   * @returns {Promise<boolean>}
   */
  async hasLiked(postId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        return false
      }

      const like = await database.getLike(postId, currentIdentity.did)
      return !!like
    } catch (error) {
      console.error('检查点赞状态失败:', error)
      return false
    }
  }

  /**
   * 评论动态
   * @param {string} postId - 动态ID
   * @param {string} content - 评论内容
   * @returns {Promise<Object>}
   */
  async commentPost(postId, content) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      if (!content || content.trim().length === 0) {
        throw new Error('评论内容不能为空')
      }

      // 创建评论记录
      const comment = {
        id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        postId: postId,
        authorDid: currentIdentity.did,
        content: content.trim(),
        createdAt: new Date().toISOString()
      }

      // 保存评论
      await database.saveComment(comment)

      // 更新动态的评论数
      await database.incrementPostCommentCount(postId)

      return {
        success: true,
        comment
      }
    } catch (error) {
      console.error('评论失败:', error)
      throw error
    }
  }

  /**
   * 获取评论列表
   * @param {string} postId - 动态ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getComments(postId, options = {}) {
    try {
      const { limit = 100, offset = 0 } = options

      const comments = await database.getPostComments(postId, {
        limit,
        offset
      })

      // 为每个评论获取作者信息
      for (const comment of comments) {
        try {
          const authorDidDoc = await didService.resolveDID(comment.authorDid)
          comment.authorInfo = authorDidDoc

          // 尝试获取好友信息
          const friends = await friendService.getFriends()
          const friend = friends.find(f => f.friendDid === comment.authorDid)
          if (friend) {
            comment.friendInfo = friend
          }
        } catch (error) {
          console.error(`加载评论 ${comment.id} 的作者信息失败:`, error)
        }
      }

      return comments
    } catch (error) {
      console.error('获取评论列表失败:', error)
      return []
    }
  }

  /**
   * 删除动态
   * @param {string} postId - 动态ID
   * @returns {Promise<Object>}
   */
  async deletePost(postId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 获取动态
      const post = await database.getPostById(postId)
      if (!post) {
        throw new Error('动态不存在')
      }

      // 检查权限
      if (post.authorDid !== currentIdentity.did) {
        throw new Error('只能删除自己的动态')
      }

      // 删除动态（软删除或硬删除）
      await database.deletePost(postId)

      // 重新加载
      await this.loadMyPosts()

      return {
        success: true
      }
    } catch (error) {
      console.error('删除动态失败:', error)
      throw error
    }
  }

  /**
   * 删除评论
   * @param {string} commentId - 评论ID
   * @returns {Promise<Object>}
   */
  async deleteComment(commentId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 获取评论
      const comment = await database.getCommentById(commentId)
      if (!comment) {
        throw new Error('评论不存在')
      }

      // 检查权限（评论作者或动态作者可以删除）
      const post = await database.getPostById(comment.postId)
      if (comment.authorDid !== currentIdentity.did && post.authorDid !== currentIdentity.did) {
        throw new Error('没有权限删除此评论')
      }

      // 删除评论
      await database.deleteComment(commentId)

      // 更新动态的评论数
      await database.decrementPostCommentCount(comment.postId)

      return {
        success: true
      }
    } catch (error) {
      console.error('删除评论失败:', error)
      throw error
    }
  }

  /**
   * 加载时间线
   * @private
   */
  async loadTimeline() {
    try {
      this.posts = await this.getTimeline()
    } catch (error) {
      console.error('加载时间线失败:', error)
      this.posts = []
    }
  }

  /**
   * 加载我的动态
   * @private
   */
  async loadMyPosts() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.myPosts = []
        return
      }

      this.myPosts = await database.getPostsByAuthor(currentIdentity.did)
    } catch (error) {
      console.error('加载我的动态失败:', error)
      this.myPosts = []
    }
  }

  /**
   * 获取动态统计
   * @returns {Promise<Object>}
   */
  async getStatistics() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        return {
          totalPosts: 0,
          totalLikes: 0,
          totalComments: 0
        }
      }

      const myPosts = await database.getPostsByAuthor(currentIdentity.did)

      const totalLikes = myPosts.reduce((sum, post) => sum + (post.likeCount || 0), 0)
      const totalComments = myPosts.reduce((sum, post) => sum + (post.commentCount || 0), 0)

      return {
        totalPosts: myPosts.length,
        totalLikes,
        totalComments
      }
    } catch (error) {
      console.error('获取统计信息失败:', error)
      return {
        totalPosts: 0,
        totalLikes: 0,
        totalComments: 0
      }
    }
  }
}

// 导出单例
export default new PostsService()
