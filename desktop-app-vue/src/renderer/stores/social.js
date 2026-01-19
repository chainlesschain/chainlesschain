import { logger, createLogger } from '@/utils/logger';
import { defineStore } from "pinia";
import { createRetryableIPC } from "../utils/ipc";

// 创建带重试的 IPC 对象
const ipcRenderer = createRetryableIPC(window.electron?.ipcRenderer, {
  silentErrors: true, // 静默错误以避免控制台污染
});

/**
 * 社交模块统一状态管理
 * 管理好友、聊天、动态、通知等社交功能的状态
 */
export const useSocialStore = defineStore("social", {
  state: () => ({
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
    totalUnreadCount: (state) => state.unreadCount + state.unreadNotifications,

    /**
     * 在线好友列表
     */
    onlineFriends: (state) =>
      state.friends.filter(
        (f) => state.onlineStatus.get(f.friend_did) === "online",
      ),

    /**
     * 离线好友列表
     */
    offlineFriends: (state) =>
      state.friends.filter(
        (f) => state.onlineStatus.get(f.friend_did) !== "online",
      ),

    /**
     * 待处理的好友请求数
     */
    pendingRequestsCount: (state) =>
      state.friendRequests.filter((r) => r.status === "pending").length,

    /**
     * 置顶的聊天会话
     */
    pinnedSessions: (state) =>
      state.chatSessions.filter((s) => s.is_pinned === 1),

    /**
     * 未读消息会话数
     */
    unreadSessionsCount: (state) =>
      state.chatSessions.filter((s) => s.unread_count > 0).length,

    /**
     * 未读通知列表
     */
    unreadNotificationsList: (state) =>
      state.notifications.filter((n) => n.is_read === 0),
  },

  actions: {
    // ========== 好友管理 ==========

    /**
     * 加载好友列表
     */
    async loadFriends() {
      this.friendsLoading = true;
      try {
        const result = await ipcRenderer.invoke("friend:get-list");
        if (result.success) {
          this.friends = result.friends || [];

          // 加载好友在线状态
          for (const friend of this.friends) {
            if (friend.onlineStatus) {
              this.onlineStatus.set(
                friend.friend_did,
                friend.onlineStatus.status || "offline",
              );
            } else {
              this.onlineStatus.set(friend.friend_did, "offline");
            }
          }
        }
      } catch (error) {
        logger.error("加载好友列表失败:", error);
      } finally {
        this.friendsLoading = false;
      }
    },

    /**
     * 加载好友请求
     */
    async loadFriendRequests() {
      try {
        const requests = await ipcRenderer.invoke(
          "friend:get-pending-requests",
        );
        this.friendRequests = requests;
      } catch (error) {
        logger.error("加载好友请求失败:", error);
      }
    },

    /**
     * 发送好友请求
     */
    async sendFriendRequest(friendDid, message) {
      try {
        await ipcRenderer.invoke("friend:send-request", friendDid, message);
        // 添加通知
        this.addNotification({
          type: "system",
          title: "好友请求已发送",
          content: `已向 ${friendDid.substring(0, 16)}... 发送好友请求`,
        });
      } catch (error) {
        logger.error("发送好友请求失败:", error);
        throw error;
      }
    },

    /**
     * 接受好友请求
     */
    async acceptFriendRequest(requestId) {
      try {
        await ipcRenderer.invoke("friend:accept-request", requestId);
        await this.loadFriends();
        await this.loadFriendRequests();

        this.addNotification({
          type: "friend_request",
          title: "好友请求已接受",
          content: "你们现在是好友了",
        });
      } catch (error) {
        logger.error("接受好友请求失败:", error);
        throw error;
      }
    },

    /**
     * 拒绝好友请求
     */
    async rejectFriendRequest(requestId) {
      try {
        await ipcRenderer.invoke("friend:reject-request", requestId);
        await this.loadFriendRequests();
      } catch (error) {
        logger.error("拒绝好友请求失败:", error);
        throw error;
      }
    },

    /**
     * 设置好友在线状态
     */
    setFriendOnlineStatus(did, status) {
      this.onlineStatus.set(did, status);
    },

    // ========== 聊天管理 ==========

    /**
     * 打开与好友的聊天
     */
    async openChatWithFriend(friend) {
      try {
        // 查找或创建聊天会话
        let session = this.chatSessions.find(
          (s) => s.participant_did === friend.friend_did,
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
        logger.error("打开聊天失败:", error);
        throw error;
      }
    },

    /**
     * 加载聊天会话列表
     */
    async loadChatSessions() {
      try {
        const sessions = await ipcRenderer.invoke("chat:get-sessions");
        this.chatSessions = sessions;

        // 计算未读消息总数
        this.unreadCount = sessions.reduce(
          (sum, s) => sum + (s.unread_count || 0),
          0,
        );
      } catch (error) {
        logger.error("加载聊天会话失败:", error);
      }
    },

    /**
     * 加载聊天消息
     */
    async loadMessages(sessionId, limit = 50, offset = 0) {
      this.messagesLoading = true;
      try {
        const messages = await ipcRenderer.invoke(
          "chat:get-messages",
          sessionId,
          limit,
          offset,
        );

        if (offset === 0) {
          this.currentMessages = messages.reverse(); // 反转为时间升序
        } else {
          this.currentMessages = [
            ...messages.reverse(),
            ...this.currentMessages,
          ];
        }
      } catch (error) {
        logger.error("加载消息失败:", error);
      } finally {
        this.messagesLoading = false;
      }
    },

    /**
     * 发送消息
     */
    async sendMessage(message) {
      try {
        const session = this.currentChatSession;
        if (!session) {
          throw new Error("没有打开的聊天会话");
        }

        // 生成消息ID
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const messageData = {
          id: messageId,
          sessionId: session.id,
          senderDid: await this.getCurrentUserDid(),
          receiverDid: session.participant_did,
          content: message.content,
          messageType: message.type || "text",
          status: "sent",
          timestamp: Date.now(),
        };

        // 添加到当前消息列表（乐观更新）
        this.currentMessages.push(messageData);

        // 保存到数据库
        await ipcRenderer.invoke("chat:save-message", messageData);

        // 通过P2P发送加密消息
        await ipcRenderer.invoke(
          "p2p:send-encrypted-message",
          session.participant_did,
          {
            type: "chat-message",
            messageId: messageId,
            content: message.content,
            messageType: message.type || "text",
            timestamp: Date.now(),
          },
        );

        // 更新会话最后消息
        session.last_message = message.content;
        session.last_message_time = Date.now();
        session.updated_at = Date.now();

        return messageData;
      } catch (error) {
        logger.error("发送消息失败:", error);
        // 更新消息状态为失败
        const lastMessage =
          this.currentMessages[this.currentMessages.length - 1];
        if (lastMessage) {
          lastMessage.status = "failed";
        }
        throw error;
      }
    },

    /**
     * 接收消息（由P2P消息监听器调用）
     */
    async receiveMessage(message) {
      try {
        // 查找或创建会话
        let session = this.chatSessions.find(
          (s) => s.participant_did === message.senderDid,
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
        const messageData = {
          id: message.messageId,
          sessionId: session.id,
          senderDid: message.senderDid,
          receiverDid: await this.getCurrentUserDid(),
          content: message.content,
          messageType: message.messageType || "text",
          status: "received",
          timestamp: message.timestamp,
        };

        await ipcRenderer.invoke("chat:save-message", messageData);

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
            type: "message",
            title: "新消息",
            content: `${session.friend_nickname}: ${message.content.substring(0, 50)}`,
            data: JSON.stringify({ sessionId: session.id }),
          });
        }
      } catch (error) {
        logger.error("接收消息失败:", error);
      }
    },

    /**
     * 标记会话为已读
     */
    async markAsRead(sessionId) {
      try {
        await ipcRenderer.invoke("chat:mark-as-read", sessionId);

        const session = this.chatSessions.find((s) => s.id === sessionId);
        if (session) {
          this.unreadCount -= session.unread_count || 0;
          session.unread_count = 0;
        }
      } catch (error) {
        logger.error("标记已读失败:", error);
      }
    },

    /**
     * 获取当前用户DID
     */
    async getCurrentUserDid() {
      try {
        const identities = await ipcRenderer.invoke("did:get-identities");
        if (identities && identities.length > 0) {
          return identities[0].did;
        }
        throw new Error("未找到用户身份");
      } catch (error) {
        logger.error("获取当前用户DID失败:", error);
        return "unknown";
      }
    },

    // ========== 动态管理 ==========

    /**
     * 加载动态列表
     */
    async loadPosts(filter = "all") {
      this.postsLoading = true;
      try {
        const posts = await ipcRenderer.invoke("post:get-feed", filter);
        this.posts = posts;
      } catch (error) {
        logger.error("加载动态失败:", error);
      } finally {
        this.postsLoading = false;
      }
    },

    /**
     * 创建动态
     */
    async createPost(post) {
      try {
        const newPost = await ipcRenderer.invoke("post:create", post);
        this.posts.unshift(newPost);
        this.myPosts.unshift(newPost);
        return newPost;
      } catch (error) {
        logger.error("创建动态失败:", error);
        throw error;
      }
    },

    /**
     * 点赞动态
     */
    async likePost(postId) {
      try {
        await ipcRenderer.invoke("post:like", postId);

        const post = this.posts.find((p) => p.id === postId);
        if (post) {
          post.like_count = (post.like_count || 0) + 1;
          post.is_liked = true;
        }
      } catch (error) {
        logger.error("点赞失败:", error);
        throw error;
      }
    },

    /**
     * 取消点赞
     */
    async unlikePost(postId) {
      try {
        await ipcRenderer.invoke("post:unlike", postId);

        const post = this.posts.find((p) => p.id === postId);
        if (post) {
          post.like_count = Math.max((post.like_count || 0) - 1, 0);
          post.is_liked = false;
        }
      } catch (error) {
        logger.error("取消点赞失败:", error);
        throw error;
      }
    },

    // ========== 通知管理 ==========

    /**
     * 加载通知列表
     */
    async loadNotifications(limit = 50) {
      this.notificationsLoading = true;
      try {
        // 检查IPC API是否可用
        if (!window.electronAPI || !ipcRenderer) {
          logger.warn("[Social Store] Electron API 未就绪，跳过加载通知");
          this.notifications = [];
          this.unreadNotifications = 0;
          return;
        }

        const result = await ipcRenderer.invoke("notification:get-all", {
          limit,
        });
        const notifications = Array.isArray(result)
          ? result
          : result?.notifications || result?.data || [];

        this.notifications = notifications;
        this.unreadNotifications = notifications.filter(
          (n) => n.is_read === 0,
        ).length;
      } catch (error) {
        // 如果是用户中断请求（页面刷新、导航等），静默处理
        if (error.message && error.message.includes("interrupted")) {
          logger.info("[Social Store] 通知加载被中断（用户操作）");
          this.notifications = [];
          this.unreadNotifications = 0;
          return;
        }

        logger.error("加载通知失败:", error);

        // 如果是"No handler registered"错误，说明后端还未初始化完成
        if (error.message && error.message.includes("No handler registered")) {
          logger.warn("[Social Store] IPC处理器未注册，将在稍后重试");
          // 设置空数据，避免前端报错
          this.notifications = [];
          this.unreadNotifications = 0;

          // 延迟重试一次
          setTimeout(() => {
            logger.info("[Social Store] 重试加载通知...");
            this.loadNotifications(limit).catch((err) => {
              logger.error("[Social Store] 重试加载通知失败:", err);
            });
          }, 2000);
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
    addNotification(notification) {
      const notificationData = {
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
        "notification:send-desktop",
        notification.title,
        notification.content,
      );
    },

    /**
     * 标记通知为已读
     */
    async markNotificationAsRead(id) {
      try {
        await ipcRenderer.invoke("notification:mark-read", id);

        const notification = this.notifications.find((n) => n.id === id);
        if (notification && notification.is_read === 0) {
          notification.is_read = 1;
          this.unreadNotifications = Math.max(this.unreadNotifications - 1, 0);
        }
      } catch (error) {
        logger.error("标记通知已读失败:", error);
      }
    },

    /**
     * 全部标记为已读
     */
    async markAllNotificationsAsRead() {
      try {
        await ipcRenderer.invoke("notification:mark-all-read");

        this.notifications.forEach((n) => {
          n.is_read = 1;
        });
        this.unreadNotifications = 0;
      } catch (error) {
        logger.error("全部标记已读失败:", error);
      }
    },

    /**
     * 清空所有通知
     */
    clearAllNotifications() {
      this.notifications = [];
      this.unreadNotifications = 0;
    },

    // ========== UI状态管理 ==========

    /**
     * 打开/关闭聊天窗口
     */
    toggleChatWindow(visible) {
      this.chatWindowVisible =
        visible !== undefined ? visible : !this.chatWindowVisible;
    },

    /**
     * 打开/关闭通知面板
     */
    toggleNotificationPanel(visible) {
      this.notificationPanelVisible =
        visible !== undefined ? visible : !this.notificationPanelVisible;
    },

    // ========== 在线状态管理 ==========

    /**
     * 初始化在线状态监听
     */
    initOnlineStatusListeners() {
      // 监听好友上线事件
      ipcRenderer.on("friend:online", (_event, data) => {
        const { friendDid } = data;
        logger.info("[SocialStore] 好友上线:", friendDid);

        // 更新在线状态
        this.onlineStatus.set(friendDid, "online");

        // 更新好友列表中的在线状态
        const friend = this.friends.find((f) => f.friend_did === friendDid);
        if (friend) {
          if (!friend.onlineStatus) {
            friend.onlineStatus = {};
          }
          friend.onlineStatus.status = "online";
          friend.onlineStatus.lastSeen = Date.now();
          friend.onlineStatus.deviceCount =
            (friend.onlineStatus.deviceCount || 0) + 1;
        }

        // 添加通知
        if (friend) {
          this.addNotification({
            type: "system",
            title: "好友上线",
            content: `${friend.nickname || friendDid.substring(0, 16)}... 已上线`,
          });
        }
      });

      // 监听好友离线事件
      ipcRenderer.on("friend:offline", (_event, data) => {
        const { friendDid } = data;
        logger.info("[SocialStore] 好友离线:", friendDid);

        // 更新在线状态
        this.onlineStatus.set(friendDid, "offline");

        // 更新好友列表中的在线状态
        const friend = this.friends.find((f) => f.friend_did === friendDid);
        if (friend) {
          if (!friend.onlineStatus) {
            friend.onlineStatus = {};
          }
          friend.onlineStatus.status = "offline";
          friend.onlineStatus.lastSeen = Date.now();
          friend.onlineStatus.deviceCount = 0;
        }
      });

      logger.info("[SocialStore] 在线状态监听器已初始化");
    },

    /**
     * 移除在线状态监听
     */
    removeOnlineStatusListeners() {
      ipcRenderer.removeAllListeners("friend:online");
      ipcRenderer.removeAllListeners("friend:offline");
      logger.info("[SocialStore] 在线状态监听器已移除");
    },
  },
});
