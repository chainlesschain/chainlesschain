# extended-tools-project

**Source**: `src/main/ai-engine/extended-tools-project.js`

**Generated**: 2026-02-17T10:13:18.280Z

---

## const

```javascript
const
```

* 项目初始化工具的handler实现
 * 提供NPM、Python、Docker等项目初始化功能

---

## async tool_npm_project_setup(params)

```javascript
async tool_npm_project_setup(params)
```

* NPM项目初始化

---

## async tool_package_json_builder(params)

```javascript
async tool_package_json_builder(params)
```

* package.json构建器

---

## async tool_python_project_setup(params)

```javascript
async tool_python_project_setup(params)
```

* Python项目初始化

---

## async tool_requirements_generator(params)

```javascript
async tool_requirements_generator(params)
```

* requirements.txt生成器

---

## async tool_dockerfile_generator(params)

```javascript
async tool_dockerfile_generator(params)
```

* Dockerfile生成器

---

## async tool_gitignore_generator(params)

```javascript
async tool_gitignore_generator(params)
```

* .gitignore生成器

---

## getGitignoreTemplate(template)

```javascript
getGitignoreTemplate(template)
```

* 获取gitignore模板

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* 注册所有工具到FunctionCaller

---

