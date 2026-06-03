package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Report;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 举报Mapper接口
 */
@Mapper
public interface ReportMapper extends BaseMapper<Report> {

    /**
     * 分页查询举报（关联用户信息）
     */
    @Select("SELECT r.*, u.nickname AS user_nickname, u.avatar AS user_avatar " +
            "FROM reports r " +
            "LEFT JOIN users u ON r.user_id = u.id " +
            "WHERE r.status = #{status} " +
            "ORDER BY r.created_at DESC")
    IPage<Report> selectReportsByStatus(Page<Report> page, @Param("status") String status);

    /**
     * 根据目标查询举报记录
     */
    @Select("SELECT r.*, u.nickname AS user_nickname, u.avatar AS user_avatar " +
            "FROM reports r " +
            "LEFT JOIN users u ON r.user_id = u.id " +
            "WHERE r.target_type = #{targetType} AND r.target_id = #{targetId} " +
            "ORDER BY r.created_at DESC")
    IPage<Report> selectReportsByTarget(Page<Report> page,
                                       @Param("targetType") String targetType,
                                       @Param("targetId") Long targetId);
}
