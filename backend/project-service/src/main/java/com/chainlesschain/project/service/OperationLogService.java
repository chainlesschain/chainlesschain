package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.entity.OperationLog;
import com.chainlesschain.project.mapper.OperationLogMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 操作日志服务
 */
@Service
public class OperationLogService {

    @Autowired
    private OperationLogMapper operationLogMapper;

    /**
     * 异步保存操作日志
     */
    @Async
    public void saveLog(OperationLog log) {
        try {
            operationLogMapper.insert(log);
        } catch (Exception e) {
            // 日志保存失败不影响主流程
            e.printStackTrace();
        }
    }

    /**
     * 查询操作日志（分页）
     */
    public Page<OperationLog> getLogList(int page, int pageSize,
                                         String userId, String module,
                                         String operationType, String status) {
        Page<OperationLog> logPage = new Page<>(page, pageSize);
        QueryWrapper<OperationLog> queryWrapper = new QueryWrapper<>();

        if (userId != null && !userId.isEmpty()) {
            queryWrapper.eq("user_id", userId);
        }

        if (module != null && !module.isEmpty()) {
            queryWrapper.eq("module", module);
        }

        if (operationType != null && !operationType.isEmpty()) {
            queryWrapper.eq("operation_type", operationType);
        }

        if (status != null && !status.isEmpty()) {
            queryWrapper.eq("status", status);
        }

        queryWrapper.orderByDesc("created_at");

        return operationLogMapper.selectPage(logPage, queryWrapper);
    }

    /**
     * 根据ID获取日志详情
     */
    public OperationLog getLogById(String logId) {
        return operationLogMapper.selectById(logId);
    }

    /**
     * 删除日志（物理删除）
     */
    public void deleteLog(String logId) {
        operationLogMapper.deleteById(logId);
    }

    /**
     * 批量删除日志
     */
    public void batchDeleteLogs(java.util.List<String> logIds) {
        operationLogMapper.deleteBatchIds(logIds);
    }
}
