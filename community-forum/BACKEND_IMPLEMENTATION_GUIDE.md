# ChainlessChain 社区论坛 - 后端实现指南

## 📋 目录

- [项目架构](#项目架构)
- [已完成的工作](#已完成的工作)
- [实现步骤](#实现步骤)
- [核心模块实现](#核心模块实现)
- [数据库设计](#数据库设计)
- [API实现示例](#api实现示例)

## 🏗️ 项目架构

```
backend/
├── src/main/java/com/chainlesschain/community/
│   ├── common/              # 通用类（已完成）
│   │   ├── Result.java      # 统一响应结果
│   │   └── PageResult.java  # 分页响应结果
│   ├── config/              # 配置类
│   │   ├── SecurityConfig.java    # Spring Security配置
│   │   ├── CorsConfig.java        # CORS配置
│   │   ├── JwtAuthenticationFilter.java  # JWT过滤器
│   │   └── SwaggerConfig.java     # Swagger配置
│   ├── entity/              # 实体类
│   │   ├── User.java        # 用户
│   │   ├── Post.java        # 帖子
│   │   ├── Reply.java       # 回复
│   │   ├── Category.java    # 分类
│   │   ├── Tag.java         # 标签
│   │   ├── Notification.java # 通知
│   │   └── Message.java     # 私信
│   ├── mapper/              # MyBatis Mapper
│   │   ├── UserMapper.java
│   │   ├── PostMapper.java
│   │   └── ...
│   ├── service/             # 服务层
│   │   ├── AuthService.java
│   │   ├── UserService.java
│   │   ├── PostService.java
│   │   └── ...
│   ├── controller/          # 控制器
│   │   ├── AuthController.java
│   │   ├── PostController.java
│   │   ├── UserController.java
│   │   └── AdminController.java
│   ├── dto/                 # 数据传输对象
│   ├── vo/                  # 视图对象
│   ├── util/                # 工具类（已完成）
│   │   └── JwtUtil.java     # JWT工具
│   └── exception/           # 异常处理
└── src/main/resources/
    ├── application.yml      # 配置文件（已完成）
    ├── mapper/              # MyBatis XML
    └── db/                  # 数据库脚本
        └── schema.sql       # 建表脚本
```

## ✅ 已完成的工作

### 1. 基础配置
- ✅ pom.xml（Spring Boot 3.2.1 + MyBatis Plus + JWT + Redis + Elasticsearch）
- ✅ application.yml（完整配置）
- ✅ 主应用类（@MapperScan、@EnableCaching、@EnableAsync）

### 2. 通用类
- ✅ Result<T> - 统一响应结果
- ✅ PageResult<T> - 分页响应结果

### 3. 工具类
- ✅ JwtUtil - JWT生成和验证

## 📝 实现步骤

### 第一步：创建实体类（Entity）

#### 1. User.java - 用户实体
```java
@Data
@TableName("t_user")
public class User extends BaseEntity {
    private Long id;
    private String nickname;
    private String avatar;
    private String deviceId;      // U盾/SIMKey设备ID
    private String deviceType;    // 设备类型：UKEY/SIMKEY
    private String role;          // 角色：USER/ADMIN
    private String status;        // 状态：ACTIVE/BANNED
    private String bio;           // 简介
    private Integer postsCount;   // 帖子数
    private Integer repliesCount; // 回复数
    private Integer followersCount; // 粉丝数
    private Integer followingCount; // 关注数
    private Integer likesCount;   // 获赞数
}
```

#### 2. Post.java - 帖子实体
```java
@Data
@TableName("t_post")
public class Post extends BaseEntity {
    private Long id;
    private String title;
    private String content;
    private Long authorId;
    private Long categoryId;
    private String status;        // 状态：ACTIVE/PENDING/DELETED
    private Boolean isPinned;     // 是否置顶
    private Boolean isResolved;   // 是否已解决
    private Long bestAnswerId;    // 最佳答案ID
    private Integer viewsCount;   // 浏览数
    private Integer repliesCount; // 回复数
    private Integer likesCount;   // 点赞数
}
```

#### 3. Reply.java - 回复实体
```java
@Data
@TableName("t_reply")
public class Reply extends BaseEntity {
    private Long id;
    private Long postId;
    private Long authorId;
    private Long parentId;       // 父回复ID
    private String content;
    private Boolean isBestAnswer; // 是否最佳答案
    private Integer likesCount;
}
```

#### 4. Category.java - 分类实体
```java
@Data
@TableName("t_category")
public class Category {
    private Long id;
    private String name;
    private String slug;
    private String description;
    private String icon;
    private Integer postsCount;
    private Integer sort;
}
```

#### 5. Tag.java - 标签实体
```java
@Data
@TableName("t_tag")
public class Tag {
    private Long id;
    private String name;
    private String slug;
    private Integer postsCount;
}
```

#### 6. Notification.java - 通知实体
```java
@Data
@TableName("t_notification")
public class Notification extends BaseEntity {
    private Long id;
    private Long userId;
    private String type;    // 类型：REPLY/LIKE/FOLLOW/MENTION/SYSTEM
    private String title;
    private String message;
    private String link;
    private Boolean isRead;
}
```

#### 7. Message.java - 私信实体
```java
@Data
@TableName("t_message")
public class Message extends BaseEntity {
    private Long id;
    private Long conversationId;
    private Long senderId;
    private Long receiverId;
    private String content;
    private Boolean isRead;
}
```

### 第二步：创建配置类

#### 1. SecurityConfig.java
```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Autowired
    private JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .cors()
            .and()
            .sessionManagement()
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .authorizeHttpRequests()
            .requestMatchers("/auth/**", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
            .requestMatchers("/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated()
            .and()
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
```

#### 2. JwtAuthenticationFilter.java
```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private JwtUtil jwtUtil;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                  HttpServletResponse response,
                                  FilterChain filterChain) {
        String token = extractToken(request);

        if (token != null && !jwtUtil.isTokenExpired(token)) {
            Long userId = jwtUtil.getUserIdFromToken(token);
            String username = jwtUtil.getUsernameFromToken(token);
            String role = jwtUtil.getRoleFromToken(token);

            // 设置认证信息
            UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(userId, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        filterChain.doFilter(request, response);
    }
}
```

### 第三步：创建Mapper层

#### UserMapper.java
```java
@Mapper
public interface UserMapper extends BaseMapper<User> {
    // MyBatis Plus已提供基础CRUD方法
    // 自定义查询方法
    User findByDeviceId(String deviceId);
    List<User> findFollowers(Long userId, Integer page, Integer size);
    List<User> findFollowing(Long userId, Integer page, Integer size);
}
```

#### PostMapper.java
```java
@Mapper
public interface PostMapper extends BaseMapper<Post> {
    List<Post> findByCategory(Long categoryId, Integer page, Integer size);
    List<Post> findByTag(Long tagId, Integer page, Integer size);
    List<Post> searchPosts(String keyword, Integer page, Integer size);
}
```

### 第四步：创建Service层

#### AuthService.java
```java
@Service
public class AuthService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private JwtUtil jwtUtil;

    /**
     * U盾登录
     */
    public Result<Map<String, Object>> loginWithUKey(String deviceId, String pin) {
        // 1. 验证U盾设备和PIN码
        // 2. 查询或创建用户
        User user = userMapper.findByDeviceId(deviceId);
        if (user == null) {
            user = createUser(deviceId, "UKEY");
        }

        // 3. 生成JWT Token
        String token = jwtUtil.generateToken(user.getId(), user.getNickname(), user.getRole());

        // 4. 返回结果
        Map<String, Object> data = new HashMap<>();
        data.put("token", token);
        data.put("user", user);

        return Result.success(data);
    }
}
```

#### PostService.java
```java
@Service
public class PostService {

    @Autowired
    private PostMapper postMapper;

    /**
     * 获取帖子列表
     */
    public Result<PageResult<Post>> getPosts(Integer page, Integer size, String sortBy) {
        // 1. 构建查询条件
        Page<Post> postPage = new Page<>(page, size);

        // 2. 排序
        if ("latest".equals(sortBy)) {
            postPage.addOrder(OrderItem.desc("created_at"));
        } else if ("hot".equals(sortBy)) {
            postPage.addOrder(OrderItem.desc("views_count"));
        }

        // 3. 查询
        Page<Post> result = postMapper.selectPage(postPage, null);

        // 4. 返回分页结果
        PageResult<Post> pageResult = PageResult.of(
            result.getRecords(),
            result.getTotal(),
            page,
            size
        );

        return Result.success(pageResult);
    }

    /**
     * 创建帖子
     */
    public Result<Post> createPost(Post post) {
        // 1. 验证参数
        // 2. 保存帖子
        postMapper.insert(post);
        // 3. 更新用户帖子数
        // 4. 返回结果
        return Result.success(post);
    }
}
```

### 第五步：创建Controller层

#### AuthController.java
```java
@RestController
@RequestMapping("/auth")
@Tag(name = "认证管理")
public class AuthController {

    @Autowired
    private AuthService authService;

    @PostMapping("/login/ukey")
    @Operation(summary = "U盾登录")
    public Result<?> loginWithUKey(@RequestBody LoginRequest request) {
        return authService.loginWithUKey(request.getDeviceId(), request.getPin());
    }

    @PostMapping("/login/simkey")
    @Operation(summary = "SIMKey登录")
    public Result<?> loginWithSIMKey(@RequestBody LoginRequest request) {
        return authService.loginWithSIMKey(request.getSimId(), request.getPin());
    }

    @GetMapping("/current")
    @Operation(summary = "获取当前用户信息")
    public Result<User> getCurrentUser() {
        Long userId = getCurrentUserId();
        return authService.getCurrentUser(userId);
    }
}
```

#### PostController.java
```java
@RestController
@RequestMapping("/posts")
@Tag(name = "帖子管理")
public class PostController {

    @Autowired
    private PostService postService;

    @GetMapping
    @Operation(summary = "获取帖子列表")
    public Result<PageResult<Post>> getPosts(
        @RequestParam(defaultValue = "1") Integer page,
        @RequestParam(defaultValue = "20") Integer pageSize,
        @RequestParam(defaultValue = "latest") String sortBy
    ) {
        return postService.getPosts(page, pageSize, sortBy);
    }

    @GetMapping("/{id}")
    @Operation(summary = "获取帖子详情")
    public Result<Post> getPost(@PathVariable Long id) {
        return postService.getPostById(id);
    }

    @PostMapping
    @Operation(summary = "创建帖子")
    public Result<Post> createPost(@RequestBody @Valid PostRequest request) {
        return postService.createPost(request);
    }
}
```

## 🗄️ 数据库设计

### 核心表结构

#### 1. 用户表（t_user）
```sql
CREATE TABLE t_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    nickname VARCHAR(50) NOT NULL,
    avatar VARCHAR(255),
    device_id VARCHAR(100) UNIQUE NOT NULL,
    device_type VARCHAR(20) NOT NULL,
    role VARCHAR(20) DEFAULT 'USER',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    bio VARCHAR(500),
    posts_count INT DEFAULT 0,
    replies_count INT DEFAULT 0,
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    likes_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT DEFAULT 0
);
```

#### 2. 帖子表（t_post）
```sql
CREATE TABLE t_post (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    author_id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    is_pinned TINYINT DEFAULT 0,
    is_resolved TINYINT DEFAULT 0,
    best_answer_id BIGINT,
    views_count INT DEFAULT 0,
    replies_count INT DEFAULT 0,
    likes_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT DEFAULT 0,
    INDEX idx_author (author_id),
    INDEX idx_category (category_id),
    INDEX idx_created (created_at)
);
```

## 📚 实现优先级

### 高优先级（核心功能）
1. ✅ 通用响应类和工具类
2. 🔄 认证模块（Auth）
3. 🔄 帖子模块（Post）
4. 🔄 用户模块（User）

### 中优先级
5. 分类和标签模块
6. 回复模块
7. 通知模块
8. 私信模块

### 低优先级
9. 搜索模块
10. 管理后台模块
11. 文件上传
12. 邮件通知

## 🚀 快速开始

### 1. 创建数据库
```bash
mysql -u root -p
CREATE DATABASE chainlesschain_forum CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 运行建表脚本
```bash
mysql -u root -p chainlesschain_forum < src/main/resources/db/schema.sql
```

### 3. 启动应用
```bash
mvn spring-boot:run
```

### 4. 访问Swagger文档
```
http://localhost:8080/api/swagger-ui.html
```

## 📖 参考资源

- [Spring Boot官方文档](https://spring.io/projects/spring-boot)
- [MyBatis Plus官方文档](https://baomidou.com/)
- [JWT官方文档](https://jwt.io/)
- [前端API文档](./API_DOCUMENTATION.md)

---

**更新时间**: 2025-12-17
**版本**: v1.0
**状态**: 基础架构已完成，核心模块开发中
