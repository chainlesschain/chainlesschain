package com.chainlesschain.community.vo;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 帖子详情VO
 */
@Data
public class PostVO {
    private Long id;
    private String title;
    private String content;
    private String contentHtml;
    private String type;
    private String status;
    private Integer isPinned;
    private Integer isFeatured;
    private Integer isClosed;
    private Integer viewsCount;
    private Integer repliesCount;
    private Integer likesCount;
    private Integer favoritesCount;
    private Integer sharesCount;
    private Long bestReplyId;
    private LocalDateTime lastReplyAt;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // 关联对象
    private UserVO user; // 作者信息
    private CategoryVO category; // 分类信息
    private List<TagVO> tags; // 标签列表

    // 扩展字段
    private Boolean liked; // 当前用户是否点赞
    private Boolean favorited; // 当前用户是否收藏
}
