package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.ProjectComment;
import org.apache.ibatis.annotations.Mapper;

/**
 * 项目评论Mapper
 */
@Mapper
public interface ProjectCommentMapper extends BaseMapper<ProjectComment> {
}
