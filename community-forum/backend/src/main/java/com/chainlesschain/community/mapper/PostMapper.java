package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Post;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 帖子Mapper接口
 */
@Mapper
public interface PostMapper extends BaseMapper<Post> {

    /**
     * 分页查询帖子（关联用户和分类信息）
     */
    @Select("SELECT p.*, u.nickname AS user_nickname, u.avatar AS user_avatar, " +
            "c.name AS category_name, c.slug AS category_slug " +
            "FROM posts p " +
            "LEFT JOIN users u ON p.user_id = u.id " +
            "LEFT JOIN categories c ON p.category_id = c.id " +
            "WHERE p.deleted = 0 AND p.status = 'PUBLISHED' " +
            "ORDER BY p.is_pinned DESC, p.created_at DESC")
    IPage<Post> selectPostsWithDetails(Page<Post> page);

    /**
     * 根据分类ID分页查询帖子
     */
    @Select("SELECT p.*, u.nickname AS user_nickname, u.avatar AS user_avatar " +
            "FROM posts p " +
            "LEFT JOIN users u ON p.user_id = u.id " +
            "WHERE p.deleted = 0 AND p.status = 'PUBLISHED' AND p.category_id = #{categoryId} " +
            "ORDER BY p.is_pinned DESC, p.created_at DESC")
    IPage<Post> selectPostsByCategoryId(Page<Post> page, @Param("categoryId") Long categoryId);

    /**
     * 根据用户ID分页查询帖子
     */
    @Select("SELECT * FROM posts WHERE deleted = 0 AND user_id = #{userId} " +
            "ORDER BY created_at DESC")
    IPage<Post> selectPostsByUserId(Page<Post> page, @Param("userId") Long userId);

    /**
     * 更新浏览数
     */
    @Update("UPDATE posts SET views_count = views_count + 1 WHERE id = #{postId}")
    void incrementViewsCount(@Param("postId") Long postId);

    /**
     * 更新回复数
     */
    @Update("UPDATE posts SET replies_count = replies_count + #{increment} WHERE id = #{postId}")
    void incrementRepliesCount(@Param("postId") Long postId, @Param("increment") int increment);

    /**
     * 更新点赞数
     */
    @Update("UPDATE posts SET likes_count = likes_count + #{increment} WHERE id = #{postId}")
    void incrementLikesCount(@Param("postId") Long postId, @Param("increment") int increment);

    /**
     * 更新收藏数
     */
    @Update("UPDATE posts SET favorites_count = favorites_count + #{increment} WHERE id = #{postId}")
    void incrementFavoritesCount(@Param("postId") Long postId, @Param("increment") int increment);

    /**
     * 设置最佳回复
     */
    @Update("UPDATE posts SET best_reply_id = #{replyId} WHERE id = #{postId}")
    void setBestReply(@Param("postId") Long postId, @Param("replyId") Long replyId);

    /**
     * 更新最后回复信息
     */
    @Update("UPDATE posts SET last_reply_user_id = #{userId}, last_reply_at = NOW() WHERE id = #{postId}")
    void updateLastReply(@Param("postId") Long postId, @Param("userId") Long userId);
}
