# 使用多阶段构建
FROM maven:3.8-openjdk-17 AS build

WORKDIR /app

# 复制pom.xml并下载依赖(利用Docker缓存)
COPY pom.xml .
RUN mvn dependency:go-offline -B

# 复制源代码并编译
COPY src ./src
RUN mvn clean package -DskipTests -B

# 运行阶段
FROM openjdk:17-jdk-slim

WORKDIR /app

# 复制编译好的jar包
COPY --from=build /app/target/*.jar app.jar

# 创建日志目录
RUN mkdir -p /app/logs /app/uploads

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 暴露端口
EXPOSE 8080

# 启动命令
ENTRYPOINT ["java", "-jar", "-Xms512m", "-Xmx1024m", "-Dspring.profiles.active=prod", "/app/app.jar"]
