# GEMINI.md - ChainlessChain Project Context

This document provides a comprehensive overview of the `ChainlessChain` project for the Gemini AI assistant. It outlines the project's architecture, key components, and development procedures.

## Project Overview

ChainlessChain is a decentralized, privacy-first, AI-native personal assistant platform. It is designed as a monorepo containing multiple applications that work together. The core functionalities include:

1.  **Knowledge Management**: A "second brain" for notes, documents, and conversations with AI-powered retrieval (RAG).
2.  **Decentralized Social Networking**: P2P communication based on W3C DID standards.
3.  **Decentralized Transaction Assistance**: AI-powered matching and smart contract integration.

The system places a strong emphasis on security, utilizing hardware-level encryption via U-Shields (PC) and SIMKeys (mobile). Data is stored locally on user devices, and the AI models run locally to ensure privacy.

## Project Structure (Monorepo)

The repository is a monorepo containing several distinct, but interconnected, sub-projects:

-   `desktop-app-vue/`: The primary desktop application built with **Electron** and **Vue3**. This is the most mature part of the project.
-   `android-app/`: Android native application built with **Kotlin** and **Jetpack Compose**.
-   `backend/`: Holds the backend services, primarily managed through Docker.
    -   `docker/`: Contains `docker-compose.yml` to run AI services like **Ollama**, **Qdrant**, and optionally **AnythingLLM** and **Gitea**.
-   `community-forum/`: A Java and Vue-based community forum application.
-   `manufacturer-system/`: A separate system for manufacturers, likely related to the U-Shield/SIMKey hardware.
-   `website/`: The public-facing website for the project.
-   `docs/`: Contains detailed project documentation, including system design and development guides.

## Key Technologies

-   **Desktop App**: Electron, React, TypeScript, Zustand, Ant Design, SQLite (SQLCipher), `isomorphic-git`.
-   **Desktop App (Vue)**: Electron, Vue.js 3, Pinia, Ant Design Vue, `isomorphic-git`.
-   **AI Services**: Docker, Ollama (for local LLMs), Qdrant (for vector search/RAG).
-   **Mobile App (Android)**: Kotlin, Jetpack Compose, Room.
-   **Monorepo Management**: npm Workspaces.

## Getting Started: Running the Desktop App

The primary focus for development currently appears to be the `desktop-app-vue`.

### 1. Install Dependencies

This project uses `npm` workspaces.

```bash
# Install dependencies for all workspaces from the root directory
npm install
```

### 2. Start Backend AI Services

The core AI functionalities run in Docker containers.

```bash
# Navigate to the docker directory
cd backend/docker

# Start the services in detached mode
# This will pull and run Ollama and Qdrant
docker-compose up -d
```

### 3. Run the Desktop App (Development Mode)

Once dependencies are installed and the backend is running, you can start the Electron application.

```bash
# From the root directory
npm run dev:desktop
```

This will launch the React-based desktop application in development mode.

## Key Development Scripts

The root `package.json` contains several scripts for managing the project:

-   `npm run dev:desktop`: Starts the React desktop app in development mode.
-   `npm run dev:desktop-vue`: Starts the Vue desktop app in development mode.
-   `npm run build:desktop`: Builds the React desktop app for production.
-   `npm run docker:up`: Starts the backend Docker services.
-   `npm run docker:down`: Stops the backend Docker services.
-   `npm run docker:logs`: Tails the logs from the running Docker containers.
-   `npm test`: Runs tests across all workspaces.
-   `npm run lint`: Lints the entire project.
-   `npm run format`: Formats code using Prettier.
-   `npm run clean`: Removes build artifacts and caches.

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：GEMINI.md - ChainlessChain Project Context。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
