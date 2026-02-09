/**
 * Social Store - 社交模块统一状态管理
 * 管理好友、聊天、动态、通知等社交功能的状态
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { createRetryableIPC } from '../utils/ipc';

// ==================== 类型定义 ====================

/**
 * 在线状态
 */
export type OnlineStatus = 'online' | 'offline' | 'away';

/**
 * 好友在线状态详情
 */
export interface FriendOnlineStatus {
  status: OnlineStatus;
  lastSeen?: number;
  deviceCount?: number;
}

/**
 * 好友
 */
export interface Friend {
  friend_did: string;
  nickname?: string;
  avatar?: string;
  onlineStatus?: FriendOnlineStatus | string;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 好友请求
 */
export interface FriendRequest {
  id: string;
  from_did: string;
  to_did: string;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: number;
  [key: string]: any;
}

/**
 * 聊天会话
 */
export interface ChatSession {
  id: string;
  participant_did: string;
  friend_nickname: string;
  last_message: string | null;
  last_message_time: number | null;
  unread_count: number;
  is_pinned: 0 | 1;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  senderDid: string;
  receiverDid: string;
  content: string;
  messageType: string;
  status: 'sent' | 'received' | 'failed' | 'pending';
  timestamp: number;
  [key: string]: any;
}

/**
 * 发送消息参数
 */
export interface SendMessageParams {
  content: string;
  type?: string;
}

/**
 * 接收消息数据
 */
export interface ReceivedMessageData {
  messageId: string;
  senderDid: string;
  content: string;
  messageType?: string;
  timestamp: number;
}

/**
 * 动态
 */
export interface Post {
  id: string;
  author_did: string;
  content: string;
  images?: string[];
  like_count: number;
  comment_count: number;
  is_liked: boolean;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 通知类型
 */
export type NotificationType = 'system' | 'message' | 'friend_request' | 'like' | 'comment';

/**
 * 通知
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  data?: string | null;
  is_read: 0 | 1;
  created_at: number;
  [key: string]: any;
}

/**
 * 添加通知参数
 */
export interface AddNotificationParams {
  type: NotificationType;
  title: string;
  content: string;
  data?: string | null;
}

/**
 * Social Store 状态
 */
export interface SocialState {
  // 好友相关
  friends: Friend[];
  friendRequests: FriendRequest[];
  onlineStatus: Map<string, OnlineStatus>;
  friendsLoading: boolean;

  // 聊天相关
  chatSessions: ChatSession[];
  currentChatSession: ChatSession | null;
  currentMessages: ChatMessage[];
  unreadCount: number;
  messagesLoading: boolean;

  // 动态相关
  posts: Post[];
  myPosts: Post[];
  postDrafts: Post[];
  postsLoading: boolean;

  // 通知相关
  notifications: Notification[];
  unreadNotifications: number;
  notificationsLoading: boolean;

