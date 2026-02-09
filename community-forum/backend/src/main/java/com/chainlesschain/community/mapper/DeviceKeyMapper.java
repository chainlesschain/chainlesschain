package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.DeviceKey;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 设备公钥Mapper接口
 */
@Mapper
public interface DeviceKeyMapper extends BaseMapper<DeviceKey> {

    /**
     * 根据设备ID查询公钥
     */
    @Select("SELECT * FROM device_keys WHERE device_id = #{deviceId} AND status = 'active' AND deleted = 0")
    DeviceKey findByDeviceId(@Param("deviceId") String deviceId);

    /**
     * 根据设备ID查询公钥字符串
     */
    @Select("SELECT public_key FROM device_keys WHERE device_id = #{deviceId} AND status = 'active' AND deleted = 0")
    String findPublicKeyByDeviceId(@Param("deviceId") String deviceId);

    /**
     * 吊销设备公钥
     */
    @Update("UPDATE device_keys SET status = 'revoked', updated_at = NOW() WHERE device_id = #{deviceId}")
    void revokeByDeviceId(@Param("deviceId") String deviceId);
}
