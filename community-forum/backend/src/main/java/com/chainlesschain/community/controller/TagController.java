package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.service.TagService;
import com.chainlesschain.community.vo.TagVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 标签控制器
 */
@RestController
@RequestMapping("/api/tags")
@Tag(name = "标签管理", description = "标签的查询和搜索功能")
public class TagController {

    @Autowired
    private TagService tagService;

    /**
     * 获取热门标签
     */
    @GetMapping("/popular")
    @Operation(summary = "获取热门标签", description = "查询使用最多的标签列表")
    public Result<List<TagVO>> getPopularTags(
            @Parameter(description = "返回数量限制", example = "20")
            @RequestParam(defaultValue = "20") Integer limit
    ) {
        return tagService.getPopularTags(limit);
    }

    /**
     * 根据slug获取标签详情
     */
    @GetMapping("/{slug}")
    @Operation(summary = "获取标签详情", description = "根据标签标识获取详细信息")
    public Result<TagVO> getTag(
            @Parameter(description = "标签标识", required = true)
            @PathVariable String slug
    ) {
        return tagService.getTagBySlug(slug);
    }

    /**
     * 搜索标签
     */
    @GetMapping("/search")
    @Operation(summary = "搜索标签", description = "根据关键词搜索标签")
    public Result<List<TagVO>> searchTags(
            @Parameter(description = "搜索关键词")
            @RequestParam String keyword
    ) {
        return tagService.searchTags(keyword);
    }
}
