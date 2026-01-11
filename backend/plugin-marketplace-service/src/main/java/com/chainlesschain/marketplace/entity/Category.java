package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Category Entity
 * 分类实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("categories")
public class Category {

    @TableId(type = IdType.AUTO)
    private Integer id;

    private String code;

    private String name;

    private String description;

    private String icon;

    @TableField("sort_order")
    private Integer sortOrder;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableLogic
    private Boolean deleted;

    // Transient fields
    @TableField(exist = false)
    private Long pluginCount;
}
