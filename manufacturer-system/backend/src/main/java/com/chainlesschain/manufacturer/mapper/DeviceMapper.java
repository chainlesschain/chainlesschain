package com.chainlesschain.manufacturer.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.manufacturer.entity.Device;
import org.apache.ibatis.annotations.Mapper;

/**
 * 设备Mapper接口
 */
@Mapper
public interface DeviceMapper extends BaseMapper<Device> {
}
