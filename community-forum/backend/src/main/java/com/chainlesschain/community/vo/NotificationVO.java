package com.chainlesschain.community.vo;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 通知VO
 */
@Data
public class NotificationVO {
    private Long id;
    private String type;
    private String title;
    private String content;
    private String link;
    private Integer isRead;
    private LocalDateTime createdAt;

    // 关联对象
    private UserVO sender; // 发送者信息（如果有）
}
