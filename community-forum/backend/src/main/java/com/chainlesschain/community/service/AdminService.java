package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Post;
import com.chainlesschain.community.entity.Report;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.*;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 管理员服务
 */
@Service
public class AdminService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private PostMapper postMapper;

    @Autowired
    private ReplyMapper replyMapper;

    @Autowired
    private CategoryMapper categoryMapper;

    @Autowired
    private ReportMapper reportMapper;

    /**
     * 获取仪表盘统计数据
     */
    public Result<Map<String, Object>> getDashboardStats() {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Map<String, Object> stats = new HashMap<>();

        // 用户统计
        QueryWrapper<User> userWrapper = new QueryWrapper<>();
        userWrapper.eq("deleted", 0);
        long totalUsers = userMapper.selectCount(userWrapper);
        stats.put("totalUsers", totalUsers);

        // 今日新增用户
        userWrapper = new QueryWrapper<>();
        userWrapper.eq("deleted", 0)
                .apply("DATE(created_at) = CURDATE()");
        long todayUsers = userMapper.selectCount(userWrapper);
        stats.put("todayUsers", todayUsers);

        // 帖子统计
        QueryWrapper<Post> postWrapper = new QueryWrapper<>();
        postWrapper.eq("deleted", 0);
        long totalPosts = postMapper.selectCount(postWrapper);
        stats.put("totalPosts", totalPosts);

        // 待审核帖子
        postWrapper = new QueryWrapper<>();
        postWrapper.eq("deleted", 0).eq("status", "PENDING");
        long pendingPosts = postMapper.selectCount(postWrapper);
        stats.put("pendingPosts", pendingPosts);

        // 举报统计
        QueryWrapper<Report> reportWrapper = new QueryWrapper<>();
        reportWrapper.eq("status", "PENDING");
        long pendingReports = reportMapper.selectCount(reportWrapper);
        stats.put("pendingReports", pendingReports);

        return Result.success(stats);
    }

    /**
     * 获取用户列表
     */
    public Result<PageResult<UserVO>> getUsers(Integer page, Integer pageSize, String status, String role, String keyword) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        QueryWrapper<User> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0);

        if (status != null && !status.isEmpty()) {
            wrapper.eq("status", status);
        }

        if (role != null && !role.isEmpty()) {
            wrapper.eq("role", role);
        }

        if (keyword != null && !keyword.isEmpty()) {
            wrapper.and(w -> w.like("nickname", keyword).or().like("username", keyword));
        }

        wrapper.orderByDesc("created_at");

        Page<User> pageParam = new Page<>(page, pageSize);
        userMapper.selectPage(pageParam, wrapper);

        List<UserVO> voList = pageParam.getRecords().stream()
                .map(this::convertUserToVO)
                .collect(Collectors.toList());

        PageResult<UserVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 封禁用户
     */
    @Transactional
    public Result<Void> banUser(Long userId, String reason) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        User user = userMapper.selectById(userId);

        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        if ("ADMIN".equals(user.getRole())) {
            return Result.error("不能封禁管理员");
        }

        user.setStatus("BANNED");
        userMapper.updateById(user);

        return Result.success();
    }

    /**
     * 解封用户
     */
    @Transactional
    public Result<Void> unbanUser(Long userId) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        User user = userMapper.selectById(userId);

        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        user.setStatus("NORMAL");
        userMapper.updateById(user);

        return Result.success();
    }

    /**
     * 删除用户
     */
    @Transactional
    public Result<Void> deleteUser(Long userId) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        User user = userMapper.selectById(userId);

        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        if ("ADMIN".equals(user.getRole())) {
            return Result.error("不能删除管理员");
        }

        // 逻辑删除
        user.setDeleted(1);
        userMapper.updateById(user);

        return Result.success();
    }

    /**
     * 更新用户角色
     */
    @Transactional
    public Result<Void> updateUserRole(Long userId, String role) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        User user = userMapper.selectById(userId);

        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        if (!role.equals("USER") && !role.equals("ADMIN")) {
            return Result.error("无效的角色");
        }

        user.setRole(role);
        userMapper.updateById(user);

        return Result.success();
    }

    /**
     * 获取待审核帖子
     */
    public Result<PageResult<Post>> getPendingPosts(Integer page, Integer pageSize) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        QueryWrapper<Post> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .eq("status", "PENDING")
                .orderByDesc("created_at");

        Page<Post> pageParam = new Page<>(page, pageSize);
        postMapper.selectPage(pageParam, wrapper);

        PageResult<Post> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 获取被举报帖子
     */
    public Result<PageResult<Post>> getReportedPosts(Integer page, Integer pageSize) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        // 查询有待处理举报的帖子
        QueryWrapper<Report> reportWrapper = new QueryWrapper<>();
        reportWrapper.select("DISTINCT target_id")
                .eq("target_type", "POST")
                .eq("status", "PENDING");

        List<Report> reports = reportMapper.selectList(reportWrapper);
        List<Long> postIds = reports.stream().map(Report::getTargetId).collect(Collectors.toList());

        if (postIds.isEmpty()) {
            return Result.success(PageResult.of(List.of(), 0L, page, pageSize));
        }

        QueryWrapper<Post> wrapper = new QueryWrapper<>();
        wrapper.in("id", postIds)
                .eq("deleted", 0)
                .orderByDesc("created_at");

        Page<Post> pageParam = new Page<>(page, pageSize);
        postMapper.selectPage(pageParam, wrapper);

        PageResult<Post> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 审核通过帖子
     */
    @Transactional
    public Result<Void> approvePost(Long postId) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Post post = postMapper.selectById(postId);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        post.setStatus("PUBLISHED");
        postMapper.updateById(post);

        return Result.success();
    }

    /**
     * 拒绝帖子
     */
    @Transactional
    public Result<Void> rejectPost(Long postId, String reason) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Post post = postMapper.selectById(postId);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 逻辑删除
        post.setDeleted(1);
        postMapper.updateById(post);

        // TODO: 可以发送通知给作者

        return Result.success();
    }

    /**
     * 删除帖子（管理员）
     */
    @Transactional
    public Result<Void> deletePost(Long postId) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Post post = postMapper.selectById(postId);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 逻辑删除
        post.setDeleted(1);
        postMapper.updateById(post);

        return Result.success();
    }

    /**
     * 恢复帖子
     */
    @Transactional
    public Result<Void> restorePost(Long postId) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Post post = postMapper.selectById(postId);

        if (post == null) {
            return Result.notFound();
        }

        post.setDeleted(0);
        post.setStatus("PUBLISHED");
        postMapper.updateById(post);

        return Result.success();
    }

    /**
     * 获取举报列表
     */
    public Result<PageResult<Report>> getReports(Integer page, Integer pageSize, String status) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Page<Report> pageParam = new Page<>(page, pageSize);

        if (status != null && !status.isEmpty()) {
            reportMapper.selectReportsByStatus(pageParam, status);
        } else {
            QueryWrapper<Report> wrapper = new QueryWrapper<>();
            wrapper.orderByDesc("created_at");
            reportMapper.selectPage(pageParam, wrapper);
        }

        PageResult<Report> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 处理举报
     */
    @Transactional
    public Result<Void> handleReport(Long reportId, String action, String result) {
        if (!SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        Report report = reportMapper.selectById(reportId);

        if (report == null) {
            return Result.notFound();
        }

        Long handlerId = SecurityUtil.getCurrentUserId();

        report.setStatus("RESOLVED");
        report.setHandlerId(handlerId);
        report.setResult(result);
        reportMapper.updateById(report);

        // 根据action执行相应操作
        if ("DELETE".equals(action)) {
            if ("POST".equals(report.getTargetType())) {
                deletePost(report.getTargetId());
            }
            // TODO: 处理其他类型的举报
        }

        return Result.success();
    }

    /**
     * 转换User为UserVO
     */
    private UserVO convertUserToVO(User user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return vo;
    }
}
