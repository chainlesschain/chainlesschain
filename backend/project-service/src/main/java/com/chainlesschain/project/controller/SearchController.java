package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.SearchRequest;
import com.chainlesschain.project.dto.SearchResponse;
import com.chainlesschain.project.service.SearchService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 搜索控制器
 * 提供全文搜索功能
 */
@RestController
@RequestMapping("/api/search")
@Tag(name = "搜索管理", description = "全文搜索相关接口")
public class SearchController {

    @Autowired
    private SearchService searchService;

    /**
     * 执行搜索
     */
    @PostMapping
    @Operation(summary = "搜索", description = "执行全文搜索")
    public ResponseEntity<SearchResponse> search(@Valid @RequestBody SearchRequest request) {
        SearchResponse response = searchService.search(request);
        return ResponseEntity.ok(response);
    }

    /**
     * 快速搜索（GET方式）
     */
    @GetMapping
    @Operation(summary = "快速搜索", description = "使用GET方式进行简单搜索")
    public ResponseEntity<SearchResponse> quickSearch(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "all") String type,
            @RequestParam(defaultValue = "1") Integer page,
            @RequestParam(defaultValue = "20") Integer pageSize) {

        SearchRequest request = new SearchRequest();
        request.setKeyword(keyword);
        request.setType(type);
        request.setPage(page);
        request.setPageSize(pageSize);

        SearchResponse response = searchService.search(request);
        return ResponseEntity.ok(response);
    }

    /**
     * 清除搜索缓存
     */
    @DeleteMapping("/cache")
    @Operation(summary = "清除搜索缓存", description = "清除所有搜索缓存")
    public ResponseEntity<?> clearCache() {
        searchService.clearSearchCache();
        return ResponseEntity.ok(Map.of(
            "success", true,
            "message", "搜索缓存已清除"
        ));
    }

    /**
     * 搜索建议
     */
    @GetMapping("/suggestions")
    @Operation(summary = "搜索建议", description = "获取搜索关键词建议")
    public ResponseEntity<?> getSuggestions(@RequestParam String keyword) {
        List<String> suggestions = searchService.getSuggestions(keyword);
        return ResponseEntity.ok(Map.of(
            "keyword", keyword,
            "suggestions", suggestions
        ));
    }
}
