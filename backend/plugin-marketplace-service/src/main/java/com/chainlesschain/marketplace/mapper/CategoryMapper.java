package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.Category;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * Category Mapper
 * 分类数据访问接口
 *
 * @author ChainlessChain Team
 */
@Mapper
public interface CategoryMapper extends BaseMapper<Category> {

    /**
     * Get all categories with plugin count
     */
    @Select("SELECT c.*, COUNT(p.id) as plugin_count FROM categories c " +
            "LEFT JOIN plugins p ON c.code = p.category AND p.deleted = false AND p.status = 'approved' " +
            "WHERE c.deleted = false " +
            "GROUP BY c.id " +
            "ORDER BY c.sort_order")
    List<Category> getAllWithCount();
}
