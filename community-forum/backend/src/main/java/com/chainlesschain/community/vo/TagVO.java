package com.chainlesschain.community.vo;

import lombok.Data;

/**
 * 标签VO
 */
@Data
public class TagVO {
    private Long id;
    private String name;
    private String slug;
    private String description;
    private Integer postsCount;
}