  // UI状态
  chatWindowVisible: boolean;
  notificationPanelVisible: boolean;
}

// ==================== IPC 设置 ====================

// 创建带重试的 IPC 对象
const ipcRenderer = createRetryableIPC((window as any).electron?.ipcRenderer, {
  silentErrors: true, // 静默错误以避免控制台污染
});

// ==================== Store ====================

export const useSocialStore = defineStore('social', {
  state: (): SocialState => ({
    // ========== 好友相关 ==========
    friends: [], // 好友列表
    friendRequests: [], // 好友请求列表
    onlineStatus: new Map(), // 在线状态映射 { did: 'online' | 'offline' | 'away' }
    friendsLoading: false,

    // ========== 聊天相关 ==========
    chatSessions: [], // 聊天会话列表
    currentChatSession: null, // 当前打开的聊天会话
    currentMessages: [], // 当前聊天的消息列表
    unreadCount: 0, // 未读消息总数
    messagesLoading: false,

    // ========== 动态相关 ==========
    posts: [], // 动态列表
    myPosts: [], // 我的动态
    postDrafts: [], // 动态草稿
    postsLoading: false,

    // ========== 通知相关 ==========
    notifications: [], // 通知列表
    unreadNotifications: 0, // 未读通知数
    notificationsLoading: false,

    // ========== UI状态 ==========
    chatWindowVisible: false, // 聊天窗口是否可见
    notificationPanelVisible: false, // 通知面板是否可见
  }),

  getters: {
    /**
     * 总未读数（消息+通知）
     */
    totalUnreadCount(): number {
      return this.unreadCount + this.unreadNotifications;
    },

    /**
     * 在线好友列表
     */
    onlineFriends(): Friend[] {
      return this.friends.filter(
        (f) => this.onlineStatus.get(f.friend_did) === 'online'
      );
    },

    /**
     * 离线好友列表
     */
    offlineFriends(): Friend[] {
      return this.friends.filter(
        (f) => this.onlineStatus.get(f.friend_did) !== 'online'
      );
    },

    /**
     * 待处理的好友请求数
     */
    pendingRequestsCount(): number {
      return this.friendRequests.filter((r) => r.status === 'pending').length;
    },

    /**
     * 置顶的聊天会话
     */
    pinnedSessions(): ChatSession[] {
      return this.chatSessions.filter((s) => s.is_pinned === 1);
    },

    /**
     * 未读消息会话数
     */
    unreadSessionsCount(): number {
      return this.chatSessions.filter((s) => s.unread_count > 0).length;
    },

    /**
     * 未读通知列表
     */
    unreadNotificationsList(): Notification[] {
      return this.notifications.filter((n) => n.is_read === 0);
    },
  },

  actions: {
    // ========== 好友管理 ==========

    /**
     * 加载好友列表
     */
    async loadFriends(): Promise<void> {
      this.friendsLoading = true;
      try {
        const result = await ipcRenderer.invoke('friend:get-list');
        // 处理不同格式的返回值
        if (result && result.success !== false) {
          const friends = result.friends || result || [];
          this.friends = Array.isArray(friends) ? friends : [];

          // 加载好友在线状态
          for (const friend of this.friends) {
            let status: OnlineStatus = 'offline';
            if (friend.onlineStatus) {
              // 支持 onlineStatus 为对象或字符串
              status =
                typeof friend.onlineStatus === 'object'
                  ? (friend.onlineStatus as FriendOnlineStatus).status || 'offline'
                  : String(friend.onlineStatus) as OnlineStatus;
            }
            this.onlineStatus.set(friend.friend_did, status);
          }
        } else if (result && result.error) {
          // 服务返回错误但不是致命错误
          logger.warn('好友服务返回错误:', result.error);
          this.friends = [];
        }
      } catch (error: any) {
        // IPC 未就绪或其他错误，静默处理
        if (error?.message !== 'IPC not available') {
          logger.error('加载好友列表失败:', error);
        }
        this.friends = [];
      } finally {
        this.friendsLoading = false;
      }
    },

    /**
     * 加载好友请求
     */
    async loadFriendRequests(): Promise<void> {
      try {
        const requests = await ipcRenderer.invoke('friend:get-pending-requests');
        this.friendRequests = Array.isArray(requests) ? requests : [];
      } catch (error: any) {
        // IPC 未就绪或其他错误，静默处理
        if (error?.message !== 'IPC not available') {
          logger.error('加载好友请求失败:', error);
        }
        this.friendRequests = [];
      }
    },

    /**
     * 发送好友请求
     */
    async sendFriendRequest(friendDid: string, message: string): Promise<void> {
      try {
        await ipcRenderer.invoke('friend:send-request', friendDid, message);
        // 添加通知
        this.addNotification({
          type: 'system',
          title: '好友请求已发送',
          content: `已向 ${friendDid.substring(0, 16)}... 发送好友请求`,
        });
      } catch (error) {
        logger.error('发送好友请求失败:', error as any);
        throw error;
      }
    },

    /**
     * 接受好友请求
     */
    async acceptFriendRequest(requestId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('friend:accept-request', requestId);
        await this.loadFriends();
        await this.loadFriendRequests();

        this.addNotification({
          type: 'friend_request',
          title: '好友请求已接受',
          content: '你们现在是好友了',
        });
      } catch (error) {
        logger.error('接受好友请求失败:', error as any);
        throw error;
      }
    },

    /**
     * 拒绝好友请求
     */
    async rejectFriendRequest(requestId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('friend:reject-request', requestId);
        await this.loadFriendRequests();
      } catch (error) {
        logger.error('拒绝好友请求失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置好友在线状态
     */
    setFriendOnlineStatus(did: string, status: OnlineStatus): void {
      this.onlineStatus.set(did, status);
    },

    // ========== 聊天管理 ==========

    /**
     * 打开与好友的聊天
     */
    async openChatWithFriend(friend: Friend): Promise<void> {
      try {
        // 查找或创建聊天会话
        let session = (this.chatSessions || []).find(
          (s) => s?.participant_did === friend.friend_did
        );

        if (!session) {
          // 创建新会话
          const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          session = {
            id: sessionId,
            participant_did: friend.friend_did,
            friend_nickname:
              friend.nickname || friend.friend_did.substring(0, 16),
            last_message: null,
            last_message_time: null,
            unread_count: 0,
            is_pinned: 0,
            created_at: Date.now(),
            updated_at: Date.now(),
          };
          this.chatSessions.unshift(session);
        }

        this.currentChatSession = session;
        this.chatWindowVisible = true;

        // 加载聊天消息
        await this.loadMessages(session.id);

        // 标记为已读
        if (session.unread_count > 0) {
          await this.markAsRead(session.id);
        }
      } catch (error) {
        logger.error('打开聊天失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载聊天会话列表
     */
    async loadChatSessions(): Promise<void> {
      try {
        const sessions = await ipcRenderer.invoke('chat:get-sessions');
        this.chatSessions = Array.isArray(sessions) ? sessions : [];

        // 计算未读消息总数
        this.unreadCount = this.chatSessions.reduce(
          (sum, s) => sum + (s?.unread_count || 0),
          0
        );
      } catch (error: any) {
        // IPC 未就绪或其他错误，静默处理
        if (error?.message !== 'IPC not available') {
          logger.error('加载聊天会话失败:', error);
        }
        this.chatSessions = [];
        this.unreadCount = 0;
      }
    },

    /**
     * 加载聊天消息
     */
    async loadMessages(sessionId: string, limit: number = 50, offset: number = 0): Promise<void> {
      this.messagesLoading = true;
      try {
        const messages = await ipcRenderer.invoke(
          'chat:get-messages',
          sessionId,
          limit,
          offset
        );

        // 确保 messages 是数组
        const safeMessages: ChatMessage[] = Array.isArray(messages) ? messages : [];

        if (offset === 0) {
          this.currentMessages = safeMessages.reverse(); // 反转为时间升序
        } else {
          this.currentMessages = [
            ...safeMessages.reverse(),
            ...(this.currentMessages || []),
          ];
        }
      } catch (error) {
        logger.error('加载消息失败:', error as any);
      } finally {
        this.messagesLoading = false;
      }
    },

    /**
     * 发送消息
     */
    async sendMessage(message: SendMessageParams): Promise<ChatMessage> {
      try {
        const session = this.currentChatSession;
        if (!session) {
          throw new Error('没有打开的聊天会话');
        }

        // 生成消息ID
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const messageData: ChatMessage = {
          id: messageId,
          sessionId: session.id,
          senderDid: await this.getCurrentUserDid(),
          receiverDid: session.participant_did,
          content: message.content,
          messageType: message.type || 'text',
          status: 'sent',
          timestamp: Date.now(),
        };

        // 添加到当前消息列表（乐观更新）
        this.currentMessages.push(messageData);

        // 保存到数据库
        await ipcRenderer.invoke('chat:save-message', messageData);

        // 通过P2P发送加密消息
        await ipcRenderer.invoke(
          'p2p:send-encrypted-message',
          session.participant_did,
          {
            type: 'chat-message',
            messageId: messageId,
            content: message.content,
            messageType: message.type || 'text',
            timestamp: Date.now(),
          }
        );

        // 更新会话最后消息
        session.last_message = message.content;
        session.last_message_time = Date.now();
        session.updated_at = Date.now();

        return messageData;
      } catch (error) {
        logger.error('发送消息失败:', error as any);
        // 更新消息状态为失败
        const lastMessage = this.currentMessages[this.currentMessages.length - 1];
        if (lastMessage) {
          lastMessage.status = 'failed';
        }
        throw error;
      }
    },

    /**
     * 接收消息（由P2P消息监听器调用）
     */
    async receiveMessage(message: ReceivedMessageData): Promise<void> {
      try {
        // 查找或创建会话
        let session = (this.chatSessions || []).find(
          (s) => s?.participant_did === message.senderDid
        );

        if (!session) {
          // 创建新会话
          const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          session = {
            id: sessionId,
            participant_did: message.senderDid,
            friend_nickname: message.senderDid.substring(0, 16),
            last_message: message.content,
            last_message_time: message.timestamp,
            unread_count: 1,
            is_pinned: 0,
            created_at: Date.now(),
            updated_at: Date.now(),
          };
          this.chatSessions.unshift(session);
        } else {
          // 更新现有会话
          session.last_message = message.content;
          session.last_message_time = message.timestamp;
          session.updated_at = Date.now();

          // 如果不是当前会话，增加未读数
          if (
            !this.currentChatSession ||
            this.currentChatSession.id !== session.id
          ) {
            session.unread_count = (session.unread_count || 0) + 1;
            this.unreadCount++;
          }
        }

        // 保存消息到数据库
        const messageData: ChatMessage = {
          id: message.messageId,
          sessionId: session.id,
          senderDid: message.senderDid,
          receiverDid: await this.getCurrentUserDid(),
          content: message.content,
          messageType: message.messageType || 'text',
          status: 'received',
          timestamp: message.timestamp,
        };

        await ipcRenderer.invoke('chat:save-message', messageData);

        // 如果是当前会话，添加到消息列表
        if (
          this.currentChatSession &&
          this.currentChatSession.id === session.id
        ) {
          this.currentMessages.push(messageData);
        }

        // 发送桌面通知
        if (
          !this.currentChatSession ||
          this.currentChatSession.id !== session.id
        ) {
          this.addNotification({
            type: 'message',
            title: '新消息',
            content: `${session.friend_nickname}: ${message.content.substring(0, 50)}`,
            data: JSON.stringify({ sessionId: session.id }),
          });
        }
      } catch (error) {
        logger.error('接收消息失败:', error as any);
      }
    },

    /**
     * 标记会话为已读
     */
    async markAsRead(sessionId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('chat:mark-as-read', sessionId);

        const session = (this.chatSessions || []).find(
          (s) => s?.id === sessionId
        );
        if (session) {
          this.unreadCount -= session.unread_count || 0;
          session.unread_count = 0;
        }
      } catch (error) {
        logger.error('标记已读失败:', error as any);
      }
    },

    /**
     * 获取当前用户DID
     */
    async getCurrentUserDid(): Promise<string> {
      try {
        const identities = await ipcRenderer.invoke('did:get-identities');
        if (identities && identities.length > 0) {
          return identities[0].did;
        }
        throw new Error('未找到用户身份');
      } catch (error) {
        logger.error('获取当前用户DID失败:', error as any);
        return 'unknown';
      }
    },

    // ========== 动态管理 ==========

    /**
     * 加载动态列表
     */
    async loadPosts(filter: string = 'all'): Promise<void> {
      this.postsLoading = true;
      try {
        const posts = await ipcRenderer.invoke('post:get-feed', filter);
        this.posts = posts;
      } catch (error) {
        logger.error('加载动态失败:', error as any);
      } finally {
        this.postsLoading = false;
      }
    },

    /**
     * 创建动态
     */
    async createPost(post: Partial<Post>): Promise<Post> {
      try {
        const newPost = await ipcRenderer.invoke('post:create', post);
        this.posts.unshift(newPost);
        this.myPosts.unshift(newPost);
        return newPost;
      } catch (error) {
        logger.error('创建动态失败:', error as any);
        throw error;
      }
    },

    /**
     * 点赞动态
     */
    async likePost(postId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('post:like', postId);

        const post = (this.posts || []).find((p) => p?.id === postId);
        if (post) {
          post.like_count = (post.like_count || 0) + 1;
          post.is_liked = true;
        }
      } catch (error) {
        logger.error('点赞失败:', error as any);
        throw error;
      }
    },

    /**
     * 取消点赞
     */
    async unlikePost(postId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('post:unlike', postId);

        const post = (this.posts || []).find((p) => p?.id === postId);
        if (post) {
          post.like_count = Math.max((post.like_count || 0) - 1, 0);
          post.is_liked = false;
        }
      } catch (error) {
        logger.error('取消点赞失败:', error as any);
        throw error;
      }
    },

    // ========== 通知管理 ==========

    /**
     * 加载通知列表
     * @param limit - 加载数量限制
     * @param _retryCount - 内部使用的重试计数（不要手动传递）
     */
    async loadNotifications(limit: number = 50, _retryCount: number = 0): Promise<void> {
      const MAX_RETRIES = 3;

      this.notificationsLoading = true;
      try {
        // 检查IPC API是否可用
        if (!(window as any).electronAPI || !ipcRenderer) {
          logger.warn('[Social Store] Electron API 未就绪，跳过加载通知');
          this.notifications = [];
          this.unreadNotifications = 0;
          return;
        }

        const result = await ipcRenderer.invoke('notification:get-all', {
          limit,
        });
        const notifications: Notification[] = Array.isArray(result)
          ? result
          : result?.notifications || result?.data || [];

        this.notifications = notifications;
        this.unreadNotifications = notifications.filter(
          (n) => n.is_read === 0
        ).length;
      } catch (error) {
        const err = error as Error;
        // 如果是用户中断请求（页面刷新、导航等），静默处理
        if (err.message && err.message.includes('interrupted')) {
          logger.info('[Social Store] 通知加载被中断（用户操作）');
          this.notifications = [];
          this.unreadNotifications = 0;
          return;
        }

        // 如果是"No handler registered"错误，说明后端还未初始化完成
        if (err.message && err.message.includes('No handler registered')) {
          // 设置空数据，避免前端报错
          this.notifications = [];
          this.unreadNotifications = 0;

          // 检查是否超过最大重试次数
          if (_retryCount < MAX_RETRIES) {
            const delay = Math.min(2000 * Math.pow(2, _retryCount), 30000); // 指数退避，最大30秒
            logger.warn(
              `[Social Store] IPC处理器未注册，将在 ${delay / 1000}s 后重试 (${_retryCount + 1}/${MAX_RETRIES})`
            );

            setTimeout(() => {
              this.loadNotifications(limit, _retryCount + 1).catch(() => {
                // 静默处理，避免重复日志
              });
            }, delay);
          } else {
            logger.warn('[Social Store] 通知加载达到最大重试次数，放弃重试');
          }
        } else {
          // 其他错误，设置空数据
          this.notifications = [];
          this.unreadNotifications = 0;
        }
      } finally {
        this.notificationsLoading = false;
      }
    },

    /**
     * 添加通知
     */
    addNotification(notification: AddNotificationParams): void {
      const notificationData: Notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: notification.type,
        title: notification.title,
        content: notification.content,
        data: notification.data || null,
        is_read: 0,
        created_at: Date.now(),
      };

      this.notifications.unshift(notificationData);
      this.unreadNotifications++;

      // 发送桌面通知
      ipcRenderer.invoke(
        'notification:send-desktop',
        notification.title,
        notification.content
      );
    },

    /**
     * 标记通知为已读
     */
    async markNotificationAsRead(id: string): Promise<void> {
      try {
        await ipcRenderer.invoke('notification:mark-read', id);

        const notification = (this.notifications || []).find(
          (n) => n?.id === id
        );
        if (notification && notification.is_read === 0) {
          notification.is_read = 1;
          this.unreadNotifications = Math.max(this.unreadNotifications - 1, 0);
        }
      } catch (error) {
        logger.error('标记通知已读失败:', error as any);
      }
    },

    /**
     * 全部标记为已读
     */
    async markAllNotificationsAsRead(): Promise<void> {
      try {
        await ipcRenderer.invoke('notification:mark-all-read');

        (this.notifications || []).forEach((n) => {
          if (n) {
            n.is_read = 1;
          }
        });
        this.unreadNotifications = 0;
      } catch (error) {
        logger.error('全部标记已读失败:', error as any);
      }
    },

    /**
     * 清空所有通知
     */
    clearAllNotifications(): void {
      this.notifications = [];
      this.unreadNotifications = 0;
    },

    // ========== UI状态管理 ==========

    /**
     * 打开/关闭聊天窗口
     */
    toggleChatWindow(visible?: boolean): void {
      this.chatWindowVisible =
        visible !== undefined ? visible : !this.chatWindowVisible;
    },

    /**
     * 打开/关闭通知面板
     */
    toggleNotificationPanel(visible?: boolean): void {
      this.notificationPanelVisible =
        visible !== undefined ? visible : !this.notificationPanelVisible;
    },

    // ========== 在线状态管理 ==========

    /**
     * 初始化在线状态监听
     */
    initOnlineStatusListeners(): void {
      // 监听好友上线事件
      ipcRenderer.on('friend:online', (_event: any, data: { friendDid: string }) => {
        const { friendDid } = data;
        logger.info('[SocialStore] 好友上线:', friendDid);

        // 更新在线状态
        this.onlineStatus.set(friendDid, 'online');

        // 更新好友列表中的在线状态
        const friend = (this.friends || []).find(
          (f) => f?.friend_did === friendDid
        );
        if (friend) {
          if (!friend.onlineStatus || typeof friend.onlineStatus === 'string') {
            friend.onlineStatus = {} as FriendOnlineStatus;
          }
          (friend.onlineStatus as FriendOnlineStatus).status = 'online';
          (friend.onlineStatus as FriendOnlineStatus).lastSeen = Date.now();
          (friend.onlineStatus as FriendOnlineStatus).deviceCount =
            ((friend.onlineStatus as FriendOnlineStatus).deviceCount || 0) + 1;
        }

        // 添加通知
        if (friend) {
          this.addNotification({
            type: 'system',
            title: '好友上线',
            content: `${friend.nickname || friendDid.substring(0, 16)}... 已上线`,
          });
        }
      });

      // 监听好友离线事件
      ipcRenderer.on('friend:offline', (_event: any, data: { friendDid: string }) => {
        const { friendDid } = data;
        logger.info('[SocialStore] 好友离线:', friendDid);

        // 更新在线状态
        this.onlineStatus.set(friendDid, 'offline');

        // 更新好友列表中的在线状态
        const friend = (this.friends || []).find(
          (f) => f?.friend_did === friendDid
        );
        if (friend) {
          if (!friend.onlineStatus || typeof friend.onlineStatus === 'string') {
            friend.onlineStatus = {} as FriendOnlineStatus;
          }
          (friend.onlineStatus as FriendOnlineStatus).status = 'offline';
          (friend.onlineStatus as FriendOnlineStatus).lastSeen = Date.now();
          (friend.onlineStatus as FriendOnlineStatus).deviceCount = 0;
        }
      });

      logger.info('[SocialStore] 在线状态监听器已初始化');
    },

    /**
     * 移除在线状态监听
     */
    removeOnlineStatusListeners(): void {
      ipcRenderer.removeAllListeners('friend:online');
      ipcRenderer.removeAllListeners('friend:offline');
      logger.info('[SocialStore] 在线状态监听器已移除');
    },
  },
});
