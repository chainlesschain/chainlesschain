package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.Tag;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 标签Mapper接口
 */
@Mapper
public interface TagMapper extends BaseMapper<Tag> {

    /**
     * 根据slug查询标签
     */
    @Select("SELECT * FROM tags WHERE slug = #{slug}")
    Tag findBySlug(@Param("slug") String slug);

    /**
     * 根据名称查询标签
     */
    @Select("SELECT * FROM tags WHERE name = #{name}")
    Tag findByName(@Param("name") String name);

    /**
     * 查询热门标签
     */
    @Select("SELECT * FROM tags ORDER BY posts_count DESC LIMIT #{limit}")
    List<Tag> findPopularTags(@Param("limit") int limit);

    /**
     * 根据帖子ID查询标签列表
     */
    @Select("SELECT t.* FROM tags t " +
            "INNER JOIN post_tags pt ON t.id = pt.tag_id " +
            "WHERE pt.post_id = #{postId}")
    List<Tag> findByPostId(@Param("postId") Long postId);

    /**
     * 搜索标签
     */
    @Select("SELECT * FROM tags WHERE name LIKE CONCAT('%', #{keyword}, '%') LIMIT 20")
    List<Tag> searchTags(@Param("keyword") String keyword);

    /**
     * 更新帖子数
     */
    @Update("UPDATE tags SET posts_count = posts_count + #{increment} WHERE id = #{tagId}")
    void incrementPostsCount(@Param("tagId") Long tagId, @Param("increment") int increment);
}
