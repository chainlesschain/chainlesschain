package com.chainlesschain.community.service;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Category;
import com.chainlesschain.community.mapper.CategoryMapper;
import com.chainlesschain.community.vo.CategoryVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 分类服务
 */
@Service
public class CategoryService {

    @Autowired
    private CategoryMapper categoryMapper;

    /**
     * 获取所有分类
     */
    public Result<List<CategoryVO>> getAllCategories() {
        List<Category> categories = categoryMapper.findAllActive();

        List<CategoryVO> voList = categories.stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        return Result.success(voList);
    }

    /**
     * 根据slug获取分类详情
     */
    public Result<CategoryVO> getCategoryBySlug(String slug) {
        Category category = categoryMapper.findBySlug(slug);

        if (category == null) {
            return Result.notFound();
        }

        return Result.success(convertToVO(category));
    }

    /**
     * 根据ID获取分类详情
     */
    public Result<CategoryVO> getCategoryById(Long id) {
        Category category = categoryMapper.selectById(id);

        if (category == null) {
            return Result.notFound();
        }

        return Result.success(convertToVO(category));
    }

    /**
     * 转换为CategoryVO
     */
    private CategoryVO convertToVO(Category category) {
        CategoryVO vo = new CategoryVO();
        BeanUtils.copyProperties(category, vo);
        return vo;
    }
}
