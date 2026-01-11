package com.chainlesschain.marketplace.service;

import com.chainlesschain.marketplace.entity.Category;
import com.chainlesschain.marketplace.mapper.CategoryMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Category Service
 * 分类服务
 *
 * @author ChainlessChain Team
 */
@Service
@RequiredArgsConstructor
public class CategoryService {

    private final CategoryMapper categoryMapper;

    /**
     * Get all categories with plugin count
     */
    @Cacheable(value = "categories", key = "'all'")
    public List<Category> getAllCategories() {
        return categoryMapper.getAllWithCount();
    }

    /**
     * Get category by code
     */
    @Cacheable(value = "categories", key = "#code")
    public Category getCategoryByCode(String code) {
        return categoryMapper.selectOne(
            categoryMapper.selectOne(null).wrapper().eq("code", code).eq("deleted", false)
        );
    }
}
