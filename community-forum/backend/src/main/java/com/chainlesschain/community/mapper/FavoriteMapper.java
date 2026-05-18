package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Favorite;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 收藏Mapper接口
 */
@Mapper
public interface FavoriteMapper extends BaseMapper<Favorite> {

    /**
     * 查询用户是否收藏
     */
    @Select("SELECT COUNT(*) FROM favorites WHERE user_id = #{userId} AND post_id = #{postId}")
    int checkUserFavorited(@Param("userId") Long userId, @Param("postId") Long postId);

    /**
     * 取消收藏
     */
    @Delete("DELETE FROM favorites WHERE user_id = #{userId} AND post_id = #{postId}")
    int unfavorite(@Param("userId") Long userId, @Param("postId") Long postId);

    /**
     * 查询用户收藏列表（关联帖子信息）
     */
    @Select("SELECT f.*, p.* FROM favorites f " +
            "LEFT JOIN posts p ON f.post_id = p.id " +
            "WHERE f.user_id = #{userId} AND p.deleted = 0 " +
            "ORDER BY f.created_at DESC")
    IPage<Favorite> selectUserFavorites(Page<Favorite> page, @Param("userId") Long userId);
}
