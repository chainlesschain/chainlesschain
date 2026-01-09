package com.chainlesschain.project.websocket;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/**
 * WebSocket通知服务
 * 用于向客户端发送实时通知
 */
@Service
public class NotificationService {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /**
     * 向指定用户发送通知
     */
    public void sendToUser(String username, NotificationMessage message) {
        messagingTemplate.convertAndSendToUser(username, "/queue/notifications", message);
    }

    /**
     * 向所有用户广播通知
     */
    public void broadcast(NotificationMessage message) {
        messagingTemplate.convertAndSend("/topic/notifications", message);
    }

    /**
     * 向指定主题发送消息
     */
    public void sendToTopic(String topic, Object message) {
        messagingTemplate.convertAndSend("/topic/" + topic, message);
    }

    /**
     * 发送新消息通知
     */
    public void notifyNewMessage(String username, String sender, String content) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.MESSAGE,
            "新消息",
            sender + " 给你发送了一条消息"
        );
        notification.setSender(sender);
        notification.setData(content);
        sendToUser(username, notification);
    }

    /**
     * 发送新评论通知
     */
    public void notifyNewComment(String username, String commenter, String postTitle) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.COMMENT,
            "新评论",
            commenter + " 评论了你的帖子: " + postTitle
        );
        notification.setSender(commenter);
        sendToUser(username, notification);
    }

    /**
     * 发送点赞通知
     */
    public void notifyLike(String username, String liker, String itemType) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.LIKE,
            "新点赞",
            liker + " 赞了你的" + itemType
        );
        notification.setSender(liker);
        sendToUser(username, notification);
    }

    /**
     * 发送@提及通知
     */
    public void notifyMention(String username, String mentioner, String content) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.MENTION,
            "有人@了你",
            mentioner + " 在评论中提到了你"
        );
        notification.setSender(mentioner);
        notification.setData(content);
        sendToUser(username, notification);
    }

    /**
     * 发送系统通知
     */
    public void notifySystem(String username, String title, String content) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.SYSTEM,
            title,
            content
        );
        sendToUser(username, notification);
    }

    /**
     * 发送同步通知
     */
    public void notifySyncStatus(String username, String status, Object data) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.SYNC,
            "同步状态",
            status
        );
        notification.setData(data);
        sendToUser(username, notification);
    }

    /**
     * 发送协作通知
     */
    public void notifyCollaboration(String username, String collaborator, String action, String projectName) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.COLLABORATION,
            "协作通知",
            collaborator + " " + action + " 了项目: " + projectName
        );
        notification.setSender(collaborator);
        sendToUser(username, notification);
    }

    /**
     * 发送对话通知
     */
    public void notifyConversation(String username, String title, String content, Object data) {
        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.CONVERSATION,
            title,
            content
        );
        notification.setData(data);
        sendToUser(username, notification);
    }
}
