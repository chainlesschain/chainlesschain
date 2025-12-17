package com.chainlesschain.community.vo;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 帖子列表VO（精简版）
 */
@Data
public class PostListVO {
    private Long id;
    private String title;
    private String type;
    private Integer isPinned;
    private Integer isFeatured;
    private Integer viewsCount;
    private Integer repliesCount;
    private Integer likesCount;
    private LocalDateTime lastReplyAt;
    private LocalDateTime createdAt;

    // 关联对象（精简）
    private Long userId;
    private String userNickname;
    private String userAvatar;
    private String categoryName;
    private String categorySlug;
    private List<String> tagNames; // 仅标签名称
}
