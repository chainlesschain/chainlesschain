package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.CommentCreateRequest;
import com.chainlesschain.project.dto.CommentDTO;
import com.chainlesschain.project.dto.CommentUpdateRequest;
import com.chainlesschain.project.entity.ProjectComment;
import com.chainlesschain.project.mapper.ProjectCommentMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 评论服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommentService {

    private final ProjectCommentMapper commentMapper;

    /**
     * 获取评论列表
     */
    public Page<CommentDTO> listComments(String projectId, String filePath, int pageNum, int pageSize) {
        log.info("获取评论列表: projectId={}, filePath={}", projectId, filePath);

        LambdaQueryWrapper<ProjectComment> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectComment::getProjectId, projectId);

        if (filePath != null && !filePath.trim().isEmpty()) {
            wrapper.eq(ProjectComment::getFilePath, filePath);
        }

        // 只获取顶层评论（非回复）
        wrapper.isNull(ProjectComment::getParentCommentId)
                .orderByDesc(ProjectComment::getCreatedAt);

        Page<ProjectComment> page = new Page<>(pageNum, pageSize);
        Page<ProjectComment> result = commentMapper.selectPage(page, wrapper);

        // 转换为DTO
        Page<CommentDTO> dtoPage = new Page<>(pageNum, pageSize);
        dtoPage.setTotal(result.getTotal());
        dtoPage.setRecords(result.getRecords().stream()
                .map(this::toDTO)
                .collect(Collectors.toList()));

        return dtoPage;
    }

    /**
     * 添加评论
     */
    @Transactional
    public CommentDTO addComment(String projectId, CommentCreateRequest request, String authorDid) {
        log.info("添加评论: projectId={}, filePath={}", projectId, request.getFilePath());

        ProjectComment comment = new ProjectComment();
        comment.setId(IdWorker.get32UUID());
        comment.setProjectId(projectId);
        comment.setFilePath(request.getFilePath());
        comment.setLineNumber(request.getLineNumber());
        comment.setAuthorDid(authorDid);
        comment.setContent(request.getContent());
        comment.setParentCommentId(request.getParentCommentId());

        commentMapper.insert(comment);

        log.info("评论添加成功: commentId={}", comment.getId());
        return toDTO(comment);
    }

    /**
     * 更新评论
     */
    @Transactional
    public CommentDTO updateComment(String projectId, String commentId, CommentUpdateRequest request) {
        log.info("更新评论: projectId={}, commentId={}", projectId, commentId);

        ProjectComment comment = getComment(projectId, commentId);

        comment.setContent(request.getContent());
        commentMapper.updateById(comment);

        log.info("评论更新成功");
        return toDTO(comment);
    }

    /**
     * 删除评论
     */
    @Transactional
    public void deleteComment(String projectId, String commentId) {
        log.info("删除评论: projectId={}, commentId={}", projectId, commentId);

        ProjectComment comment = getComment(projectId, commentId);

        // 同时删除所有回复
        LambdaQueryWrapper<ProjectComment> replyWrapper = new LambdaQueryWrapper<>();
        replyWrapper.eq(ProjectComment::getParentCommentId, commentId);
        commentMapper.delete(replyWrapper);

        // 删除评论本身
        commentMapper.deleteById(comment.getId());

        log.info("评论删除成功");
    }

    /**
     * 获取评论回复
     */
    public List<CommentDTO> getReplies(String projectId, String commentId) {
        log.info("获取评论回复: projectId={}, commentId={}", projectId, commentId);

        LambdaQueryWrapper<ProjectComment> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectComment::getProjectId, projectId)
                .eq(ProjectComment::getParentCommentId, commentId)
                .orderByAsc(ProjectComment::getCreatedAt);

        List<ProjectComment> replies = commentMapper.selectList(wrapper);

        return replies.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 获取评论
     */
    private ProjectComment getComment(String projectId, String commentId) {
        LambdaQueryWrapper<ProjectComment> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectComment::getId, commentId)
                .eq(ProjectComment::getProjectId, projectId);

        ProjectComment comment = commentMapper.selectOne(wrapper);
        if (comment == null) {
            throw new RuntimeException("评论不存在");
        }

        return comment;
    }

    /**
     * Entity转DTO
     */
    private CommentDTO toDTO(ProjectComment comment) {
        CommentDTO dto = new CommentDTO();
        BeanUtils.copyProperties(comment, dto);

        // 计算回复数
        if (comment.getParentCommentId() == null) {
            LambdaQueryWrapper<ProjectComment> replyWrapper = new LambdaQueryWrapper<>();
            replyWrapper.eq(ProjectComment::getParentCommentId, comment.getId());
            Long replyCount = commentMapper.selectCount(replyWrapper);
            dto.setReplyCount(replyCount.intValue());
        } else {
            dto.setReplyCount(0);
        }

        // TODO: 从DID系统获取作者名称
        dto.setAuthorName(comment.getAuthorDid());

        return dto;
    }
}
