package com.chainlesschain.community.vo;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 用户信息VO
 */
@Data
public class UserVO {
    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private String bio;
    private String role;
    private String status;
    private Integer points;
    private Integer reputation;
    private Integer postsCount;
    private Integer repliesCount;
    private Integer followersCount;
    private Integer followingCount;
    private LocalDateTime createdAt;

    // 扩展字段（根据场景可选）
    private Boolean isFollowing; // 当前用户是否关注此用户
}
