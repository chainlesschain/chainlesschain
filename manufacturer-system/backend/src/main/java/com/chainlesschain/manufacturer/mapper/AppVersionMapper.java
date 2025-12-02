package com.chainlesschain.manufacturer.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.manufacturer.entity.AppVersion;
import org.apache.ibatis.annotations.Mapper;

/**
 * APP版本Mapper接口
 */
@Mapper
public interface AppVersionMapper extends BaseMapper<AppVersion> {
}
