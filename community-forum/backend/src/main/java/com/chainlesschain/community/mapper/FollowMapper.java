package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Follow;
import com.chainlesschain.community.entity.User;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 关注Mapper接口
 */
@Mapper
public interface FollowMapper extends BaseMapper<Follow> {

    /**
     * 查询是否关注
     */
    @Select("SELECT COUNT(*) FROM follows WHERE follower_id = #{followerId} AND following_id = #{followingId}")
    int checkFollowing(@Param("followerId") Long followerId, @Param("followingId") Long followingId);

    /**
     * 取消关注
     */
    @Delete("DELETE FROM follows WHERE follower_id = #{followerId} AND following_id = #{followingId}")
    int unfollow(@Param("followerId") Long followerId, @Param("followingId") Long followingId);

    /**
     * 查询关注列表
     */
    @Select("SELECT u.* FROM users u " +
            "INNER JOIN follows f ON u.id = f.following_id " +
            "WHERE f.follower_id = #{userId} AND u.deleted = 0 " +
            "ORDER BY f.created_at DESC")
    IPage<User> selectFollowing(Page<User> page, @Param("userId") Long userId);

    /**
     * 查询粉丝列表
     */
    @Select("SELECT u.* FROM users u " +
            "INNER JOIN follows f ON u.id = f.follower_id " +
            "WHERE f.following_id = #{userId} AND u.deleted = 0 " +
            "ORDER BY f.created_at DESC")
    IPage<User> selectFollowers(Page<User> page, @Param("userId") Long userId);
}
