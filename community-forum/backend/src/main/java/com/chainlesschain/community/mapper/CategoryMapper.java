package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.Category;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 分类Mapper接口
 */
@Mapper
public interface CategoryMapper extends BaseMapper<Category> {

    /**
     * 根据slug查询分类
     */
    @Select("SELECT * FROM categories WHERE slug = #{slug}")
    Category findBySlug(@Param("slug") String slug);

    /**
     * 查询所有激活的分类（按排序）
     */
    @Select("SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order ASC")
    List<Category> findAllActive();

    /**
     * 更新帖子数
     */
    @Update("UPDATE categories SET posts_count = posts_count + #{increment} WHERE id = #{categoryId}")
    void incrementPostsCount(@Param("categoryId") Long categoryId, @Param("increment") int increment);
}
