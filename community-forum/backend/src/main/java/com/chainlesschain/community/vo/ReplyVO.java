package com.chainlesschain.community.vo;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 回复VO
 */
@Data
public class ReplyVO {
    private Long id;
    private Long postId;
    private Long parentId;
    private String content;
    private String contentHtml;
    private Integer isBestAnswer;
    private Integer isAuthor;
    private Integer likesCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // 关联对象
    private UserVO user; // 回复者信息
    private UserVO replyToUser; // 被回复者信息（如果有）

    // 扩展字段
    private Boolean liked; // 当前用户是否点赞
    private List<ReplyVO> children; // 子回复列表
}
