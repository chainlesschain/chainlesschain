package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Reply;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 回复Mapper接口
 */
@Mapper
public interface ReplyMapper extends BaseMapper<Reply> {

    /**
     * 根据帖子ID分页查询回复（关联用户信息）
     */
    @Select("SELECT r.*, u.nickname AS user_nickname, u.avatar AS user_avatar, u.role AS user_role " +
            "FROM replies r " +
            "LEFT JOIN users u ON r.user_id = u.id " +
            "WHERE r.deleted = 0 AND r.post_id = #{postId} AND r.parent_id IS NULL " +
            "ORDER BY r.is_best_answer DESC, r.created_at ASC")
    IPage<Reply> selectRepliesByPostId(Page<Reply> page, @Param("postId") Long postId);

    /**
     * 根据父回复ID查询子回复
     */
    @Select("SELECT r.*, u.nickname AS user_nickname, u.avatar AS user_avatar " +
            "FROM replies r " +
            "LEFT JOIN users u ON r.user_id = u.id " +
            "WHERE r.deleted = 0 AND r.parent_id = #{parentId} " +
            "ORDER BY r.created_at ASC")
    List<Reply> selectChildReplies(@Param("parentId") Long parentId);

    /**
     * 根据用户ID分页查询回复
     */
    @Select("SELECT * FROM replies WHERE deleted = 0 AND user_id = #{userId} " +
            "ORDER BY created_at DESC")
    IPage<Reply> selectRepliesByUserId(Page<Reply> page, @Param("userId") Long userId);

    /**
     * 更新点赞数
     */
    @Update("UPDATE replies SET likes_count = likes_count + #{increment} WHERE id = #{replyId}")
    void incrementLikesCount(@Param("replyId") Long replyId, @Param("increment") int increment);

    /**
     * 设置为最佳答案
     */
    @Update("UPDATE replies SET is_best_answer = 1 WHERE id = #{replyId}")
    void setBestAnswer(@Param("replyId") Long replyId);

    /**
     * 取消最佳答案
     */
    @Update("UPDATE replies SET is_best_answer = 0 WHERE post_id = #{postId}")
    void unsetBestAnswer(@Param("postId") Long postId);
}
