package com.chainlesschain.marketplace.controller;

import com.chainlesschain.marketplace.dto.ApiResponse;
import com.chainlesschain.marketplace.entity.Category;
import com.chainlesschain.marketplace.service.CategoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Category Controller
 * 分类REST API控制器
 *
 * @author ChainlessChain Team
 */
@Slf4j
@RestController
@RequestMapping("/categories")
@RequiredArgsConstructor
public class CategoryController {

    private final CategoryService categoryService;

    /**
     * Get all categories
     * GET /categories
     */
    @GetMapping
    public ApiResponse<List<Category>> getAllCategories() {
        log.info("Get all categories");
        List<Category> categories = categoryService.getAllCategories();
        return ApiResponse.success(categories);
    }

    /**
     * Get category by code
     * GET /categories/{code}
     */
    @GetMapping("/{code}")
    public ApiResponse<Category> getCategoryByCode(@PathVariable String code) {
        log.info("Get category: {}", code);
        Category category = categoryService.getCategoryByCode(code);
        return ApiResponse.success(category);
    }
}
