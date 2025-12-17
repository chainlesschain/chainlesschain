package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.service.SearchService;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 搜索控制器
 */
@RestController
@RequestMapping("/api/search")
@Tag(name = "搜索功能", description = "全局搜索、帖子搜索、用户搜索等功能")
public class SearchController {

    @Autowired
    private SearchService searchService;

    /**
     * 全局搜索
     */
    @GetMapping
    @Operation(summary = "全局搜索", description = "搜索帖子和用户，返回综合结果")
    public Result<Map<String, Object>> globalSearch(
            @Parameter(description = "搜索关键词", required = true)
            @RequestParam String keyword,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return searchService.globalSearch(keyword, page, pageSize);
    }

    /**
     * 搜索帖子
     */
    @GetMapping("/posts")
    @Operation(summary = "搜索帖子", description = "根据关键词搜索帖子，支持分类筛选")
    public Result<PageResult<PostListVO>> searchPosts(
            @Parameter(description = "搜索关键词", required = true)
            @RequestParam String keyword,

            @Parameter(description = "分类ID（可选）")
            @RequestParam(required = false) Long categoryId,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return searchService.searchPosts(keyword, categoryId, page, pageSize);
    }

    /**
     * 搜索用户
     */
    @GetMapping("/users")
    @Operation(summary = "搜索用户", description = "根据关键词搜索用户")
    public Result<PageResult<UserVO>> searchUsers(
            @Parameter(description = "搜索关键词", required = true)
            @RequestParam String keyword,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return searchService.searchUsers(keyword, page, pageSize);
    }

    /**
     * 获取热门搜索
     */
    @GetMapping("/hot")
    @Operation(summary = "获取热门搜索", description = "获取当前热门的搜索关键词")
    public Result<List<String>> getHotSearches() {
        return searchService.getHotSearches();
    }

    /**
     * 获取搜索建议
     */
    @GetMapping("/suggestions")
    @Operation(summary = "获取搜索建议", description = "根据关键词获取搜索建议")
    public Result<List<String>> getSearchSuggestions(
            @Parameter(description = "搜索关键词", required = true)
            @RequestParam String keyword
    ) {
        return searchService.getSearchSuggestions(keyword);
    }
}
