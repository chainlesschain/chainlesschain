package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.Project;
import org.apache.ibatis.annotations.Mapper;

/**
 * 项目Mapper
 */
@Mapper
public interface ProjectMapper extends BaseMapper<Project> {
}
