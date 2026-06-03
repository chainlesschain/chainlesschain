package com.chainlesschain.community.service;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Tag;
import com.chainlesschain.community.mapper.TagMapper;
import com.chainlesschain.community.vo.TagVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 标签服务
 */
@Service
public class TagService {

    @Autowired
    private TagMapper tagMapper;

    /**
     * 获取热门标签
     */
    public Result<List<TagVO>> getPopularTags(Integer limit) {
        if (limit == null || limit <= 0) {
            limit = 20;
        }

        List<Tag> tags = tagMapper.findPopularTags(limit);

        List<TagVO> voList = tags.stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        return Result.success(voList);
    }

    /**
     * 根据slug获取标签详情
     */
    public Result<TagVO> getTagBySlug(String slug) {
        Tag tag = tagMapper.findBySlug(slug);

        if (tag == null) {
            return Result.notFound();
        }

        return Result.success(convertToVO(tag));
    }

    /**
     * 搜索标签
     */
    public Result<List<TagVO>> searchTags(String keyword) {
        List<Tag> tags = tagMapper.searchTags(keyword);

        List<TagVO> voList = tags.stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        return Result.success(voList);
    }

    /**
     * 根据帖子ID获取标签列表
     */
    public Result<List<TagVO>> getTagsByPostId(Long postId) {
        List<Tag> tags = tagMapper.findByPostId(postId);

        List<TagVO> voList = tags.stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        return Result.success(voList);
    }

    /**
     * 转换为TagVO
     */
    private TagVO convertToVO(Tag tag) {
        TagVO vo = new TagVO();
        BeanUtils.copyProperties(tag, vo);
        return vo;
    }
}
