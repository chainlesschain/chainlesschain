package com.chainlesschain.android.feature.project.model

import com.chainlesschain.android.core.database.entity.ProjectType

/**
 * Project template
 *
 * Defines a reusable project structure with predefined files and folders
 */
data class ProjectTemplate(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
    val category: TemplateCategory,
    val type: String = ProjectType.OTHER,
    val tags: List<String> = emptyList(),
    val structure: ProjectStructure,
    val metadata: Map<String, String> = emptyMap()
)

/**
 * Template category
 */
enum class TemplateCategory(val displayName: String) {
    ANDROID("Android"),
    WEB("Web 开发"),
    BACKEND("后端服务"),
    DATA_SCIENCE("数据科学"),
    MOBILE("移动开发"),
    DESKTOP("桌面应用"),
    LIBRARY("库/框架"),
    MULTIPLATFORM("跨平台"),
    FLUTTER("Flutter"),
    OTHER("其他")
}

/**
 * Project structure (files and folders)
 */
data class ProjectStructure(
    val folders: List<String> = emptyList(),
    val files: List<TemplateFile> = emptyList()
)

/**
 * Template file
 */
data class TemplateFile(
    val path: String,
    val content: String,
    val isExecutable: Boolean = false
)

/**
 * Predefined project templates
 */
object ProjectTemplates {

    /**
     * Get all available templates
     */
    fun getAllTemplates(): List<ProjectTemplate> {
        return listOf(
            androidAppTemplate,
            reactWebAppTemplate,
            nodeJsApiTemplate,
            pythonDataScienceTemplate,
            kotlinMultiplatformTemplate,
            springBootTemplate,
            flutterAppTemplate,
            vueWebAppTemplate,
            expressApiTemplate,
            djangoWebTemplate,
            emptyProjectTemplate
        )
    }

    /**
     * Get templates by category
     */
    fun getTemplatesByCategory(category: TemplateCategory): List<ProjectTemplate> {
        return getAllTemplates().filter { it.category == category }
    }

    /**
     * Get template by ID
     */
    fun getTemplateById(id: String): ProjectTemplate? {
        return getAllTemplates().find { it.id == id }
    }

    // ===== Template Definitions =====

    val emptyProjectTemplate = ProjectTemplate(
        id = "empty",
        name = "空白项目",
        description = "从头开始的空白项目",
        icon = "📄",
        category = TemplateCategory.OTHER,
        type = ProjectType.OTHER,
        structure = ProjectStructure()
    )

