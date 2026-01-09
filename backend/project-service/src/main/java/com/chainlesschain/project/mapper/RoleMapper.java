package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.Role;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 角色Mapper
 */
@Mapper
public interface RoleMapper extends BaseMapper<Role> {

    /**
     * 根据角色代码查询角色
     */
    @Select("SELECT * FROM roles WHERE code = #{code} AND deleted = 0")
    Role findByCode(@Param("code") String code);

    /**
     * 根据用户ID查询角色列表
     */
    @Select("SELECT r.* FROM roles r " +
            "INNER JOIN user_roles ur ON r.id = ur.role_id " +
            "WHERE ur.user_id = #{userId} AND r.deleted = 0")
    List<Role> findByUserId(@Param("userId") String userId);
}
