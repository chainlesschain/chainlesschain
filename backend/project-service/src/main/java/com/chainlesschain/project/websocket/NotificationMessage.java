package com.chainlesschain.project.websocket;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * WebSocket通知消息
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NotificationMessage {

    /**
     * 消息类型
     */
    private NotificationType type;

    /**
     * 消息标题
     */
    private String title;

    /**
     * 消息内容
     */
    private String content;

    /**
     * 相关数据
     */
    private Object data;

    /**
     * 发送者
     */
    private String sender;

    /**
     * 时间戳
     */
    private LocalDateTime timestamp;

    public NotificationMessage(NotificationType type, String title, String content) {
        this.type = type;
        this.title = title;
        this.content = content;
        this.timestamp = LocalDateTime.now();
    }

    public NotificationMessage(NotificationType type, String title, String content, Object data) {
        this.type = type;
        this.title = title;
        this.content = content;
        this.data = data;
        this.timestamp = LocalDateTime.now();
    }

    /**
     * 通知类型枚举
     */
    public enum NotificationType {
        MESSAGE,        // 新消息
        COMMENT,        // 新评论
        LIKE,           // 点赞
        MENTION,        // @提及
        SYSTEM,         // 系统通知
        SYNC,           // 同步通知
        COLLABORATION,  // 协作通知
        PROJECT,        // 项目通知
        CONVERSATION    // 对话通知
    }
}