    val androidAppTemplate = ProjectTemplate(
        id = "android-app",
        name = "Android 应用",
        description = "标准 Android 应用项目结构",
        icon = "🤖",
        category = TemplateCategory.ANDROID,
        type = ProjectType.ANDROID,
        tags = listOf("android", "kotlin", "mobile"),
        structure = ProjectStructure(
            folders = listOf(
                "app/src/main/java",
                "app/src/main/res/layout",
                "app/src/main/res/drawable",
                "app/src/main/res/values",
                "app/src/test/java",
                "app/src/androidTest/java"
            ),
            files = listOf(
                TemplateFile(
                    "app/build.gradle.kts",
                    """
                    plugins {
                        id("com.android.application")
                        id("org.jetbrains.kotlin.android")
                    }

                    android {
                        namespace = "com.example.myapp"
                        compileSdk = 34

                        defaultConfig {
                            applicationId = "com.example.myapp"
                            minSdk = 24
                            targetSdk = 34
                            versionCode = 1
                            versionName = "1.0"
                        }

                        compileOptions {
                            sourceCompatibility = JavaVersion.VERSION_17
                            targetCompatibility = JavaVersion.VERSION_17
                        }

                        kotlinOptions {
                            jvmTarget = "17"
                        }
                    }

                    dependencies {
                        implementation("androidx.core:core-ktx:1.12.0")
                        implementation("androidx.appcompat:appcompat:1.6.1")
                        implementation("com.google.android.material:material:1.11.0")
                        testImplementation("junit:junit:4.13.2")
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "app/src/main/java/MainActivity.kt",
                    """
                    package com.example.myapp

                    import android.os.Bundle
                    import androidx.appcompat.app.AppCompatActivity

                    class MainActivity : AppCompatActivity() {
                        override fun onCreate(savedInstanceState: Bundle?) {
                            super.onCreate(savedInstanceState)
                            setContentView(R.layout.activity_main)
                        }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "app/src/main/AndroidManifest.xml",
                    """
                    <?xml version="1.0" encoding="utf-8"?>
                    <manifest xmlns:android="http://schemas.android.com/apk/res/android">
                        <application
                            android:allowBackup="true"
                            android:icon="@mipmap/ic_launcher"
                            android:label="@string/app_name"
                            android:theme="@style/Theme.MyApp">
                            <activity
                                android:name=".MainActivity"
                                android:exported="true">
                                <intent-filter>
                                    <action android:name="android.intent.action.MAIN" />
                                    <category android:name="android.intent.category.LAUNCHER" />
                                </intent-filter>
                            </activity>
                        </application>
                    </manifest>
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Android App

                    A standard Android application project.

                    ## Setup

                    1. Open project in Android Studio
                    2. Sync Gradle
                    3. Run on emulator or device

                    ## Structure

                    - `app/` - Main application module
                    - `app/src/main/` - Source code
                    - `app/src/test/` - Unit tests
                    """.trimIndent()
                )
            )
        )
    )

    val reactWebAppTemplate = ProjectTemplate(
        id = "react-webapp",
        name = "React Web 应用",
        description = "React + TypeScript 前端项目",
        icon = "⚛️",
        category = TemplateCategory.WEB,
        type = ProjectType.WEB,
        tags = listOf("react", "typescript", "web", "frontend"),
        structure = ProjectStructure(
            folders = listOf(
                "src/components",
                "src/pages",
                "src/hooks",
                "src/utils",
                "src/styles",
                "public"
            ),
            files = listOf(
                TemplateFile(
                    "package.json",
                    """
                    {
                      "name": "my-react-app",
                      "version": "1.0.0",
                      "private": true,
                      "dependencies": {
                        "react": "^18.2.0",
                        "react-dom": "^18.2.0",
                        "typescript": "^5.0.0"
                      },
                      "scripts": {
                        "start": "react-scripts start",
                        "build": "react-scripts build",
                        "test": "react-scripts test"
                      }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "src/App.tsx",
                    """
                    import React from 'react';
                    import './App.css';

                    function App() {
                      return (
                        <div className="App">
                          <header className="App-header">
                            <h1>Welcome to React</h1>
                          </header>
                        </div>
                      );
                    }

                    export default App;
                    """.trimIndent()
                ),
                TemplateFile(
                    "src/index.tsx",
                    """
                    import React from 'react';
                    import ReactDOM from 'react-dom/client';
                    import './index.css';
                    import App from './App';

                    const root = ReactDOM.createRoot(
                      document.getElementById('root') as HTMLElement
                    );
                    root.render(
                      <React.StrictMode>
                        <App />
                      </React.StrictMode>
                    );
                    """.trimIndent()
                ),
                TemplateFile(
                    "tsconfig.json",
                    """
                    {
                      "compilerOptions": {
                        "target": "ES2020",
                        "lib": ["ES2020", "DOM"],
                        "jsx": "react-jsx",
                        "module": "ESNext",
                        "moduleResolution": "node",
                        "strict": true,
                        "esModuleInterop": true
                      },
                      "include": ["src"]
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # React Web App

                    A React + TypeScript web application.

                    ## Getting Started

                    ```bash
                    npm install
                    npm start
                    ```

                    ## Available Scripts

                    - `npm start` - Run development server
                    - `npm build` - Build for production
                    - `npm test` - Run tests
                    """.trimIndent()
                )
            )
        )
    )

    val nodeJsApiTemplate = ProjectTemplate(
        id = "nodejs-api",
        name = "Node.js API",
        description = "Express + TypeScript REST API",
        icon = "🟢",
        category = TemplateCategory.BACKEND,
        type = ProjectType.BACKEND,
        tags = listOf("nodejs", "typescript", "api", "backend"),
        structure = ProjectStructure(
            folders = listOf(
                "src/routes",
                "src/controllers",
                "src/models",
                "src/middlewares",
                "src/utils",
                "tests"
            ),
            files = listOf(
                TemplateFile(
                    "package.json",
                    """
                    {
                      "name": "my-api",
                      "version": "1.0.0",
                      "main": "dist/index.js",
                      "scripts": {
                        "start": "node dist/index.js",
                        "dev": "ts-node-dev src/index.ts",
                        "build": "tsc",
                        "test": "jest"
                      },
                      "dependencies": {
                        "express": "^4.18.2",
                        "dotenv": "^16.0.3"
                      },
                      "devDependencies": {
                        "@types/express": "^4.17.17",
                        "@types/node": "^20.0.0",
                        "typescript": "^5.0.0",
                        "ts-node-dev": "^2.0.0"
                      }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "src/index.ts",
                    """
                    import express from 'express';
                    import dotenv from 'dotenv';

                    dotenv.config();

                    const app = express();
                    const PORT = process.env.PORT || 3000;

                    app.use(express.json());

                    app.get('/health', (req, res) => {
                      res.json({ status: 'ok' });
                    });

                    app.listen(PORT, () => {
                      console.log(`Server running on port ${'$'}{PORT}`);
                    });
                    """.trimIndent()
                ),
                TemplateFile(
                    "tsconfig.json",
                    """
                    {
                      "compilerOptions": {
                        "target": "ES2020",
                        "module": "commonjs",
                        "outDir": "./dist",
                        "rootDir": "./src",
                        "strict": true,
                        "esModuleInterop": true,
                        "skipLibCheck": true
                      },
                      "include": ["src/**/*"],
                      "exclude": ["node_modules", "dist"]
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    ".env.example",
                    """
                    PORT=3000
                    NODE_ENV=development
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Node.js API

                    A RESTful API built with Express and TypeScript.

                    ## Setup

                    ```bash
                    npm install
                    cp .env.example .env
                    npm run dev
                    ```

                    ## Scripts

                    - `npm run dev` - Development server with hot reload
                    - `npm run build` - Build for production
                    - `npm start` - Start production server
                    """.trimIndent()
                )
            )
        )
    )

    val pythonDataScienceTemplate = ProjectTemplate(
        id = "python-datascience",
        name = "Python 数据科学",
        description = "数据分析和机器学习项目",
        icon = "🐍",
        category = TemplateCategory.DATA_SCIENCE,
        type = ProjectType.DATA_SCIENCE,
        tags = listOf("python", "data-science", "ml", "analytics"),
        structure = ProjectStructure(
            folders = listOf(
                "data/raw",
                "data/processed",
                "notebooks",
                "src",
                "models",
                "reports"
            ),
            files = listOf(
                TemplateFile(
                    "requirements.txt",
                    """
                    numpy==1.24.3
                    pandas==2.0.2
                    matplotlib==3.7.1
                    seaborn==0.12.2
                    scikit-learn==1.2.2
                    jupyter==1.0.0
                    """.trimIndent()
                ),
                TemplateFile(
                    "src/data_loader.py",
                    """
                    import pandas as pd

                    def load_data(file_path):
                        \"\"\"Load data from CSV file\"\"\"
                        return pd.read_csv(file_path)

                    def save_data(df, file_path):
                        \"\"\"Save DataFrame to CSV\"\"\"
                        df.to_csv(file_path, index=False)
                    """.trimIndent()
                ),
                TemplateFile(
                    "notebooks/exploratory_analysis.ipynb",
                    """
                    {
                      "cells": [],
                      "metadata": {},
                      "nbformat": 4,
                      "nbformat_minor": 4
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Python Data Science Project

                    A data science project template with common tools.

                    ## Setup

                    ```bash
                    python -m venv venv
                    source venv/bin/activate
                    pip install -r requirements.txt
                    ```

                    ## Structure

                    - `data/` - Data files (raw and processed)
                    - `notebooks/` - Jupyter notebooks
                    - `src/` - Python modules
                    - `models/` - Trained models
                    - `reports/` - Analysis reports
                    """.trimIndent()
                )
            )
        )
    )

    val kotlinMultiplatformTemplate = ProjectTemplate(
        id = "kotlin-multiplatform",
        name = "Kotlin Multiplatform",
        description = "跨平台 Kotlin 项目",
        icon = "🎯",
        category = TemplateCategory.MOBILE,
        type = ProjectType.MULTIPLATFORM,
        tags = listOf("kotlin", "multiplatform", "mobile"),
        structure = ProjectStructure(
            folders = listOf(
                "shared/src/commonMain/kotlin",
                "shared/src/androidMain/kotlin",
                "shared/src/iosMain/kotlin",
                "androidApp/src/main/kotlin",
                "iosApp"
            ),
            files = listOf(
                TemplateFile(
                    "shared/build.gradle.kts",
                    """
                    plugins {
                        kotlin("multiplatform")
                        id("com.android.library")
                    }

                    kotlin {
                        android()
                        ios()

                        sourceSets {
                            val commonMain by getting
                            val androidMain by getting
                            val iosMain by getting
                        }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Kotlin Multiplatform Project

                    Share code between Android and iOS.

                    ## Structure

                    - `shared/` - Shared Kotlin code
                    - `androidApp/` - Android app
                    - `iosApp/` - iOS app
                    """.trimIndent()
                )
            )
        )
    )

    val springBootTemplate = ProjectTemplate(
        id = "spring-boot",
        name = "Spring Boot API",
        description = "Spring Boot REST API 项目",
        icon = "🍃",
        category = TemplateCategory.BACKEND,
        type = ProjectType.BACKEND,
        tags = listOf("java", "spring", "backend", "api"),
        structure = ProjectStructure(
            folders = listOf(
                "src/main/java/com/example/demo/controller",
                "src/main/java/com/example/demo/service",
                "src/main/java/com/example/demo/model",
                "src/main/java/com/example/demo/repository",
                "src/main/resources",
                "src/test/java"
            ),
            files = listOf(
                TemplateFile(
                    "pom.xml",
                    """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <project>
                        <modelVersion>4.0.0</modelVersion>
                        <groupId>com.example</groupId>
                        <artifactId>demo</artifactId>
                        <version>0.0.1-SNAPSHOT</version>
                        <parent>
                            <groupId>org.springframework.boot</groupId>
                            <artifactId>spring-boot-starter-parent</artifactId>
                            <version>3.2.0</version>
                        </parent>
                        <dependencies>
                            <dependency>
                                <groupId>org.springframework.boot</groupId>
                                <artifactId>spring-boot-starter-web</artifactId>
                            </dependency>
                        </dependencies>
                    </project>
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Spring Boot API

                    A RESTful API built with Spring Boot.

                    ## Run

                    ```bash
                    ./mvnw spring-boot:run
                    ```
                    """.trimIndent()
                )
            )
        )
    )

    val flutterAppTemplate = ProjectTemplate(
        id = "flutter-app",
        name = "Flutter 应用",
        description = "跨平台 Flutter 移动应用",
        icon = "🦋",
        category = TemplateCategory.MOBILE,
        type = ProjectType.FLUTTER,
        tags = listOf("flutter", "dart", "mobile"),
        structure = ProjectStructure(
            folders = listOf(
                "lib/screens",
                "lib/widgets",
                "lib/models",
                "lib/services",
                "assets/images",
                "test"
            ),
            files = listOf(
                TemplateFile(
                    "pubspec.yaml",
                    """
                    name: my_flutter_app
                    description: A Flutter application
                    version: 1.0.0+1

                    environment:
                      sdk: '>=3.0.0 <4.0.0'

                    dependencies:
                      flutter:
                        sdk: flutter
                    """.trimIndent()
                ),
                TemplateFile(
                    "lib/main.dart",
                    """
                    import 'package:flutter/material.dart';

                    void main() {
                      runApp(const MyApp());
                    }

                    class MyApp extends StatelessWidget {
                      const MyApp({Key? key}) : super(key: key);

                      @override
                      Widget build(BuildContext context) {
                        return MaterialApp(
                          title: 'Flutter App',
                          theme: ThemeData(
                            primarySwatch: Colors.blue,
                          ),
                          home: const HomePage(),
                        );
                      }
                    }

                    class HomePage extends StatelessWidget {
                      const HomePage({Key? key}) : super(key: key);

                      @override
                      Widget build(BuildContext context) {
                        return Scaffold(
                          appBar: AppBar(
                            title: const Text('Home'),
                          ),
                          body: const Center(
                            child: Text('Hello Flutter!'),
                          ),
                        );
                      }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Flutter App

                    A cross-platform Flutter application.

                    ## Getting Started

                    ```bash
                    flutter pub get
                    flutter run
                    ```
                    """.trimIndent()
                )
            )
        )
    )

    val vueWebAppTemplate = ProjectTemplate(
        id = "vue-webapp",
        name = "Vue Web 应用",
        description = "Vue 3 + TypeScript 前端项目",
        icon = "💚",
        category = TemplateCategory.WEB,
        type = ProjectType.WEB,
        tags = listOf("vue", "typescript", "web", "frontend"),
        structure = ProjectStructure(
            folders = listOf(
                "src/components",
                "src/views",
                "src/router",
                "src/stores",
                "src/assets",
                "public"
            ),
            files = listOf(
                TemplateFile(
                    "package.json",
                    """
                    {
                      "name": "my-vue-app",
                      "version": "1.0.0",
                      "scripts": {
                        "dev": "vite",
                        "build": "vite build"
                      },
                      "dependencies": {
                        "vue": "^3.3.0",
                        "vue-router": "^4.2.0",
                        "pinia": "^2.1.0"
                      },
                      "devDependencies": {
                        "@vitejs/plugin-vue": "^4.2.0",
                        "typescript": "^5.0.0",
                        "vite": "^4.3.0"
                      }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Vue Web App

                    A Vue 3 + TypeScript application.

                    ## Setup

                    ```bash
                    npm install
                    npm run dev
                    ```
                    """.trimIndent()
                )
            )
        )
    )

    val expressApiTemplate = ProjectTemplate(
        id = "express-api",
        name = "Express API",
        description = "简单的 Express REST API",
        icon = "🚂",
        category = TemplateCategory.BACKEND,
        type = ProjectType.BACKEND,
        tags = listOf("nodejs", "express", "api"),
        structure = ProjectStructure(
            folders = listOf("routes", "controllers", "models", "middleware"),
            files = listOf(
                TemplateFile(
                    "package.json",
                    """
                    {
                      "name": "express-api",
                      "version": "1.0.0",
                      "main": "index.js",
                      "scripts": {
                        "start": "node index.js",
                        "dev": "nodemon index.js"
                      },
                      "dependencies": {
                        "express": "^4.18.2"
                      }
                    }
                    """.trimIndent()
                ),
                TemplateFile(
                    "index.js",
                    """
                    const express = require('express');
                    const app = express();
                    const PORT = process.env.PORT || 3000;

                    app.use(express.json());

                    app.get('/', (req, res) => {
                      res.json({ message: 'API is running' });
                    });

                    app.listen(PORT, () => {
                      console.log(`Server on port ${'$'}{PORT}`);
                    });
                    """.trimIndent()
                )
            )
        )
    )

    val djangoWebTemplate = ProjectTemplate(
        id = "django-web",
        name = "Django Web 应用",
        description = "Python Django 全栈项目",
        icon = "🎸",
        category = TemplateCategory.WEB,
        type = ProjectType.WEB,
        tags = listOf("python", "django", "web", "fullstack"),
        structure = ProjectStructure(
            folders = listOf(
                "mysite",
                "mysite/settings",
                "apps",
                "templates",
                "static"
            ),
            files = listOf(
                TemplateFile(
                    "requirements.txt",
                    """
                    Django==4.2.0
                    django-environ==0.10.0
                    """.trimIndent()
                ),
                TemplateFile(
                    "manage.py",
                    """
                    #!/usr/bin/env python
                    import os
                    import sys

                    if __name__ == '__main__':
                        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')
                        from django.core.management import execute_from_command_line
                        execute_from_command_line(sys.argv)
                    """.trimIndent(),
                    isExecutable = true
                ),
                TemplateFile(
                    "README.md",
                    """
                    # Django Web Application

                    A full-stack web application built with Django.

                    ## Setup

                    ```bash
                    pip install -r requirements.txt
                    python manage.py migrate
                    python manage.py runserver
                    ```
                    """.trimIndent()
                )
            )
        )
    )
}
