package com.chainlesschain.community.common;

import lombok.Data;

import java.util.List;

/**
 * 分页响应结果
 *
 * @param <T> 数据类型
 */
@Data
public class PageResult<T> {

    private List<T> items;
    private Long total;
    private Integer page;
    private Integer pageSize;
    private Integer totalPages;

    public PageResult() {
    }

    public PageResult(List<T> items, Long total, Integer page, Integer pageSize) {
        this.items = items;
        this.total = total;
        this.page = page;
        this.pageSize = pageSize;
        this.totalPages = (int) Math.ceil((double) total / pageSize);
    }

    /**
     * 创建分页结果
     */
    public static <T> PageResult<T> of(List<T> items, Long total, Integer page, Integer pageSize) {
        return new PageResult<>(items, total, page, pageSize);
    }
}
