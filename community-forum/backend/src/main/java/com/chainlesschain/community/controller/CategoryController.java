package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.service.CategoryService;
import com.chainlesschain.community.vo.CategoryVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 分类控制器
 */
@RestController
@RequestMapping("/categories")
@Tag(name = "分类管理", description = "分类的查询功能")
public class CategoryController {

    @Autowired
    private CategoryService categoryService;

    /**
     * 获取所有分类
     */
    @GetMapping
    @Operation(summary = "获取所有分类", description = "查询所有激活的分类列表")
    public Result<List<CategoryVO>> getAllCategories() {
        return categoryService.getAllCategories();
    }

    /**
     * 根据slug获取分类详情
     */
    @GetMapping("/{slug}")
    @Operation(summary = "获取分类详情", description = "根据分类标识获取详细信息")
    public Result<CategoryVO> getCategory(
            @Parameter(description = "分类标识", required = true)
            @PathVariable String slug
    ) {
        return categoryService.getCategoryBySlug(slug);
    }
}
