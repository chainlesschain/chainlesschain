package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 评论响应DTO
 */
@Data
public class CommentDTO {

    private String id;

    private String projectId;

    private String filePath;

    private Integer lineNumber;

    private String authorDid;

    private String authorName;  // 从DID解析或缓存

    private String content;

    private String parentCommentId;

    private Integer replyCount;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
