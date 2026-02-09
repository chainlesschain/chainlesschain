package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.FileVersion;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 文件版本Mapper
 */
@Mapper
public interface FileVersionMapper extends BaseMapper<FileVersion> {

    /**
     * 获取文件的版本历史（按版本号降序）
     */
    @Select("SELECT * FROM file_versions WHERE file_id = #{fileId} AND project_id = #{projectId} ORDER BY version DESC LIMIT #{limit}")
    List<FileVersion> getVersionHistory(
        @Param("fileId") String fileId,
        @Param("projectId") String projectId,
        @Param("limit") int limit
    );

    /**
     * 获取文件的最新版本号
     */
    @Select("SELECT COALESCE(MAX(version), 0) FROM file_versions WHERE file_id = #{fileId}")
    Integer getLatestVersionNumber(@Param("fileId") String fileId);

    /**
     * 获取指定版本
     */
    @Select("SELECT * FROM file_versions WHERE file_id = #{fileId} AND version = #{version}")
    FileVersion getByVersion(
        @Param("fileId") String fileId,
        @Param("version") int version
    );
}
