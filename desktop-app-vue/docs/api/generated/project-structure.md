# project-structure

**Source**: `src/main/project/project-structure.js`

**Generated**: 2026-02-17T10:13:18.207Z

---

## const

```javascript
const
```

* 项目文件夹结构管理器
 * 定义和创建不同类型项目的标准目录结构
 * 与 Android 端对齐的 12 种项目类型

---

## async createStructure(

```javascript
async createStructure(
```

/*"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2,
      ),

      nodejs_index: `import app from './app';
import { config } from './config';

const PORT = config.port || 3000;

app.listen(PORT, () => {
  console.log(\`Server is running on port \${PORT}\`);
});
`,

      nodejs_app: `import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import { loggerMiddleware } from './middlewares/logger';
import routes from './routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(loggerMiddleware);

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

export default app;
`,

      nodejs_config: `import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbUrl: process.env.DATABASE_URL,
};
`,

      nodejs_routes: `import { Router } from 'express';
import apiRoutes from './api';

const router = Router();

router.use('/', apiRoutes);

export default router;
`,

      nodejs_api_routes: `import { Router } from 'express';
import { healthCheck } from '../controllers/healthController';

const router = Router();

router.get('/health', healthCheck);

export default router;
`,

      nodejs_health_controller: `import { Request, Response } from 'express';

export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};
`,

      nodejs_error_handler: `import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};
`,

      nodejs_logger_middleware: `import { Request, Response, NextFunction } from 'express';

export const loggerMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path}\`);
  next();
};
`,

      nodejs_env_example: `PORT=3000
NODE_ENV=development
DATABASE_URL=
`,

      // ============================================================
      // Python 数据科学模板
      // ============================================================

      python_ds_requirements: `# Data Science
numpy>=1.24.0
pandas>=2.0.0
scipy>=1.10.0

# Visualization
matplotlib>=3.7.0
seaborn>=0.12.0
plotly>=5.14.0

# Jupyter
jupyter>=1.0.0
jupyterlab>=4.0.0

# Machine Learning
scikit-learn>=1.3.0

# Utilities
python-dotenv>=1.0.0
tqdm>=4.65.0
`,

      python_ds_notebook: JSON.stringify(
        {
          cells: [
            {
              cell_type: "markdown",
              metadata: {},
              source: ["# 数据探索\n", "\n", "初始数据探索与分析"],
            },
            {
              cell_type: "code",
              execution_count: null,
              metadata: {},
              outputs: [],
              source: [
                "import numpy as np\n",
                "import pandas as pd\n",
                "import matplotlib.pyplot as plt\n",
                "import seaborn as sns\n",
                "\n",
                "# 设置样式\n",
                "plt.style.use('seaborn-v0_8-whitegrid')\n",
                "%matplotlib inline",
              ],
            },
            {
              cell_type: "markdown",
              metadata: {},
              source: ["## 数据加载"],
            },
            {
              cell_type: "code",
              execution_count: null,
              metadata: {},
              outputs: [],
              source: ["# df = pd.read_csv('../data/raw/data.csv')"],
            },
          ],
          metadata: {
            kernelspec: {
              display_name: "Python 3",
              language: "python",
              name: "python3",
            },
          },
          nbformat: 4,
          nbformat_minor: 4,
        },
        null,
        2,
      ),

      python_ds_setup: `from setuptools import setup, find_packages

setup(
    name="data-science-project",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "numpy",
        "pandas",
        "scikit-learn",
    ],
)
`,

      python_ds_pyproject: `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "data-science-project"
version = "0.1.0"
description = "Data science project"
readme = "README.md"
requires-python = ">=3.9"
`,

      python_ds_load_data: `"""
Data loading utilities.
"""
import pandas as pd
from pathlib import Path


def load_raw_data(filename: str) -> pd.DataFrame:
    """Load raw data from the data/raw directory."""
    data_dir = Path(__file__).parents[2] / "data" / "raw"
    return pd.read_csv(data_dir / filename)


def save_processed_data(df: pd.DataFrame, filename: str) -> None:
    """Save processed data to the data/processed directory."""
    data_dir = Path(__file__).parents[2] / "data" / "processed"
    data_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(data_dir / filename, index=False)
`,

      python_ds_build_features: `"""
Feature engineering utilities.
"""
import pandas as pd


def create_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create features from raw data."""
    # Add feature engineering logic here
    return df
`,

      python_ds_train_model: `"""
Model training utilities.
"""
from sklearn.model_selection import train_test_split


def train_model(X, y, test_size=0.2, random_state=42):
    """Train a model on the given data."""
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )
    # Add model training logic here
    return None
`,

      python_ds_visualize: `"""
Visualization utilities.
"""
import matplotlib.pyplot as plt
import seaborn as sns


def plot_distribution(data, column, title=None):
    """Plot the distribution of a column."""
    fig, ax = plt.subplots(figsize=(10, 6))
    sns.histplot(data[column], ax=ax)
    ax.set_title(title or f"Distribution of {column}")
    return fig
`,

      // ============================================================
      // AI/ML 模板
      // ============================================================

      ai_requirements: `# Deep Learning
torch>=2.0.0
torchvision>=0.15.0
transformers>=4.30.0

# Data Processing
numpy>=1.24.0
pandas>=2.0.0

# Experiment Tracking
wandb>=0.15.0
tensorboard>=2.13.0

# Utilities
pyyaml>=6.0
tqdm>=4.65.0
python-dotenv>=1.0.0
`,

      ai_train: `"""
Training script for ML models.
"""
import argparse
import yaml
from pathlib import Path


def load_config(config_path: str) -> dict:
    """Load configuration from YAML file."""
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def train(config: dict) -> None:
    """Train the model with given configuration."""
    print(f"Training with config: {config}")
    # Add training logic here


def main():
    parser = argparse.ArgumentParser(description='Train ML model')
    parser.add_argument('--config', type=str, default='configs/config.yaml',
                        help='Path to configuration file')
    args = parser.parse_args()

    config = load_config(args.config)
    train(config)


if __name__ == '__main__':
    main()
`,

      ai_config: `# Model Configuration
model:
  name: "model_v1"
  hidden_size: 256
  num_layers: 4

# Training Configuration
training:
  batch_size: 32
  learning_rate: 0.001
  epochs: 100
  early_stopping: true
  patience: 10

# Data Configuration
data:
  train_path: "data/processed/train.csv"
  val_path: "data/processed/val.csv"
  test_path: "data/processed/test.csv"

# Logging
logging:
  log_dir: "logs"
  save_every: 10
`,

      // ============================================================
      // IoT 模板
      // ============================================================

      iot_platformio: `[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
`,

      iot_main: `#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    Serial.println("IoT Device Starting...");

    // Initialize your hardware here
}

void loop() {
    // Main loop logic here
    delay(1000);
}
`,

      // ============================================================
      // 嵌入式 模板
      // ============================================================

      embedded_cmake: `cmake_minimum_required(VERSION 3.16)
project(embedded_project C)

set(CMAKE_C_STANDARD 11)

include_directories(include)

file(GLOB SOURCES "src/*.c")
add_executable(\${PROJECT_NAME} \${SOURCES})
`,

      embedded_main: `#include <stdio.h>

int main(void) {
    printf("Embedded System Starting...\\n");

    // Initialize hardware

    while (1) {
        // Main loop
    }

    return 0;
}
`,

      // ============================================================
      // 游戏开发 模板
      // ============================================================

      game_package_json: (projectName) =>
        JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/\s+/g, "-"),
            version: "1.0.0",
            description: "游戏项目",
            main: "src/main.js",
            scripts: {
              dev: "vite",
              build: "vite build",
            },
            dependencies: {},
            devDependencies: {
              vite: "^5.0.0",
            },
            keywords: ["game"],
            author: "",
            license: "MIT",
          },
          null,
          2,
        ),

      game_main: `// Game entry point
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.lastTime = 0;
  }

  init() {
    console.log('Game initialized');
    this.gameLoop(0);
  }

  update(deltaTime) {
    // Update game logic
  }

  render() {
    // Render game
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  gameLoop(currentTime) {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

const game = new Game();
game.init();
`,

      // ============================================================
      // iOS 模板
      // ============================================================

      ios_package_swift: `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MyApp",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .executable(name: "MyApp", targets: ["App"])
    ],
    targets: [
        .executableTarget(
            name: "App",
            dependencies: [],
            path: "Sources/App"
        )
    ]
)
`,

      ios_app: `import SwiftUI

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`,

      ios_content_view: `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`,

      // ============================================================
      // Android 模板
      // ============================================================

      android_build_gradle_root: `// Top-level build file
plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.20" apply false
}
`,

      android_settings_gradle: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "MyApp"
include(":app")
`,

      android_gradle_properties: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,

      android_build_gradle_app: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
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
}
`,

      android_manifest: `<?xml version="1.0" encoding="utf-8"?>
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
`,

      android_main_activity: `package com.example.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
`,

      android_main_fragment: `package com.example.app.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.example.app.R

class MainFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_main, container, false)
    }
}
`,

      android_main_viewmodel: `package com.example.app.viewmodel

import androidx.lifecycle.ViewModel

class MainViewModel : ViewModel() {
    // ViewModel logic here
}
`,

      android_layout_activity: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World!"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`,

      android_layout_fragment: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

</LinearLayout>
`,

      android_strings: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My App</string>
</resources>
`,

      android_colors: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="purple_200">#FFBB86FC</color>
    <color name="purple_500">#FF6200EE</color>
    <color name="purple_700">#FF3700B3</color>
    <color name="teal_200">#FF03DAC5</color>
    <color name="teal_700">#FF018786</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`,

      android_themes: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.MyApp" parent="Theme.MaterialComponents.DayNight.DarkActionBar">
        <item name="colorPrimary">@color/purple_500</item>
        <item name="colorPrimaryVariant">@color/purple_700</item>
        <item name="colorOnPrimary">@color/white</item>
    </style>
</resources>
`,
    };
  }

  /**
   * 创建项目结构
   * @param {string} projectPath - 项目根路径
   * @param {string} projectType - 项目类型
   * @param {string} projectName - 项目名称
   * @returns {Promise<Object>} 创建结果

---

## getStructure(projectType)

```javascript
getStructure(projectType)
```

* 获取项目结构定义
   * @param {string} projectType - 项目类型
   * @returns {Object} 结构定义

---

## getProjectTypes()

```javascript
getProjectTypes()
```

* 获取所有项目类型
   * @returns {Array} 项目类型列表

---

## async validateStructure(projectPath, projectType)

```javascript
async validateStructure(projectPath, projectType)
```

* 验证项目结构
   * @param {string} projectPath - 项目路径
   * @param {string} projectType - 项目类型
   * @returns {Promise<Object>} 验证结果

---

## addProjectType(type, structure)

```javascript
addProjectType(type, structure)
```

* 添加自定义项目类型
   * @param {string} type - 类型标识
   * @param {Object} structure - 结构定义

---

## getTemplateById(templateId)

```javascript
getTemplateById(templateId)
```

* 根据模板ID获取模板
   * @param {string} templateId - 模板ID
   * @returns {Object|null} 模板对象

---

## getTemplatesByCategory(category)

```javascript
getTemplatesByCategory(category)
```

* 根据分类获取模板
   * @param {string} category - 分类
   * @returns {Array} 模板列表

---

## getTemplatesByProjectType(projectType)

```javascript
getTemplatesByProjectType(projectType)
```

* 根据项目类型获取模板
   * @param {string} projectType - 项目类型
   * @returns {Array} 模板列表

---

## async createFromTemplate(projectPath, templateId, projectName = "My Project")

```javascript
async createFromTemplate(projectPath, templateId, projectName = "My Project")
```

* 从模板创建项目结构
   * @param {string} projectPath - 项目路径
   * @param {string} templateId - 模板ID
   * @param {string} projectName - 项目名称
   * @returns {Promise<Object>} 创建结果

---

## getProjectTypeInfo(projectType)

```javascript
getProjectTypeInfo(projectType)
```

* 获取项目类型信息
   * @param {string} projectType - 项目类型
   * @returns {Object|null} 项目类型信息

---

## getAllProjectTypeInfo()

```javascript
getAllProjectTypeInfo()
```

* 获取所有项目类型信息
   * @returns {Array} 项目类型信息列表

---

