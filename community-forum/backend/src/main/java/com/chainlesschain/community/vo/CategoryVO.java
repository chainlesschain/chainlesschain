package com.chainlesschain.community.vo;

import lombok.Data;

/**
 * 分类VO
 */
@Data
public class CategoryVO {
    private Long id;
    private String name;
    private String slug;
    private String description;
    private String icon;
    private String color;
    private Integer postsCount;
    private Integer sortOrder;
}
