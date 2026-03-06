---
name: content-publisher
display-name: Content Publisher
description: AI-powered content generation and multi-platform publishing - create infographics, slide decks, cover images, comics, and format content for social platforms
version: 1.0.0
category: productivity
user-invocable: true
tags: [content, publish, infographic, slides, social, image, article, generation]
capabilities:
  [
    infographic-generation,
    slide-deck-creation,
    cover-image,
    article-publishing,
    social-post,
    comic-generation,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    content-infographic,
    content-slides,
    content-cover,
    content-publish,
    content-comic,
  ]
instructions: |
  Use this skill when the user wants to create visual content (infographics,
  slide decks, cover images, comics) or publish content to platforms. Generates
  structured content using LLM for text and provides image generation specs.
  Supports multiple output formats and platform-specific formatting.
examples:
  - input: "create an infographic about microservices architecture"
    action: infographic
  - input: "generate slide deck for quarterly review"
    action: slides
  - input: "create a cover image for my blog post"
    action: cover
  - input: "format this article for social media posting"
    action: social
author: ChainlessChain
license: MIT
---

# Content Publisher Skill

AI-powered content generation and multi-platform publishing.

## Usage

```
/content-publisher infographic "<topic>"
/content-publisher slides "<topic>" [--count N]
/content-publisher cover "<title>" [--aspect 2.35:1]
/content-publisher comic "<topic>" [--panels N]
/content-publisher social "<content>" [--platform twitter|wechat]
/content-publisher list-templates
```

## Content Types

| Type | Description | Output |
| --- | --- | --- |
| `infographic` | Multi-section visual layout | Markdown structure + image specs |
| `slides` | Presentation deck | Slide outlines + speaker notes |
| `cover` | Article cover image | Image specifications + layout |
| `comic` | Knowledge comics | Panel descriptions + dialogue |
| `social` | Platform-formatted post | Platform-specific content |

## Infographic Layout

Generates a structured infographic with:
- Title and subtitle
- Key statistics section (3-5 data points)
- Process/flow section
- Comparison table
- Call to action / conclusion

## Slide Deck Structure

Each slide includes:
- Title
- 3-5 bullet points
- Speaker notes
- Visual suggestion

## Platform Formatting

| Platform | Constraints |
| --- | --- |
| Twitter/X | 280 chars, thread for long content |
| WeChat | Rich text with images |
| LinkedIn | Professional tone, 1300 chars |
| Blog | Full markdown with frontmatter |

## Cover Image Specs

| Aspect Ratio | Use Case |
| --- | --- |
| `2.35:1` | Blog/article header |
| `16:9` | Presentation/video thumbnail |
| `1:1` | Social media avatar/post |
| `9:16` | Mobile/story format |
