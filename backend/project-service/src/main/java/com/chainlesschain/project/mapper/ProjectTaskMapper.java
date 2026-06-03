package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.ProjectTask;
import org.apache.ibatis.annotations.Mapper;

/**
 * 项目任务Mapper
 */
@Mapper
public interface ProjectTaskMapper extends BaseMapper<ProjectTask> {
}
