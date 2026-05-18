package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.OperationLog;
import org.apache.ibatis.annotations.Mapper;

/**
 * 操作日志Mapper
 */
@Mapper
public interface OperationLogMapper extends BaseMapper<OperationLog> {
}
