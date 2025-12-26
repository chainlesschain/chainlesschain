package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.ProjectFile;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

/**
 * 项目文件Mapper
 */
@Mapper
public interface ProjectFileMapper extends BaseMapper<ProjectFile> {

    /**
     * 基于版本号的CAS（Compare-And-Swap）更新
     * 只有当数据库中的版本号与期望版本号匹配时才更新
     *
     * @param id 记录ID
     * @param expectedVersion 期望的版本号
     * @param file 要更新的文件对象（包含新版本号）
     * @return 更新影响的行数（0表示版本冲突，1表示成功）
     */
    @Update("UPDATE project_files SET " +
            "project_id = #{file.projectId}, " +
            "file_name = #{file.fileName}, " +
            "file_path = #{file.filePath}, " +
            "file_type = #{file.fileType}, " +
            "file_size = #{file.fileSize}, " +
            "content = #{file.content}, " +
            "content_hash = #{file.contentHash}, " +
            "version = #{file.version}, " +
            "sync_status = #{file.syncStatus}, " +
            "synced_at = #{file.syncedAt}, " +
            "device_id = #{file.deviceId}, " +
            "updated_at = NOW() " +
            "WHERE id = #{id} AND version = #{expectedVersion}")
    int updateByIdAndVersion(@Param("id") String id,
                              @Param("expectedVersion") Integer expectedVersion,
                              @Param("file") ProjectFile file);
}
