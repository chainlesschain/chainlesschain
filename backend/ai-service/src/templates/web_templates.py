"""
Web项目预定义模板
提供常见Web项目的快速模板，无需LLM生成
"""

# 待办事项应用模板
TODO_APP_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>待办事项管理</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>我的待办事项</h1>
        <div class="input-section">
            <input type="text" id="taskInput" placeholder="输入新任务...">
            <button id="addBtn">添加</button>
        </div>
        <ul id="taskList"></ul>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    border-radius: 15px;
    padding: 30px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    width: 100%;
    max-width: 500px;
}

h1 {
    color: #333;
    margin-bottom: 20px;
    text-align: center;
}

.input-section {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
}

#taskInput {
    flex: 1;
    padding: 12px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 16px;
    transition: border-color 0.3s;
}

#taskInput:focus {
    outline: none;
    border-color: #667eea;
}

#addBtn {
    padding: 12px 24px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.3s;
}

#addBtn:hover {
    background: #5568d3;
}

#taskList {
    list-style: none;
}

.task-item {
    display: flex;
    align-items: center;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    margin-bottom: 10px;
    transition: all 0.3s;
}

.task-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.task-item.completed {
    opacity: 0.6;
}

.task-item.completed .task-text {
    text-decoration: line-through;
}

.task-checkbox {
    margin-right: 15px;
    width: 20px;
    height: 20px;
    cursor: pointer;
}

.task-text {
    flex: 1;
    font-size: 16px;
    color: #333;
}

.delete-btn {
    background: #ef4444;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.3s;
}

.delete-btn:hover {
    background: #dc2626;
}""",

    "script.js": """// DOM元素
const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');

// 从localStorage加载任务
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];

// 初始化
renderTasks();

// 添加任务
addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
});

function addTask() {
    const taskText = taskInput.value.trim();
    if (!taskText) return;

    const task = {
        id: Date.now(),
        text: taskText,
        completed: false
    };

    tasks.push(task);
    saveTasks();
    renderTasks();
    taskInput.value = '';
}

function toggleTask(id) {
    tasks = tasks.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
    );
    saveTasks();
    renderTasks();
}

function deleteTask(id) {
    tasks = tasks.filter(task => task.id !== id);
    saveTasks();
    renderTasks();
}

function renderTasks() {
    taskList.innerHTML = tasks.map(task => `
        <li class="task-item ${task.completed ? 'completed' : ''}">
            <input type="checkbox" class="task-checkbox"
                   ${task.completed ? 'checked' : ''}
                   onchange="toggleTask(${task.id})">
            <span class="task-text">${task.text}</span>
            <button class="delete-btn" onclick="deleteTask(${task.id})">删除</button>
        </li>
    `).join('');
}

function saveTasks() {
    localStorage.setItem('tasks', JSON.stringify(tasks));
}"""
}

# 博客页面模板
BLOG_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的博客</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <div class="container">
            <h1>我的博客</h1>
            <nav>
                <a href="#home">首页</a>
                <a href="#about">关于</a>
                <a href="#contact">联系</a>
            </nav>
        </div>
    </header>

    <main class="container">
        <article class="post">
            <h2>欢迎来到我的博客</h2>
            <div class="post-meta">
                <span class="date">2024年1月1日</span>
                <span class="author">作者</span>
            </div>
            <p>这是一个简洁优雅的博客模板。您可以在这里分享您的想法、经验和故事。</p>
        </article>
    </main>

    <footer>
        <div class="container">
            <p>&copy; 2024 我的博客. 保留所有权利.</p>
        </div>
    </footer>

    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Georgia', serif;
    line-height: 1.6;
    color: #333;
    background: #f5f5f5;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 20px;
}

header {
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    padding: 20px 0;
}

header h1 {
    font-size: 32px;
    margin-bottom: 10px;
}

nav {
    display: flex;
    gap: 20px;
}

nav a {
    color: #666;
    text-decoration: none;
    transition: color 0.3s;
}

nav a:hover {
    color: #333;
}

main {
    padding: 40px 0;
}

.post {
    background: white;
    padding: 30px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 30px;
}

.post h2 {
    font-size: 28px;
    margin-bottom: 15px;
}

.post-meta {
    color: #999;
    margin-bottom: 20px;
    font-size: 14px;
}

.post-meta span {
    margin-right: 15px;
}

.post p {
    font-size: 18px;
    line-height: 1.8;
}

footer {
    background: #333;
    color: white;
    text-align: center;
    padding: 20px 0;
    margin-top: 40px;
}""",

    "script.js": """// 博客交互逻辑
document.addEventListener('DOMContentLoaded', () => {
    console.log('博客加载完成');
});"""
}

# 作品集模板
PORTFOLIO_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>个人作品集</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <h2 class="logo">我的作品</h2>
            <div class="nav-links">
                <a href="#home">首页</a>
                <a href="#projects">项目</a>
                <a href="#contact">联系</a>
            </div>
        </div>
    </nav>

    <section id="hero">
        <div class="container">
            <h1>您好，我是设计师</h1>
            <p>创造美好的数字体验</p>
        </div>
    </section>

    <section id="projects">
        <div class="container">
            <h2>我的项目</h2>
            <div class="projects-grid">
                <div class="project-card">
                    <h3>项目 1</h3>
                    <p>项目描述...</p>
                </div>
                <div class="project-card">
                    <h3>项目 2</h3>
                    <p>项目描述...</p>
                </div>
                <div class="project-card">
                    <h3>项目 3</h3>
                    <p>项目描述...</p>
                </div>
            </div>
        </div>
    </section>

    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    color: #333;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

.navbar {
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    padding: 20px 0;
    position: sticky;
    top: 0;
    z-index: 100;
}

.navbar .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.logo {
    font-size: 24px;
    font-weight: bold;
}

.nav-links {
    display: flex;
    gap: 30px;
}

.nav-links a {
    color: #666;
    text-decoration: none;
    transition: color 0.3s;
}

.nav-links a:hover {
    color: #333;
}

#hero {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    text-align: center;
    padding: 100px 20px;
}

#hero h1 {
    font-size: 48px;
    margin-bottom: 20px;
}

#hero p {
    font-size: 24px;
}

#projects {
    padding: 80px 20px;
}

#projects h2 {
    text-align: center;
    font-size: 36px;
    margin-bottom: 40px;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 30px;
}

.project-card {
    background: white;
    padding: 30px;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    transition: transform 0.3s;
}

.project-card:hover {
    transform: translateY(-5px);
}

.project-card h3 {
    font-size: 24px;
    margin-bottom: 15px;
}""",

    "script.js": """// 作品集交互逻辑
document.addEventListener('DOMContentLoaded', () => {
    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
});"""
}

# 记账应用模板
EXPENSE_TRACKER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>记账本</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>💰 我的记账本</h1>

        <div class="summary">
            <div class="summary-item">
                <span class="label">总收入</span>
                <span class="value income" id="totalIncome">¥0</span>
            </div>
            <div class="summary-item">
                <span class="label">总支出</span>
                <span class="value expense" id="totalExpense">¥0</span>
            </div>
            <div class="summary-item">
                <span class="label">余额</span>
                <span class="value balance" id="balance">¥0</span>
            </div>
        </div>

        <div class="input-section">
            <input type="number" id="amount" placeholder="金额" step="0.01">
            <input type="text" id="category" placeholder="类别（如：餐饮、交通）">
            <input type="text" id="note" placeholder="备注">
            <select id="type">
                <option value="expense">支出</option>
                <option value="income">收入</option>
            </select>
            <button id="addBtn">添加</button>
        </div>

        <div id="recordList"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #f0f2f5;
    padding: 20px;
}

.container {
    max-width: 800px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.summary-item {
    background: white;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    text-align: center;
}

.label {
    display: block;
    color: #666;
    margin-bottom: 10px;
}

.value {
    font-size: 24px;
    font-weight: bold;
}

.income { color: #27ae60; }
.expense { color: #e74c3c; }
.balance { color: #3498db; }

.input-section {
    background: white;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.input-section input,
.input-section select {
    flex: 1;
    min-width: 150px;
    padding: 12px;
    border: 2px solid #e0e0e0;
    border-radius: 6px;
    font-size: 14px;
}

.input-section button {
    padding: 12px 30px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
}

.input-section button:hover {
    background: #2980b9;
}

#recordList {
    background: white;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.record-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    border-bottom: 1px solid #f0f0f0;
}

.record-item:last-child {
    border-bottom: none;
}

.record-info {
    flex: 1;
}

.record-amount {
    font-size: 20px;
    font-weight: bold;
    margin-right: 15px;
}

.record-amount.income {
    color: #27ae60;
}

.record-amount.expense {
    color: #e74c3c;
}

.delete-btn {
    background: #e74c3c;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
}""",

    "script.js": """let records = JSON.parse(localStorage.getItem('records')) || [];

const elements = {
    amount: document.getElementById('amount'),
    category: document.getElementById('category'),
    note: document.getElementById('note'),
    type: document.getElementById('type'),
    addBtn: document.getElementById('addBtn'),
    recordList: document.getElementById('recordList'),
    totalIncome: document.getElementById('totalIncome'),
    totalExpense: document.getElementById('totalExpense'),
    balance: document.getElementById('balance')
};

elements.addBtn.addEventListener('click', addRecord);

function addRecord() {
    const amount = parseFloat(elements.amount.value);
    if (!amount || amount <= 0) {
        alert('请输入有效金额');
        return;
    }

    const record = {
        id: Date.now(),
        amount: amount,
        category: elements.category.value || '未分类',
        note: elements.note.value || '',
        type: elements.type.value,
        date: new Date().toLocaleString('zh-CN')
    };

    records.unshift(record);
    saveRecords();
    renderRecords();
    updateSummary();

    // 清空输入
    elements.amount.value = '';
    elements.category.value = '';
    elements.note.value = '';
}

function deleteRecord(id) {
    records = records.filter(r => r.id !== id);
    saveRecords();
    renderRecords();
    updateSummary();
}

function renderRecords() {
    elements.recordList.innerHTML = records.map(record => `
        <div class="record-item">
            <div class="record-info">
                <strong>${record.category}</strong>
                <div style="color: #666; font-size: 12px;">${record.note} - ${record.date}</div>
            </div>
            <span class="record-amount ${record.type}">
                ${record.type === 'income' ? '+' : '-'}¥${record.amount.toFixed(2)}
            </span>
            <button class="delete-btn" onclick="deleteRecord(${record.id})">删除</button>
        </div>
    `).join('');
}

function updateSummary() {
    const income = records.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
    const expense = records.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    const balance = income - expense;

    elements.totalIncome.textContent = '¥' + income.toFixed(2);
    elements.totalExpense.textContent = '¥' + expense.toFixed(2);
    elements.balance.textContent = '¥' + balance.toFixed(2);
}

function saveRecords() {
    localStorage.setItem('records', JSON.stringify(records));
}

// 初始化
renderRecords();
updateSummary();"""
}

# 画板应用模板
DRAWING_BOARD_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>在线画板</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🎨 在线画板</h1>

        <div class="toolbar">
            <div class="tool-group">
                <label>画笔大小:</label>
                <input type="range" id="brushSize" min="1" max="50" value="5">
                <span id="sizeValue">5</span>
            </div>
            <div class="tool-group">
                <label>颜色:</label>
                <input type="color" id="colorPicker" value="#000000">
            </div>
            <div class="tool-group">
                <button id="clearBtn">清空画布</button>
                <button id="saveBtn">保存图片</button>
            </div>
        </div>

        <canvas id="canvas"></canvas>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #f0f2f5;
    padding: 20px;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 20px;
}

.toolbar {
    background: white;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 20px;
    display: flex;
    gap: 30px;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
}

.tool-group {
    display: flex;
    align-items: center;
    gap: 10px;
}

.tool-group label {
    font-weight: bold;
    color: #666;
}

.tool-group input[type="range"] {
    width: 150px;
}

.tool-group button {
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s;
}

#clearBtn {
    background: #e74c3c;
    color: white;
}

#clearBtn:hover {
    background: #c0392b;
}

#saveBtn {
    background: #27ae60;
    color: white;
}

#saveBtn:hover {
    background: #229954;
}

#canvas {
    display: block;
    margin: 0 auto;
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    cursor: crosshair;
}""",

    "script.js": """const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const brushSize = document.getElementById('brushSize');
const sizeValue = document.getElementById('sizeValue');
const colorPicker = document.getElementById('colorPicker');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');

// 设置画布大小
canvas.width = 1000;
canvas.height = 600;

let isDrawing = false;
let lastX = 0;
let lastY = 0;

// 初始化画布背景为白色
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// 画笔大小变化
brushSize.addEventListener('input', (e) => {
    sizeValue.textContent = e.target.value;
});

// 清空画布
clearBtn.addEventListener('click', () => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
});

// 保存图片
saveBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'my-drawing.png';
    link.href = canvas.toDataURL();
    link.click();
});

// 鼠标事件
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// 触摸事件（移动端支持）
canvas.addEventListener('touchstart', handleTouchStart);
canvas.addEventListener('touchmove', handleTouchMove);
canvas.addEventListener('touchend', stopDrawing);

function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
}

function draw(e) {
    if (!isDrawing) return;

    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = brushSize.value;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();

    [lastX, lastY] = [e.offsetX, e.offsetY];
}

function stopDrawing() {
    isDrawing = false;
}

function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    isDrawing = true;
    lastX = touch.clientX - rect.left;
    lastY = touch.clientY - rect.top;
}

function handleTouchMove(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = brushSize.value;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    [lastX, lastY] = [x, y];
}"""
}

# 计算器模板
CALCULATOR_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>计算器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="calculator">
        <div class="display" id="display">0</div>
        <div class="buttons">
            <button class="btn clear" onclick="clearDisplay()">C</button>
            <button class="btn" onclick="deleteLast()">⌫</button>
            <button class="btn operator" onclick="appendOperator('/')">÷</button>
            <button class="btn operator" onclick="appendOperator('*')">×</button>

            <button class="btn" onclick="appendNumber('7')">7</button>
            <button class="btn" onclick="appendNumber('8')">8</button>
            <button class="btn" onclick="appendNumber('9')">9</button>
            <button class="btn operator" onclick="appendOperator('-')">−</button>

            <button class="btn" onclick="appendNumber('4')">4</button>
            <button class="btn" onclick="appendNumber('5')">5</button>
            <button class="btn" onclick="appendNumber('6')">6</button>
            <button class="btn operator" onclick="appendOperator('+')">+</button>

            <button class="btn" onclick="appendNumber('1')">1</button>
            <button class="btn" onclick="appendNumber('2')">2</button>
            <button class="btn" onclick="appendNumber('3')">3</button>
            <button class="btn equals" onclick="calculate()" style="grid-row: span 2;">=</button>

            <button class="btn" onclick="appendNumber('0')" style="grid-column: span 2;">0</button>
            <button class="btn" onclick="appendNumber('.')">.</button>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.calculator {
    background: #2c3e50;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    padding: 20px;
    width: 350px;
}

.display {
    background: #1a252f;
    color: white;
    font-size: 48px;
    text-align: right;
    padding: 30px 20px;
    border-radius: 10px;
    margin-bottom: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.buttons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
}

.btn {
    padding: 25px;
    font-size: 24px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
    background: #34495e;
    color: white;
}

.btn:hover {
    background: #4a5f7f;
    transform: scale(1.05);
}

.btn:active {
    transform: scale(0.95);
}

.btn.operator {
    background: #e67e22;
}

.btn.operator:hover {
    background: #d35400;
}

.btn.equals {
    background: #27ae60;
}

.btn.equals:hover {
    background: #229954;
}

.btn.clear {
    background: #e74c3c;
}

.btn.clear:hover {
    background: #c0392b;
}""",

    "script.js": """let display = document.getElementById('display');
let currentInput = '0';
let operator = null;
let previousInput = null;
let shouldResetDisplay = false;

function updateDisplay() {
    display.textContent = currentInput;
}

function appendNumber(num) {
    if (shouldResetDisplay) {
        currentInput = num;
        shouldResetDisplay = false;
    } else {
        currentInput = currentInput === '0' ? num : currentInput + num;
    }
    updateDisplay();
}

function appendOperator(op) {
    if (operator !== null) {
        calculate();
    }
    previousInput = currentInput;
    operator = op;
    shouldResetDisplay = true;
}

function calculate() {
    if (operator === null || previousInput === null) return;

    const prev = parseFloat(previousInput);
    const current = parseFloat(currentInput);
    let result;

    switch (operator) {
        case '+':
            result = prev + current;
            break;
        case '-':
            result = prev - current;
            break;
        case '*':
            result = prev * current;
            break;
        case '/':
            result = prev / current;
            break;
        default:
            return;
    }

    currentInput = result.toString();
    operator = null;
    previousInput = null;
    shouldResetDisplay = true;
    updateDisplay();
}

function clearDisplay() {
    currentInput = '0';
    operator = null;
    previousInput = null;
    shouldResetDisplay = false;
    updateDisplay();
}

function deleteLast() {
    currentInput = currentInput.slice(0, -1) || '0';
    updateDisplay();
}

// 键盘支持
document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') appendNumber(e.key);
    if (e.key === '.') appendNumber('.');
    if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') appendOperator(e.key);
    if (e.key === 'Enter' || e.key === '=') calculate();
    if (e.key === 'Escape') clearDisplay();
    if (e.key === 'Backspace') deleteLast();
});"""
}

# 倒计时/计时器模板
TIMER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>计时器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>⏱️ 计时器</h1>

        <div class="tabs">
            <button class="tab-btn active" onclick="showTab('timer')">计时器</button>
            <button class="tab-btn" onclick="showTab('countdown')">倒计时</button>
        </div>

        <div id="timer-tab" class="tab-content active">
            <div class="display" id="timerDisplay">00:00:00</div>
            <div class="controls">
                <button class="btn start" onclick="startTimer()">开始</button>
                <button class="btn pause" onclick="pauseTimer()">暂停</button>
                <button class="btn reset" onclick="resetTimer()">重置</button>
            </div>
        </div>

        <div id="countdown-tab" class="tab-content">
            <div class="input-group">
                <input type="number" id="hours" min="0" max="23" value="0" placeholder="时">
                <input type="number" id="minutes" min="0" max="59" value="1" placeholder="分">
                <input type="number" id="seconds" min="0" max="59" value="0" placeholder="秒">
            </div>
            <div class="display" id="countdownDisplay">01:00</div>
            <div class="controls">
                <button class="btn start" onclick="startCountdown()">开始</button>
                <button class="btn pause" onclick="pauseCountdown()">暂停</button>
                <button class="btn reset" onclick="resetCountdown()">重置</button>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.container {
    background: white;
    border-radius: 20px;
    padding: 40px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 500px;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
}

.tab-btn {
    flex: 1;
    padding: 12px;
    border: none;
    background: #ecf0f1;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.3s;
}

.tab-btn.active {
    background: #3498db;
    color: white;
}

.tab-content {
    display: none;
}

.tab-content.active {
    display: block;
}

.input-group {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 30px;
}

.input-group input {
    width: 80px;
    padding: 15px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 20px;
    text-align: center;
}

.display {
    font-size: 72px;
    text-align: center;
    color: #2c3e50;
    font-weight: bold;
    margin: 40px 0;
    font-family: 'Courier New', monospace;
}

.controls {
    display: flex;
    gap: 15px;
    justify-content: center;
}

.btn {
    padding: 15px 30px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
    color: white;
}

.btn.start {
    background: #27ae60;
}

.btn.start:hover {
    background: #229954;
}

.btn.pause {
    background: #f39c12;
}

.btn.pause:hover {
    background: #e67e22;
}

.btn.reset {
    background: #e74c3c;
}

.btn.reset:hover {
    background: #c0392b;
}""",

    "script.js": """let timerInterval = null;
let countdownInterval = null;
let timerSeconds = 0;
let countdownSeconds = 0;
let isTimerRunning = false;
let isCountdownRunning = false;

function showTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    if (tab === 'timer') {
        document.getElementById('timer-tab').classList.add('active');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else {
        document.getElementById('countdown-tab').classList.add('active');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
    }
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startTimer() {
    if (isTimerRunning) return;
    isTimerRunning = true;
    timerInterval = setInterval(() => {
        timerSeconds++;
        document.getElementById('timerDisplay').textContent = formatTime(timerSeconds);
    }, 1000);
}

function pauseTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
}

function resetTimer() {
    pauseTimer();
    timerSeconds = 0;
    document.getElementById('timerDisplay').textContent = '00:00:00';
}

function startCountdown() {
    if (isCountdownRunning) return;

    const h = parseInt(document.getElementById('hours').value) || 0;
    const m = parseInt(document.getElementById('minutes').value) || 0;
    const s = parseInt(document.getElementById('seconds').value) || 0;

    if (countdownSeconds === 0) {
        countdownSeconds = h * 3600 + m * 60 + s;
    }

    if (countdownSeconds === 0) {
        alert('请设置倒计时时间');
        return;
    }

    isCountdownRunning = true;
    countdownInterval = setInterval(() => {
        countdownSeconds--;
        document.getElementById('countdownDisplay').textContent = formatTime(countdownSeconds);

        if (countdownSeconds === 0) {
            pauseCountdown();
            alert('时间到！');
        }
    }, 1000);
}

function pauseCountdown() {
    isCountdownRunning = false;
    clearInterval(countdownInterval);
}

function resetCountdown() {
    pauseCountdown();
    countdownSeconds = 0;
    const h = parseInt(document.getElementById('hours').value) || 0;
    const m = parseInt(document.getElementById('minutes').value) || 0;
    const s = parseInt(document.getElementById('seconds').value) || 0;
    const total = h * 3600 + m * 60 + s;
    document.getElementById('countdownDisplay').textContent = formatTime(total);
}"""
}

# 音乐播放器模板
MUSIC_PLAYER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>音乐播放器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="player">
        <div class="cover">
            <div class="cover-img" id="coverImg">🎵</div>
        </div>

        <div class="info">
            <h2 id="songTitle">未选择歌曲</h2>
            <p id="artist">请上传音乐文件</p>
        </div>

        <div class="progress-container">
            <div class="time" id="currentTime">0:00</div>
            <input type="range" id="progress" min="0" max="100" value="0" class="progress-bar">
            <div class="time" id="duration">0:00</div>
        </div>

        <div class="controls">
            <button class="control-btn" onclick="previousSong()">⏮️</button>
            <button class="control-btn play-btn" id="playBtn" onclick="togglePlay()">▶️</button>
            <button class="control-btn" onclick="nextSong()">⏭️</button>
        </div>

        <div class="volume-control">
            <span>🔊</span>
            <input type="range" id="volume" min="0" max="100" value="70" class="volume-bar">
        </div>

        <input type="file" id="fileInput" accept="audio/*" multiple style="display:none">
        <button class="upload-btn" onclick="document.getElementById('fileInput').click()">📁 选择音乐</button>

        <div class="playlist" id="playlist"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.player {
    background: rgba(255,255,255,0.95);
    border-radius: 20px;
    padding: 40px;
    width: 400px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

.cover {
    text-align: center;
    margin-bottom: 30px;
}

.cover-img {
    width: 200px;
    height: 200px;
    margin: 0 auto;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 80px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
}

.info {
    text-align: center;
    margin-bottom: 30px;
}

.info h2 {
    font-size: 24px;
    color: #2c3e50;
    margin-bottom: 10px;
}

.info p {
    color: #7f8c8d;
}

.progress-container {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 30px;
}

.time {
    font-size: 14px;
    color: #7f8c8d;
}

.progress-bar, .volume-bar {
    flex: 1;
    height: 8px;
    -webkit-appearance: none;
    appearance: none;
    background: #e0e0e0;
    border-radius: 5px;
    outline: none;
}

.progress-bar::-webkit-slider-thumb,
.volume-bar::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    background: #667eea;
    border-radius: 50%;
    cursor: pointer;
}

.controls {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-bottom: 20px;
}

.control-btn {
    background: none;
    border: none;
    font-size: 32px;
    cursor: pointer;
    transition: transform 0.2s;
}

.control-btn:hover {
    transform: scale(1.1);
}

.play-btn {
    font-size: 48px;
}

.volume-control {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 20px;
}

.volume-control span {
    font-size: 20px;
}

.upload-btn {
    width: 100%;
    padding: 12px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    margin-bottom: 20px;
}

.upload-btn:hover {
    background: #5568d3;
}

.playlist {
    max-height: 200px;
    overflow-y: auto;
}

.playlist-item {
    padding: 10px;
    background: #f8f9fa;
    margin-bottom: 5px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
}

.playlist-item:hover {
    background: #e9ecef;
}

.playlist-item.active {
    background: #667eea;
    color: white;
}""",

    "script.js": """const audio = new Audio();
const playBtn = document.getElementById('playBtn');
const progress = document.getElementById('progress');
const volume = document.getElementById('volume');
const fileInput = document.getElementById('fileInput');
const playlist = document.getElementById('playlist');

let songs = [];
let currentSongIndex = 0;

audio.volume = 0.7;

fileInput.addEventListener('change', (e) => {
    songs = Array.from(e.target.files);
    renderPlaylist();
    if (songs.length > 0) {
        loadSong(0);
    }
});

function renderPlaylist() {
    playlist.innerHTML = songs.map((song, index) => `
        <div class="playlist-item ${index === currentSongIndex ? 'active' : ''}"
             onclick="loadSong(${index})">
            ${song.name}
        </div>
    `).join('');
}

function loadSong(index) {
    if (index < 0 || index >= songs.length) return;

    currentSongIndex = index;
    const song = songs[index];

    audio.src = URL.createObjectURL(song);
    document.getElementById('songTitle').textContent = song.name;
    document.getElementById('artist').textContent = '本地音乐';

    renderPlaylist();
}

function togglePlay() {
    if (audio.paused) {
        audio.play();
        playBtn.textContent = '⏸️';
    } else {
        audio.pause();
        playBtn.textContent = '▶️';
    }
}

function previousSong() {
    loadSong(currentSongIndex - 1);
    audio.play();
    playBtn.textContent = '⏸️';
}

function nextSong() {
    loadSong(currentSongIndex + 1);
    audio.play();
    playBtn.textContent = '⏸️';
}

audio.addEventListener('timeupdate', () => {
    const percent = (audio.currentTime / audio.duration) * 100;
    progress.value = percent || 0;

    document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
    document.getElementById('duration').textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
    nextSong();
});

progress.addEventListener('input', (e) => {
    audio.currentTime = (e.target.value / 100) * audio.duration;
});

volume.addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
});

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}"""
}

# 相册/照片墙模板
PHOTO_GALLERY_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>相册</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>📷 我的相册</h1>

        <div class="upload-section">
            <input type="file" id="fileInput" accept="image/*" multiple style="display:none">
            <button class="upload-btn" onclick="document.getElementById('fileInput').click()">
                📁 上传照片
            </button>
        </div>

        <div class="gallery" id="gallery"></div>
    </div>

    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <span class="close">&times;</span>
        <img id="lightboxImg" src="" alt="">
        <button class="nav-btn prev" onclick="event.stopPropagation(); navigate(-1)">❮</button>
        <button class="nav-btn next" onclick="event.stopPropagation(); navigate(1)">❯</button>
    </div>

    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #f5f5f5;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 20px;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.upload-section {
    text-align: center;
    margin-bottom: 30px;
}

.upload-btn {
    padding: 15px 40px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.3s;
}

.upload-btn:hover {
    background: #5568d3;
}

.gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 20px;
}

.photo-card {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 10px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    cursor: pointer;
    transition: transform 0.3s;
}

.photo-card:hover {
    transform: scale(1.05);
}

.photo-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.photo-card .delete-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(231, 76, 60, 0.9);
    color: white;
    border: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 18px;
    opacity: 0;
    transition: opacity 0.3s;
}

.photo-card:hover .delete-btn {
    opacity: 1;
}

.lightbox {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    z-index: 1000;
    justify-content: center;
    align-items: center;
}

.lightbox.active {
    display: flex;
}

.lightbox img {
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
}

.close {
    position: absolute;
    top: 20px;
    right: 40px;
    font-size: 40px;
    color: white;
    cursor: pointer;
}

.nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255,255,255,0.2);
    color: white;
    border: none;
    font-size: 40px;
    padding: 20px;
    cursor: pointer;
    transition: background 0.3s;
}

.nav-btn:hover {
    background: rgba(255,255,255,0.3);
}

.nav-btn.prev {
    left: 20px;
}

.nav-btn.next {
    right: 20px;
}""",

    "script.js": """let photos = JSON.parse(localStorage.getItem('photos')) || [];
let currentPhotoIndex = 0;

const gallery = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const fileInput = document.getElementById('fileInput');

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            photos.push(e.target.result);
            savePhotos();
            renderGallery();
        };
        reader.readAsDataURL(file);
    });
});

function renderGallery() {
    gallery.innerHTML = photos.map((photo, index) => `
        <div class="photo-card">
            <img src="${photo}" alt="Photo ${index + 1}" onclick="openLightbox(${index})">
            <button class="delete-btn" onclick="deletePhoto(${index})">×</button>
        </div>
    `).join('');
}

function openLightbox(index) {
    currentPhotoIndex = index;
    lightboxImg.src = photos[index];
    lightbox.classList.add('active');
}

function closeLightbox() {
    lightbox.classList.remove('active');
}

function navigate(direction) {
    currentPhotoIndex += direction;
    if (currentPhotoIndex < 0) currentPhotoIndex = photos.length - 1;
    if (currentPhotoIndex >= photos.length) currentPhotoIndex = 0;

    lightboxImg.src = photos[currentPhotoIndex];
}

function deletePhoto(index) {
    if (confirm('确定要删除这张照片吗？')) {
        photos.splice(index, 1);
        savePhotos();
        renderGallery();
    }
}

function savePhotos() {
    localStorage.setItem('photos', JSON.stringify(photos));
}

// 键盘导航
document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('active')) {
        if (e.key === 'ArrowLeft') navigate(-1);
        if (e.key === 'ArrowRight') navigate(1);
        if (e.key === 'Escape') closeLightbox();
    }
});

renderGallery();"""
}

# 登录页面模板
LOGIN_PAGE_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <div class="form-container">
            <h1>欢迎回来</h1>
            <p class="subtitle">请登录您的账户</p>

            <form id="loginForm" onsubmit="handleLogin(event)">
                <div class="input-group">
                    <label>用户名/邮箱</label>
                    <input type="text" id="username" placeholder="请输入用户名或邮箱" required>
                </div>

                <div class="input-group">
                    <label>密码</label>
                    <input type="password" id="password" placeholder="请输入密码" required>
                </div>

                <div class="options">
                    <label class="checkbox">
                        <input type="checkbox" id="remember">
                        <span>记住我</span>
                    </label>
                    <a href="#" class="forgot-password">忘记密码？</a>
                </div>

                <button type="submit" class="btn-login">登录</button>
            </form>

            <div class="divider">
                <span>或</span>
            </div>

            <div class="social-login">
                <button class="social-btn google">
                    <span>🔍</span> 使用 Google 登录
                </button>
                <button class="social-btn github">
                    <span>⚫</span> 使用 GitHub 登录
                </button>
            </div>

            <p class="signup-link">
                还没有账户？ <a href="#">立即注册</a>
            </p>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    width: 100%;
    max-width: 450px;
}

.form-container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 10px;
}

.subtitle {
    text-align: center;
    color: #7f8c8d;
    margin-bottom: 30px;
}

.input-group {
    margin-bottom: 20px;
}

.input-group label {
    display: block;
    color: #2c3e50;
    margin-bottom: 8px;
    font-weight: 500;
}

.input-group input {
    width: 100%;
    padding: 12px 15px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 16px;
    transition: border-color 0.3s;
}

.input-group input:focus {
    outline: none;
    border-color: #667eea;
}

.options {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
}

.checkbox {
    display: flex;
    align-items: center;
    cursor: pointer;
}

.checkbox input {
    margin-right: 8px;
}

.forgot-password {
    color: #667eea;
    text-decoration: none;
    font-size: 14px;
}

.forgot-password:hover {
    text-decoration: underline;
}

.btn-login {
    width: 100%;
    padding: 15px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.3s;
}

.btn-login:hover {
    background: #5568d3;
}

.divider {
    text-align: center;
    margin: 25px 0;
    position: relative;
}

.divider::before,
.divider::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 40%;
    height: 1px;
    background: #e0e0e0;
}

.divider::before {
    left: 0;
}

.divider::after {
    right: 0;
}

.divider span {
    background: white;
    padding: 0 15px;
    color: #7f8c8d;
}

.social-login {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.social-btn {
    width: 100%;
    padding: 12px;
    border: 2px solid #e0e0e0;
    background: white;
    border-radius: 8px;
    cursor: pointer;
    font-size: 15px;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
}

.social-btn:hover {
    border-color: #667eea;
    background: #f8f9fa;
}

.signup-link {
    text-align: center;
    margin-top: 25px;
    color: #7f8c8d;
}

.signup-link a {
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
}

.signup-link a:hover {
    text-decoration: underline;
}""",

    "script.js": """function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;

    // 这里添加实际的登录逻辑
    console.log('登录信息:', { username, password, remember });

    // 模拟登录
    alert('登录功能需要连接后端API\\n当前为演示模式');
}"""
}

# 问卷表单模板
SURVEY_FORM_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>问卷调查</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <div class="form-card">
            <h1>📋 用户满意度调查</h1>
            <p class="description">感谢您抽出宝贵时间填写这份问卷</p>

            <form id="surveyForm" onsubmit="handleSubmit(event)">
                <div class="question">
                    <label class="required">1. 您的姓名</label>
                    <input type="text" name="name" required>
                </div>

                <div class="question">
                    <label class="required">2. 您的年龄段</label>
                    <select name="age" required>
                        <option value="">请选择</option>
                        <option value="18-25">18-25岁</option>
                        <option value="26-35">26-35岁</option>
                        <option value="36-45">36-45岁</option>
                        <option value="46+">46岁以上</option>
                    </select>
                </div>

                <div class="question">
                    <label class="required">3. 您对我们产品的整体满意度？</label>
                    <div class="radio-group">
                        <label class="radio">
                            <input type="radio" name="satisfaction" value="非常满意" required>
                            <span>非常满意</span>
                        </label>
                        <label class="radio">
                            <input type="radio" name="satisfaction" value="满意" required>
                            <span>满意</span>
                        </label>
                        <label class="radio">
                            <input type="radio" name="satisfaction" value="一般" required>
                            <span>一般</span>
                        </label>
                        <label class="radio">
                            <input type="radio" name="satisfaction" value="不满意" required>
                            <span>不满意</span>
                        </label>
                    </div>
                </div>

                <div class="question">
                    <label>4. 您最喜欢的功能？（可多选）</label>
                    <div class="checkbox-group">
                        <label class="checkbox">
                            <input type="checkbox" name="features" value="界面设计">
                            <span>界面设计</span>
                        </label>
                        <label class="checkbox">
                            <input type="checkbox" name="features" value="功能丰富">
                            <span>功能丰富</span>
                        </label>
                        <label class="checkbox">
                            <input type="checkbox" name="features" value="操作简单">
                            <span>操作简单</span>
                        </label>
                        <label class="checkbox">
                            <input type="checkbox" name="features" value="性能稳定">
                            <span>性能稳定</span>
                        </label>
                    </div>
                </div>

                <div class="question">
                    <label>5. 您的建议和意见</label>
                    <textarea name="feedback" rows="5" placeholder="请输入您的建议..."></textarea>
                </div>

                <button type="submit" class="btn-submit">提交问卷</button>
            </form>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 40px 20px;
}

.container {
    max-width: 700px;
    margin: 0 auto;
}

.form-card {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 10px;
}

.description {
    text-align: center;
    color: #7f8c8d;
    margin-bottom: 40px;
}

.question {
    margin-bottom: 30px;
}

.question label {
    display: block;
    color: #2c3e50;
    font-weight: 500;
    margin-bottom: 12px;
}

.required::after {
    content: ' *';
    color: #e74c3c;
}

.question input[type="text"],
.question select,
.question textarea {
    width: 100%;
    padding: 12px 15px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 16px;
    font-family: 'Arial', sans-serif;
    transition: border-color 0.3s;
}

.question input:focus,
.question select:focus,
.question textarea:focus {
    outline: none;
    border-color: #667eea;
}

.radio-group,
.checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.radio,
.checkbox {
    display: flex;
    align-items: center;
    padding: 12px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
}

.radio:hover,
.checkbox:hover {
    border-color: #667eea;
    background: #f8f9fa;
}

.radio input,
.checkbox input {
    margin-right: 12px;
    width: 18px;
    height: 18px;
    cursor: pointer;
}

.btn-submit {
    width: 100%;
    padding: 15px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.3s;
}

.btn-submit:hover {
    background: #5568d3;
}""",

    "script.js": """function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = {};

    // 收集单选和文本输入
    for (let [key, value] of formData.entries()) {
        if (key === 'features') {
            // 多选框特殊处理
            if (!data[key]) data[key] = [];
            data[key].push(value);
        } else {
            data[key] = value;
        }
    }

    console.log('问卷数据:', data);

    alert('感谢您的反馈！\\n问卷已提交成功。');
    e.target.reset();
}"""
}

# 视频播放器模板
VIDEO_PLAYER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>视频播放器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🎬 视频播放器</h1>

        <div class="player-wrapper">
            <video id="video" controls>
                <source id="videoSource" src="" type="video/mp4">
                您的浏览器不支持视频标签。
            </video>

            <div class="video-info">
                <h3 id="videoTitle">未选择视频</h3>
                <p id="videoInfo">请上传视频文件</p>
            </div>
        </div>

        <div class="controls-panel">
            <input type="file" id="fileInput" accept="video/*" multiple style="display:none">
            <button class="btn-upload" onclick="document.getElementById('fileInput').click()">
                📁 选择视频
            </button>
        </div>

        <div class="playlist" id="playlist"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #1a1a2e;
    color: white;
    padding: 20px;
}

.container {
    max-width: 900px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    margin-bottom: 30px;
    color: #fff;
}

.player-wrapper {
    background: #16213e;
    border-radius: 15px;
    padding: 20px;
    margin-bottom: 30px;
}

video {
    width: 100%;
    border-radius: 10px;
    background: #000;
}

.video-info {
    margin-top: 20px;
}

.video-info h3 {
    font-size: 20px;
    margin-bottom: 8px;
}

.video-info p {
    color: #a0a0a0;
}

.controls-panel {
    text-align: center;
    margin-bottom: 30px;
}

.btn-upload {
    padding: 15px 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    cursor: pointer;
    transition: transform 0.3s;
}

.btn-upload:hover {
    transform: scale(1.05);
}

.playlist {
    background: #16213e;
    border-radius: 15px;
    padding: 20px;
}

.playlist-item {
    padding: 15px;
    background: #0f3460;
    margin-bottom: 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    gap: 15px;
}

.playlist-item:hover {
    background: #1a4d7a;
    transform: translateX(5px);
}

.playlist-item.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.playlist-item::before {
    content: '▶';
    font-size: 12px;
}""",

    "script.js": """const video = document.getElementById('video');
const videoSource = document.getElementById('videoSource');
const fileInput = document.getElementById('fileInput');
const playlist = document.getElementById('playlist');

let videos = [];
let currentVideoIndex = 0;

fileInput.addEventListener('change', (e) => {
    videos = Array.from(e.target.files);
    renderPlaylist();
    if (videos.length > 0) {
        loadVideo(0);
    }
});

function renderPlaylist() {
    playlist.innerHTML = videos.map((video, index) => `
        <div class="playlist-item ${index === currentVideoIndex ? 'active' : ''}"
             onclick="loadVideo(${index})">
            ${video.name}
        </div>
    `).join('');
}

function loadVideo(index) {
    if (index < 0 || index >= videos.length) return;

    currentVideoIndex = index;
    const videoFile = videos[index];

    videoSource.src = URL.createObjectURL(videoFile);
    video.load();
    video.play();

    document.getElementById('videoTitle').textContent = videoFile.name;
    document.getElementById('videoInfo').textContent = `大小: ${(videoFile.size / 1024 / 1024).toFixed(2)} MB`;

    renderPlaylist();
}

video.addEventListener('ended', () => {
    if (currentVideoIndex < videos.length - 1) {
        loadVideo(currentVideoIndex + 1);
    }
});"""
}

# 日历应用模板
CALENDAR_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>日历</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>📅 我的日历</h1>

        <div class="calendar-header">
            <button onclick="previousMonth()">❮</button>
            <h2 id="monthYear"></h2>
            <button onclick="nextMonth()">❯</button>
        </div>

        <div class="calendar-grid">
            <div class="day-name">日</div>
            <div class="day-name">一</div>
            <div class="day-name">二</div>
            <div class="day-name">三</div>
            <div class="day-name">四</div>
            <div class="day-name">五</div>
            <div class="day-name">六</div>
        </div>

        <div class="calendar-days" id="calendarDays"></div>

        <div class="event-section">
            <h3>添加事件</h3>
            <input type="text" id="eventInput" placeholder="事件内容">
            <button onclick="addEvent()">添加</button>
        </div>

        <div class="events-list" id="eventsList"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    background: white;
    padding: 30px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.calendar-header button {
    background: #667eea;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 18px;
}

.calendar-header h2 {
    color: #2c3e50;
}

.calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
    margin-bottom: 5px;
}

.day-name {
    text-align: center;
    padding: 10px;
    font-weight: bold;
    color: #7f8c8d;
}

.calendar-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
}

.day {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
    position: relative;
}

.day:hover {
    background: #ecf0f1;
}

.day.other-month {
    color: #bdc3c7;
}

.day.today {
    background: #667eea;
    color: white;
    font-weight: bold;
}

.day.selected {
    background: #3498db;
    color: white;
}

.day.has-event::after {
    content: '';
    position: absolute;
    bottom: 5px;
    width: 6px;
    height: 6px;
    background: #e74c3c;
    border-radius: 50%;
}

.event-section {
    margin-top: 30px;
    display: flex;
    gap: 10px;
}

.event-section h3 {
    width: 100%;
    color: #2c3e50;
    margin-bottom: 10px;
}

.event-section input {
    flex: 1;
    padding: 12px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 14px;
}

.event-section button {
    padding: 12px 24px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
}

.events-list {
    margin-top: 20px;
}

.event-item {
    padding: 12px;
    background: #ecf0f1;
    border-radius: 8px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.event-item .delete-btn {
    background: #e74c3c;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
}""",

    "script.js": """let currentDate = new Date();
let selectedDate = null;
let events = JSON.parse(localStorage.getItem('events')) || {};

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById('monthYear').textContent =
        `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const calendarDays = document.getElementById('calendarDays');
    calendarDays.innerHTML = '';

    // 上个月的日期
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = createDayElement(daysInPrevMonth - i, true);
        calendarDays.appendChild(day);
    }

    // 当前月的日期
    for (let i = 1; i <= daysInMonth; i++) {
        const day = createDayElement(i, false);
        const dateKey = `${year}-${month + 1}-${i}`;

        if (isToday(year, month, i)) {
            day.classList.add('today');
        }

        if (events[dateKey]) {
            day.classList.add('has-event');
        }

        day.onclick = () => selectDate(year, month, i);
        calendarDays.appendChild(day);
    }

    // 下个月的日期
    const remainingDays = 42 - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
        const day = createDayElement(i, true);
        calendarDays.appendChild(day);
    }

    renderEvents();
}

function createDayElement(day, isOtherMonth) {
    const div = document.createElement('div');
    div.className = 'day' + (isOtherMonth ? ' other-month' : '');
    div.textContent = day;
    return div;
}

function isToday(year, month, day) {
    const today = new Date();
    return today.getFullYear() === year &&
           today.getMonth() === month &&
           today.getDate() === day;
}

function selectDate(year, month, day) {
    selectedDate = `${year}-${month + 1}-${day}`;
    document.querySelectorAll('.day').forEach(d => d.classList.remove('selected'));
    event.target.classList.add('selected');
    renderEvents();
}

function previousMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
}

function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
}

function addEvent() {
    if (!selectedDate) {
        alert('请先选择日期');
        return;
    }

    const input = document.getElementById('eventInput');
    const eventText = input.value.trim();

    if (!eventText) return;

    if (!events[selectedDate]) {
        events[selectedDate] = [];
    }

    events[selectedDate].push({
        id: Date.now(),
        text: eventText
    });

    localStorage.setItem('events', JSON.stringify(events));
    input.value = '';
    renderCalendar();
}

function deleteEvent(date, eventId) {
    events[date] = events[date].filter(e => e.id !== eventId);
    if (events[date].length === 0) {
        delete events[date];
    }
    localStorage.setItem('events', JSON.stringify(events));
    renderCalendar();
}

function renderEvents() {
    const eventsList = document.getElementById('eventsList');

    if (!selectedDate || !events[selectedDate]) {
        eventsList.innerHTML = '<p style="color: #7f8c8d;">选择日期查看事件</p>';
        return;
    }

    eventsList.innerHTML = `<h3>${selectedDate} 的事件：</h3>` +
        events[selectedDate].map(event => `
            <div class="event-item">
                <span>${event.text}</span>
                <button class="delete-btn" onclick="deleteEvent('${selectedDate}', ${event.id})">删除</button>
            </div>
        `).join('');
}

renderCalendar();"""
}

# 番茄钟模板
POMODORO_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>番茄钟</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🍅 番茄钟</h1>

        <div class="timer-display" id="timerDisplay">25:00</div>

        <div class="mode-tabs">
            <button class="mode-btn active" onclick="setMode('work')">工作</button>
            <button class="mode-btn" onclick="setMode('short')">短休息</button>
            <button class="mode-btn" onclick="setMode('long')">长休息</button>
        </div>

        <div class="controls">
            <button class="btn-main" id="startBtn" onclick="toggleTimer()">开始</button>
            <button class="btn-secondary" onclick="resetTimer()">重置</button>
        </div>

        <div class="stats">
            <div class="stat-item">
                <span class="stat-label">今日完成</span>
                <span class="stat-value" id="todayCount">0</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">总计完成</span>
                <span class="stat-value" id="totalCount">0</span>
            </div>
        </div>

        <div class="settings">
            <h3>设置</h3>
            <div class="setting-item">
                <label>工作时长 (分钟)</label>
                <input type="number" id="workDuration" value="25" min="1" max="60">
            </div>
            <div class="setting-item">
                <label>短休息 (分钟)</label>
                <input type="number" id="shortDuration" value="5" min="1" max="30">
            </div>
            <div class="setting-item">
                <label>长休息 (分钟)</label>
                <input type="number" id="longDuration" value="15" min="1" max="60">
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 500px;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.timer-display {
    font-size: 80px;
    text-align: center;
    color: #e74c3c;
    font-weight: bold;
    margin: 40px 0;
    font-family: 'Courier New', monospace;
}

.mode-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
}

.mode-btn {
    flex: 1;
    padding: 12px;
    border: 2px solid #e0e0e0;
    background: white;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s;
}

.mode-btn.active {
    background: #e74c3c;
    color: white;
    border-color: #e74c3c;
}

.controls {
    display: flex;
    gap: 15px;
    justify-content: center;
    margin-bottom: 40px;
}

.btn-main {
    padding: 15px 50px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.3s;
}

.btn-main:hover {
    background: #229954;
    transform: scale(1.05);
}

.btn-secondary {
    padding: 15px 30px;
    background: #95a5a6;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    cursor: pointer;
}

.stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 30px;
}

.stat-item {
    text-align: center;
    padding: 20px;
    background: #ecf0f1;
    border-radius: 10px;
}

.stat-label {
    display: block;
    color: #7f8c8d;
    margin-bottom: 8px;
}

.stat-value {
    display: block;
    font-size: 32px;
    font-weight: bold;
    color: #e74c3c;
}

.settings {
    border-top: 2px solid #ecf0f1;
    padding-top: 20px;
}

.settings h3 {
    color: #2c3e50;
    margin-bottom: 15px;
}

.setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.setting-item label {
    color: #2c3e50;
}

.setting-item input {
    width: 80px;
    padding: 8px;
    border: 2px solid #e0e0e0;
    border-radius: 6px;
    text-align: center;
}""",

    "script.js": """let timeLeft = 25 * 60;
let timerId = null;
let isRunning = false;
let currentMode = 'work';
let stats = JSON.parse(localStorage.getItem('pomodoroStats')) || {
    today: 0,
    total: 0,
    lastDate: new Date().toDateString()
};

const modes = {
    work: 25,
    short: 5,
    long: 15
};

function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toggleTimer() {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    isRunning = true;
    document.getElementById('startBtn').textContent = '暂停';

    timerId = setInterval(() => {
        timeLeft--;
        updateDisplay();

        if (timeLeft === 0) {
            completePomodoro();
        }
    }, 1000);
}

function pauseTimer() {
    isRunning = false;
    document.getElementById('startBtn').textContent = '开始';
    clearInterval(timerId);
}

function resetTimer() {
    pauseTimer();
    const duration = parseInt(document.getElementById(currentMode + 'Duration').value);
    timeLeft = duration * 60;
    updateDisplay();
}

function setMode(mode) {
    pauseTimer();
    currentMode = mode;

    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    const duration = parseInt(document.getElementById(mode + 'Duration').value);
    timeLeft = duration * 60;
    updateDisplay();
}

function completePomodoro() {
    pauseTimer();

    if (currentMode === 'work') {
        // 检查是否是新的一天
        const today = new Date().toDateString();
        if (stats.lastDate !== today) {
            stats.today = 0;
            stats.lastDate = today;
        }

        stats.today++;
        stats.total++;
        localStorage.setItem('pomodoroStats', JSON.stringify(stats));
        updateStats();

        alert('🎉 番茄钟完成！休息一下吧。');
    } else {
        alert('✅ 休息结束！继续加油。');
    }

    resetTimer();
}

function updateStats() {
    document.getElementById('todayCount').textContent = stats.today;
    document.getElementById('totalCount').textContent = stats.total;
}

updateDisplay();
updateStats();"""
}

# 笔记应用模板
NOTE_APP_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>笔记本</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <h2>📝 我的笔记</h2>
            <button class="btn-new" onclick="createNote()">+ 新建笔记</button>
            <div class="notes-list" id="notesList"></div>
        </div>

        <div class="editor">
            <input type="text" id="noteTitle" placeholder="标题" class="note-title">
            <textarea id="noteContent" placeholder="开始写笔记..." class="note-content"></textarea>
            <div class="editor-footer">
                <span id="wordCount">0 字</span>
                <button class="btn-delete" onclick="deleteCurrentNote()">🗑️ 删除</button>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #f5f5f5;
    height: 100vh;
    overflow: hidden;
}

.container {
    display: flex;
    height: 100vh;
}

.sidebar {
    width: 300px;
    background: #2c3e50;
    color: white;
    padding: 20px;
    overflow-y: auto;
}

.sidebar h2 {
    margin-bottom: 20px;
}

.btn-new {
    width: 100%;
    padding: 12px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    margin-bottom: 20px;
}

.btn-new:hover {
    background: #229954;
}

.notes-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.note-item {
    padding: 12px;
    background: #34495e;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
}

.note-item:hover {
    background: #4a5f7f;
}

.note-item.active {
    background: #3498db;
}

.note-item h4 {
    margin-bottom: 5px;
}

.note-item p {
    font-size: 12px;
    color: #bdc3c7;
}

.editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: white;
}

.note-title {
    padding: 20px;
    border: none;
    border-bottom: 2px solid #ecf0f1;
    font-size: 24px;
    font-weight: bold;
}

.note-title:focus {
    outline: none;
    border-bottom-color: #3498db;
}

.note-content {
    flex: 1;
    padding: 20px;
    border: none;
    font-size: 16px;
    line-height: 1.6;
    resize: none;
}

.note-content:focus {
    outline: none;
}

.editor-footer {
    padding: 15px 20px;
    border-top: 2px solid #ecf0f1;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

#wordCount {
    color: #7f8c8d;
}

.btn-delete {
    padding: 8px 16px;
    background: #e74c3c;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.btn-delete:hover {
    background: #c0392b;
}""",

    "script.js": """let notes = JSON.parse(localStorage.getItem('notes')) || [];
let currentNoteId = null;

const noteTitle = document.getElementById('noteTitle');
const noteContent = document.getElementById('noteContent');
const wordCount = document.getElementById('wordCount');

function renderNotesList() {
    const notesList = document.getElementById('notesList');
    notesList.innerHTML = notes.map(note => `
        <div class="note-item ${note.id === currentNoteId ? 'active' : ''}"
             onclick="loadNote(${note.id})">
            <h4>${note.title || '无标题'}</h4>
            <p>${new Date(note.updated).toLocaleDateString()}</p>
        </div>
    `).join('');
}

function createNote() {
    const note = {
        id: Date.now(),
        title: '',
        content: '',
        created: Date.now(),
        updated: Date.now()
    };

    notes.unshift(note);
    saveNotes();
    loadNote(note.id);
}

function loadNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    currentNoteId = id;
    noteTitle.value = note.title;
    noteContent.value = note.content;
    updateWordCount();
    renderNotesList();
}

function saveCurrentNote() {
    if (!currentNoteId) return;

    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;

    note.title = noteTitle.value;
    note.content = noteContent.value;
    note.updated = Date.now();

    saveNotes();
    renderNotesList();
}

function deleteCurrentNote() {
    if (!currentNoteId) return;

    if (!confirm('确定要删除这条笔记吗？')) return;

    notes = notes.filter(n => n.id !== currentNoteId);
    saveNotes();

    currentNoteId = null;
    noteTitle.value = '';
    noteContent.value = '';
    renderNotesList();
}

function saveNotes() {
    localStorage.setItem('notes', JSON.stringify(notes));
}

function updateWordCount() {
    const count = noteContent.value.length;
    wordCount.textContent = `${count} 字`;
}

noteTitle.addEventListener('input', saveCurrentNote);
noteContent.addEventListener('input', () => {
    saveCurrentNote();
    updateWordCount();
});

// 初始化
renderNotesList();
if (notes.length > 0) {
    loadNote(notes[0].id);
}"""
}

# 天气应用模板
WEATHER_APP_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>天气</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🌤️ 天气预报</h1>

        <div class="search-box">
            <input type="text" id="cityInput" placeholder="输入城市名称" onkeypress="if(event.key==='Enter') searchWeather()">
            <button onclick="searchWeather()">搜索</button>
        </div>

        <div class="weather-card" id="weatherCard">
            <div class="city-name" id="cityName">请输入城市名称查询天气</div>
            <div class="weather-icon" id="weatherIcon">🌍</div>
            <div class="temperature" id="temperature">--°C</div>
            <div class="weather-desc" id="weatherDesc">--</div>

            <div class="weather-details">
                <div class="detail-item">
                    <span class="label">湿度</span>
                    <span class="value" id="humidity">--%</span>
                </div>
                <div class="detail-item">
                    <span class="label">风速</span>
                    <span class="value" id="windSpeed">-- km/h</span>
                </div>
                <div class="detail-item">
                    <span class="label">体感温度</span>
                    <span class="value" id="feelsLike">--°C</span>
                </div>
            </div>
        </div>

        <div class="note">
            <p>💡 提示：这是一个演示模板，需要连接天气API才能显示实际数据。</p>
            <p>可使用的免费API：OpenWeatherMap、和风天气等。</p>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    width: 100%;
    max-width: 500px;
}

h1 {
    text-align: center;
    color: white;
    margin-bottom: 30px;
}

.search-box {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
}

.search-box input {
    flex: 1;
    padding: 15px;
    border: none;
    border-radius: 10px;
    font-size: 16px;
}

.search-box button {
    padding: 15px 30px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 16px;
}

.search-box button:hover {
    background: #229954;
}

.weather-card {
    background: white;
    padding: 40px;
    border-radius: 20px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

.city-name {
    font-size: 28px;
    color: #2c3e50;
    margin-bottom: 20px;
}

.weather-icon {
    font-size: 80px;
    margin: 20px 0;
}

.temperature {
    font-size: 64px;
    font-weight: bold;
    color: #667eea;
    margin-bottom: 10px;
}

.weather-desc {
    font-size: 20px;
    color: #7f8c8d;
    margin-bottom: 30px;
}

.weather-details {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    padding-top: 30px;
    border-top: 2px solid #ecf0f1;
}

.detail-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.detail-item .label {
    color: #7f8c8d;
    font-size: 14px;
}

.detail-item .value {
    color: #2c3e50;
    font-size: 18px;
    font-weight: bold;
}

.note {
    margin-top: 20px;
    padding: 15px;
    background: rgba(255,255,255,0.2);
    border-radius: 10px;
    color: white;
    font-size: 14px;
    line-height: 1.6;
}""",

    "script.js": """function searchWeather() {
    const city = document.getElementById('cityInput').value.trim();

    if (!city) {
        alert('请输入城市名称');
        return;
    }

    // 模拟天气数据（实际使用时需要调用真实的天气API）
    const mockWeatherData = {
        '北京': { temp: 15, desc: '晴', humidity: 45, wind: 12, feels: 13, icon: '☀️' },
        '上海': { temp: 18, desc: '多云', humidity: 60, wind: 15, feels: 17, icon: '⛅' },
        '广州': { temp: 25, desc: '小雨', humidity: 75, wind: 10, feels: 24, icon: '🌧️' },
        '深圳': { temp: 26, desc: '晴转多云', humidity: 70, wind: 8, feels: 25, icon: '🌤️' },
        '成都': { temp: 20, desc: '阴', humidity: 65, wind: 5, feels: 19, icon: '☁️' }
    };

    const data = mockWeatherData[city] || {
        temp: 20,
        desc: '未知',
        humidity: 50,
        wind: 10,
        feels: 20,
        icon: '🌍'
    };

    document.getElementById('cityName').textContent = city;
    document.getElementById('weatherIcon').textContent = data.icon;
    document.getElementById('temperature').textContent = `${data.temp}°C`;
    document.getElementById('weatherDesc').textContent = data.desc;
    document.getElementById('humidity').textContent = `${data.humidity}%`;
    document.getElementById('windSpeed').textContent = `${data.wind} km/h`;
    document.getElementById('feelsLike').textContent = `${data.feels}°C`;
}"""
}

# 看板（Kanban Board）模板
KANBAN_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>看板</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>📋 项目看板</h1>

        <div class="board">
            <div class="column" data-status="todo">
                <div class="column-header">
                    <h3>📝 待办</h3>
                    <span class="count" id="todoCount">0</span>
                </div>
                <div class="cards" id="todoCards" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
                <button class="add-card-btn" onclick="addCard('todo')">+ 添加卡片</button>
            </div>

            <div class="column" data-status="doing">
                <div class="column-header">
                    <h3>⚡ 进行中</h3>
                    <span class="count" id="doingCount">0</span>
                </div>
                <div class="cards" id="doingCards" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
                <button class="add-card-btn" onclick="addCard('doing')">+ 添加卡片</button>
            </div>

            <div class="column" data-status="done">
                <div class="column-header">
                    <h3>✅ 已完成</h3>
                    <span class="count" id="doneCount">0</span>
                </div>
                <div class="cards" id="doneCards" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
                <button class="add-card-btn" onclick="addCard('done')">+ 添加卡片</button>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    color: white;
    margin-bottom: 30px;
}

.board {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
}

.column {
    background: white;
    border-radius: 10px;
    padding: 15px;
    min-height: 500px;
    display: flex;
    flex-direction: column;
}

.column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 2px solid #e0e0e0;
}

.column-header h3 {
    color: #2c3e50;
}

.count {
    background: #ecf0f1;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: bold;
    color: #7f8c8d;
}

.cards {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 15px;
}

.card {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 8px;
    cursor: move;
    transition: all 0.3s;
    border-left: 4px solid #3498db;
}

.card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-2px);
}

.card.dragging {
    opacity: 0.5;
}

.card-content {
    margin-bottom: 10px;
    color: #2c3e50;
}

.card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.card-date {
    font-size: 12px;
    color: #7f8c8d;
}

.delete-btn {
    background: #e74c3c;
    color: white;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.delete-btn:hover {
    background: #c0392b;
}

.add-card-btn {
    width: 100%;
    padding: 10px;
    background: #ecf0f1;
    border: 2px dashed #bdc3c7;
    border-radius: 8px;
    cursor: pointer;
    color: #7f8c8d;
    font-size: 14px;
    transition: all 0.3s;
}

.add-card-btn:hover {
    background: #3498db;
    color: white;
    border-color: #3498db;
}""",

    "script.js": """let cards = JSON.parse(localStorage.getItem('kanbanCards')) || [];

function renderBoard() {
    ['todo', 'doing', 'done'].forEach(status => {
        const container = document.getElementById(status + 'Cards');
        const statusCards = cards.filter(c => c.status === status);

        container.innerHTML = statusCards.map(card => `
            <div class="card" draggable="true" data-id="${card.id}"
                 ondragstart="drag(event)">
                <div class="card-content">${card.content}</div>
                <div class="card-footer">
                    <span class="card-date">${new Date(card.created).toLocaleDateString()}</span>
                    <button class="delete-btn" onclick="deleteCard(${card.id})">删除</button>
                </div>
            </div>
        `).join('');

        document.getElementById(status + 'Count').textContent = statusCards.length;
    });
}

function addCard(status) {
    const content = prompt('请输入卡片内容：');
    if (!content) return;

    const card = {
        id: Date.now(),
        content: content,
        status: status,
        created: Date.now()
    };

    cards.push(card);
    saveCards();
    renderBoard();
}

function deleteCard(id) {
    if (!confirm('确定要删除这张卡片吗？')) return;
    cards = cards.filter(c => c.id !== id);
    saveCards();
    renderBoard();
}

function allowDrop(e) {
    e.preventDefault();
}

function drag(e) {
    e.dataTransfer.setData('cardId', e.target.dataset.id);
    e.target.classList.add('dragging');
}

function drop(e) {
    e.preventDefault();
    const cardId = parseInt(e.dataTransfer.getData('cardId'));
    const newStatus = e.target.closest('.column').dataset.status;

    const card = cards.find(c => c.id === cardId);
    if (card) {
        card.status = newStatus;
        saveCards();
        renderBoard();
    }

    document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging'));
}

function saveCards() {
    localStorage.setItem('kanbanCards', JSON.stringify(cards));
}

renderBoard();"""
}

# 2048游戏模板
GAME_2048_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>2048游戏</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🎮 2048</h1>

        <div class="game-info">
            <div class="score-box">
                <div class="score-label">得分</div>
                <div class="score-value" id="score">0</div>
            </div>
            <div class="score-box">
                <div class="score-label">最高分</div>
                <div class="score-value" id="bestScore">0</div>
            </div>
        </div>

        <button class="new-game-btn" onclick="newGame()">新游戏</button>

        <div class="game-board" id="gameBoard"></div>

        <div class="instructions">
            <p>使用方向键 ←↑→↓ 移动方块</p>
            <p>相同数字的方块会合并</p>
            <p>目标：获得2048方块！</p>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    text-align: center;
}

h1 {
    color: #776e65;
    font-size: 48px;
    margin-bottom: 20px;
}

.game-info {
    display: flex;
    gap: 20px;
    justify-content: center;
    margin-bottom: 20px;
}

.score-box {
    background: #bbada0;
    padding: 15px 25px;
    border-radius: 8px;
    color: white;
}

.score-label {
    font-size: 14px;
    opacity: 0.9;
}

.score-value {
    font-size: 28px;
    font-weight: bold;
}

.new-game-btn {
    padding: 12px 30px;
    background: #8f7a66;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    margin-bottom: 20px;
}

.new-game-btn:hover {
    background: #9f8a76;
}

.game-board {
    background: #bbada0;
    padding: 10px;
    border-radius: 10px;
    display: grid;
    grid-template-columns: repeat(4, 100px);
    grid-template-rows: repeat(4, 100px);
    gap: 10px;
    margin: 0 auto 20px;
    width: fit-content;
}

.tile {
    background: #cdc1b4;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: bold;
    color: #776e65;
}

.tile-2 { background: #eee4da; }
.tile-4 { background: #ede0c8; }
.tile-8 { background: #f2b179; color: white; }
.tile-16 { background: #f59563; color: white; }
.tile-32 { background: #f67c5f; color: white; }
.tile-64 { background: #f65e3b; color: white; }
.tile-128 { background: #edcf72; color: white; font-size: 28px; }
.tile-256 { background: #edcc61; color: white; font-size: 28px; }
.tile-512 { background: #edc850; color: white; font-size: 28px; }
.tile-1024 { background: #edc53f; color: white; font-size: 24px; }
.tile-2048 { background: #edc22e; color: white; font-size: 24px; }

.instructions {
    color: #776e65;
    font-size: 14px;
    line-height: 1.6;
}""",

    "script.js": """let board = [];
let score = 0;
let bestScore = parseInt(localStorage.getItem('2048-bestScore')) || 0;

function newGame() {
    board = Array(4).fill(null).map(() => Array(4).fill(0));
    score = 0;
    addRandomTile();
    addRandomTile();
    updateBoard();
    updateScore();
}

function addRandomTile() {
    const empty = [];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            if (board[i][j] === 0) empty.push({i, j});
        }
    }
    if (empty.length > 0) {
        const {i, j} = empty[Math.floor(Math.random() * empty.length)];
        board[i][j] = Math.random() < 0.9 ? 2 : 4;
    }
}

function updateBoard() {
    const gameBoard = document.getElementById('gameBoard');
    gameBoard.innerHTML = '';

    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            if (board[i][j] > 0) {
                tile.classList.add('tile-' + board[i][j]);
                tile.textContent = board[i][j];
            }
            gameBoard.appendChild(tile);
        }
    }
}

function updateScore() {
    document.getElementById('score').textContent = score;
    document.getElementById('bestScore').textContent = bestScore;
}

function move(direction) {
    let moved = false;

    if (direction === 'left') {
        for (let i = 0; i < 4; i++) {
            const row = board[i].filter(x => x !== 0);
            for (let j = 0; j < row.length - 1; j++) {
                if (row[j] === row[j + 1]) {
                    row[j] *= 2;
                    score += row[j];
                    row.splice(j + 1, 1);
                }
            }
            while (row.length < 4) row.push(0);
            if (board[i].toString() !== row.toString()) moved = true;
            board[i] = row;
        }
    } else if (direction === 'right') {
        for (let i = 0; i < 4; i++) {
            const row = board[i].filter(x => x !== 0).reverse();
            for (let j = 0; j < row.length - 1; j++) {
                if (row[j] === row[j + 1]) {
                    row[j] *= 2;
                    score += row[j];
                    row.splice(j + 1, 1);
                }
            }
            while (row.length < 4) row.push(0);
            row.reverse();
            if (board[i].toString() !== row.toString()) moved = true;
            board[i] = row;
        }
    } else if (direction === 'up') {
        for (let j = 0; j < 4; j++) {
            const col = [];
            for (let i = 0; i < 4; i++) {
                if (board[i][j] !== 0) col.push(board[i][j]);
            }
            for (let i = 0; i < col.length - 1; i++) {
                if (col[i] === col[i + 1]) {
                    col[i] *= 2;
                    score += col[i];
                    col.splice(i + 1, 1);
                }
            }
            while (col.length < 4) col.push(0);
            for (let i = 0; i < 4; i++) {
                if (board[i][j] !== col[i]) moved = true;
                board[i][j] = col[i];
            }
        }
    } else if (direction === 'down') {
        for (let j = 0; j < 4; j++) {
            const col = [];
            for (let i = 3; i >= 0; i--) {
                if (board[i][j] !== 0) col.push(board[i][j]);
            }
            for (let i = 0; i < col.length - 1; i++) {
                if (col[i] === col[i + 1]) {
                    col[i] *= 2;
                    score += col[i];
                    col.splice(i + 1, 1);
                }
            }
            while (col.length < 4) col.push(0);
            for (let i = 0; i < 4; i++) {
                if (board[3 - i][j] !== col[i]) moved = true;
                board[3 - i][j] = col[i];
            }
        }
    }

    if (moved) {
        addRandomTile();
        updateBoard();
        if (score > bestScore) {
            bestScore = score;
            localStorage.setItem('2048-bestScore', bestScore);
        }
        updateScore();

        if (isGameOver()) {
            setTimeout(() => alert('游戏结束！得分：' + score), 100);
        }
    }
}

function isGameOver() {
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            if (board[i][j] === 0) return false;
            if (j < 3 && board[i][j] === board[i][j + 1]) return false;
            if (i < 3 && board[i][j] === board[i + 1][j]) return false;
        }
    }
    return true;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') move('left');
    else if (e.key === 'ArrowRight') move('right');
    else if (e.key === 'ArrowUp') move('up');
    else if (e.key === 'ArrowDown') move('down');
});

newGame();"""
}

# 聊天界面模板
CHAT_UI_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>聊天</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="user-info">
                <div class="avatar">👤</div>
                <div>
                    <div class="name">聊天助手</div>
                    <div class="status">在线</div>
                </div>
            </div>
        </div>

        <div class="messages" id="messages"></div>

        <div class="input-area">
            <input type="text" id="messageInput" placeholder="输入消息..." onkeypress="if(event.key==='Enter') sendMessage()">
            <button onclick="sendMessage()">发送</button>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: #e5ddd5;
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.chat-container {
    width: 100%;
    max-width: 600px;
    height: 700px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
}

.chat-header {
    padding: 15px 20px;
    background: #075e54;
    color: white;
    border-radius: 10px 10px 0 0;
}

.user-info {
    display: flex;
    align-items: center;
    gap: 15px;
}

.avatar {
    width: 45px;
    height: 45px;
    border-radius: 50%;
    background: #128c7e;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
}

.name {
    font-size: 16px;
    font-weight: bold;
}

.status {
    font-size: 13px;
    opacity: 0.8;
}

.messages {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    background: #e5ddd5;
}

.message {
    display: flex;
    margin-bottom: 15px;
    animation: slideIn 0.3s;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.message.sent {
    justify-content: flex-end;
}

.message-bubble {
    max-width: 70%;
    padding: 10px 15px;
    border-radius: 8px;
    position: relative;
}

.message.received .message-bubble {
    background: white;
    border-radius: 0 8px 8px 8px;
}

.message.sent .message-bubble {
    background: #dcf8c6;
    border-radius: 8px 0 8px 8px;
}

.message-text {
    word-wrap: break-word;
}

.message-time {
    font-size: 11px;
    color: #999;
    margin-top: 5px;
    text-align: right;
}

.input-area {
    padding: 15px;
    background: #f0f0f0;
    display: flex;
    gap: 10px;
    border-radius: 0 0 10px 10px;
}

.input-area input {
    flex: 1;
    padding: 12px 15px;
    border: none;
    border-radius: 25px;
    font-size: 15px;
}

.input-area input:focus {
    outline: none;
}

.input-area button {
    padding: 12px 25px;
    background: #075e54;
    color: white;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-size: 15px;
}

.input-area button:hover {
    background: #128c7e;
}""",

    "script.js": """let messages = [];

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text) return;

    // 添加用户消息
    addMessage(text, 'sent');
    input.value = '';

    // 模拟回复
    setTimeout(() => {
        const replies = [
            '收到！',
            '好的，我明白了',
            '这是个好主意！',
            '让我想想...',
            '可以详细说说吗？',
            '👍',
            '有意思！'
        ];
        const reply = replies[Math.floor(Math.random() * replies.length)];
        addMessage(reply, 'received');
    }, 1000);
}

function addMessage(text, type) {
    const message = {
        text: text,
        type: type,
        time: new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})
    };

    messages.push(message);
    renderMessages();
}

function renderMessages() {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = messages.map(msg => `
        <div class="message ${msg.type}">
            <div class="message-bubble">
                <div class="message-text">${msg.text}</div>
                <div class="message-time">${msg.time}</div>
            </div>
        </div>
    `).join('');

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 初始消息
addMessage('你好！有什么可以帮助你的吗？', 'received');"""
}

# 颜色选择器模板
COLOR_PICKER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>颜色选择器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🎨 颜色选择器</h1>

        <div class="color-display" id="colorDisplay"></div>

        <div class="controls">
            <div class="control-group">
                <label>HEX</label>
                <input type="text" id="hexInput" placeholder="#000000" onchange="updateFromHex()">
            </div>

            <div class="control-group">
                <label>R</label>
                <input type="range" id="rSlider" min="0" max="255" value="0" oninput="updateFromRGB()">
                <span id="rValue">0</span>
            </div>

            <div class="control-group">
                <label>G</label>
                <input type="range" id="gSlider" min="0" max="255" value="0" oninput="updateFromRGB()">
                <span id="gValue">0</span>
            </div>

            <div class="control-group">
                <label>B</label>
                <input type="range" id="bSlider" min="0" max="255" value="0" oninput="updateFromRGB()">
                <span id="bValue">0</span>
            </div>
        </div>

        <div class="palette">
            <h3>常用颜色</h3>
            <div class="color-swatches" id="swatches"></div>
        </div>

        <div class="actions">
            <button onclick="copyToClipboard()">📋 复制 HEX</button>
            <button onclick="addToFavorites()">⭐ 添加到收藏</button>
        </div>

        <div class="favorites" id="favorites"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
}

.container {
    background: white;
    padding: 30px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 500px;
}

h1 {
    text-align: center;
    color: #2c3e50;
    margin-bottom: 30px;
}

.color-display {
    height: 200px;
    border-radius: 10px;
    margin-bottom: 30px;
    border: 3px solid #ecf0f1;
}

.controls {
    margin-bottom: 30px;
}

.control-group {
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 15px;
}

.control-group label {
    width: 50px;
    font-weight: bold;
    color: #2c3e50;
}

.control-group input[type="text"] {
    flex: 1;
    padding: 10px;
    border: 2px solid #e0e0e0;
    border-radius: 6px;
    font-size: 16px;
}

.control-group input[type="range"] {
    flex: 1;
    height: 8px;
}

.control-group span {
    width: 40px;
    text-align: center;
    font-weight: bold;
    color: #7f8c8d;
}

.palette h3 {
    color: #2c3e50;
    margin-bottom: 15px;
}

.color-swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
    gap: 10px;
    margin-bottom: 20px;
}

.swatch {
    aspect-ratio: 1;
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.3s;
    border: 2px solid #e0e0e0;
}

.swatch:hover {
    transform: scale(1.1);
}

.actions {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
}

.actions button {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    background: #3498db;
    color: white;
}

.actions button:hover {
    background: #2980b9;
}

.favorites {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
    gap: 10px;
}""",

    "script.js": """const commonColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85929E', '#F1948A', '#82E0AA',
    '#D2B4DE', '#F8B739', '#52BE80', '#5DADE2', '#EC7063'
];

let favorites = JSON.parse(localStorage.getItem('colorFavorites')) || [];
let currentColor = {r: 0, g: 0, b: 0};

function init() {
    renderSwatches();
    renderFavorites();
    updateFromRGB();
}

function renderSwatches() {
    document.getElementById('swatches').innerHTML = commonColors.map(color => `
        <div class="swatch" style="background: ${color}" onclick="setColorFromHex('${color}')"></div>
    `).join('');
}

function renderFavorites() {
    document.getElementById('favorites').innerHTML = favorites.map((color, i) => `
        <div class="swatch" style="background: ${color}"
             onclick="setColorFromHex('${color}')"
             title="双击删除"
             ondblclick="removeFavorite(${i})"></div>
    `).join('');
}

function updateFromRGB() {
    currentColor.r = parseInt(document.getElementById('rSlider').value);
    currentColor.g = parseInt(document.getElementById('gSlider').value);
    currentColor.b = parseInt(document.getElementById('bSlider').value);

    document.getElementById('rValue').textContent = currentColor.r;
    document.getElementById('gValue').textContent = currentColor.g;
    document.getElementById('bValue').textContent = currentColor.b;

    const hex = rgbToHex(currentColor.r, currentColor.g, currentColor.b);
    document.getElementById('hexInput').value = hex;
    document.getElementById('colorDisplay').style.background = hex;
}

function updateFromHex() {
    const hex = document.getElementById('hexInput').value;
    const rgb = hexToRgb(hex);
    if (rgb) {
        currentColor = rgb;
        document.getElementById('rSlider').value = rgb.r;
        document.getElementById('gSlider').value = rgb.g;
        document.getElementById('bSlider').value = rgb.b;
        updateFromRGB();
    }
}

function setColorFromHex(hex) {
    document.getElementById('hexInput').value = hex;
    updateFromHex();
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function copyToClipboard() {
    const hex = document.getElementById('hexInput').value;
    navigator.clipboard.writeText(hex).then(() => {
        alert('已复制: ' + hex);
    });
}

function addToFavorites() {
    const hex = document.getElementById('hexInput').value;
    if (!favorites.includes(hex)) {
        favorites.push(hex);
        localStorage.setItem('colorFavorites', JSON.stringify(favorites));
        renderFavorites();
    }
}

function removeFavorite(index) {
    favorites.splice(index, 1);
    localStorage.setItem('colorFavorites', JSON.stringify(favorites));
    renderFavorites();
}

init();"""
}

# 贪吃蛇游戏模板
SNAKE_GAME_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>贪吃蛇游戏</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🐍 贪吃蛇</h1>
        <div class="score-board">
            <div>得分: <span id="score">0</span></div>
            <div>最高分: <span id="highScore">0</span></div>
        </div>
        <canvas id="gameCanvas" width="400" height="400"></canvas>
        <div class="controls">
            <button id="startBtn">开始游戏</button>
            <button id="pauseBtn">暂停</button>
            <button id="resetBtn">重置</button>
        </div>
        <div class="instructions">
            <p>使用方向键控制蛇的移动</p>
            <p>吃到食物得分，撞墙或撞到自己游戏结束</p>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 30px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    text-align: center;
}

h1 {
    color: #2c3e50;
    margin-bottom: 20px;
}

.score-board {
    display: flex;
    justify-content: space-around;
    margin-bottom: 20px;
    font-size: 18px;
    font-weight: bold;
    color: #34495e;
}

#gameCanvas {
    border: 3px solid #34495e;
    border-radius: 10px;
    background: #ecf0f1;
    display: block;
    margin: 0 auto 20px;
}

.controls {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 20px;
}

button {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
}

#startBtn {
    background: #27ae60;
    color: white;
}

#startBtn:hover {
    background: #229954;
}

#pauseBtn {
    background: #f39c12;
    color: white;
}

#pauseBtn:hover {
    background: #e67e22;
}

#resetBtn {
    background: #e74c3c;
    color: white;
}

#resetBtn:hover {
    background: #c0392b;
}

.instructions {
    color: #7f8c8d;
    font-size: 14px;
    line-height: 1.8;
}""",

    "script.js": """const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gridSize = 20;
const tileCount = canvas.width / gridSize;

let snake = [{x: 10, y: 10}];
let food = {x: 15, y: 15};
let dx = 0;
let dy = 0;
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
let gameLoop;
let isPaused = false;
let gameStarted = false;

document.getElementById('highScore').textContent = highScore;

document.addEventListener('keydown', changeDirection);
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.getElementById('resetBtn').addEventListener('click', resetGame);

function startGame() {
    if (!gameStarted) {
        gameStarted = true;
        gameLoop = setInterval(update, 100);
    }
}

function togglePause() {
    if (!gameStarted) return;

    isPaused = !isPaused;
    document.getElementById('pauseBtn').textContent = isPaused ? '继续' : '暂停';
}

function resetGame() {
    clearInterval(gameLoop);
    snake = [{x: 10, y: 10}];
    food = {x: 15, y: 15};
    dx = 0;
    dy = 0;
    score = 0;
    isPaused = false;
    gameStarted = false;
    document.getElementById('score').textContent = score;
    document.getElementById('pauseBtn').textContent = '暂停';
    draw();
}

function update() {
    if (isPaused) return;

    const head = {x: snake[0].x + dx, y: snake[0].y + dy};

    if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        gameOver();
        return;
    }

    for (let segment of snake) {
        if (head.x === segment.x && head.y === segment.y) {
            gameOver();
            return;
        }
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
        score++;
        document.getElementById('score').textContent = score;
        if (score > highScore) {
            highScore = score;
            localStorage.setItem('snakeHighScore', highScore);
            document.getElementById('highScore').textContent = highScore;
        }
        generateFood();
    } else {
        snake.pop();
    }

    draw();
}

function draw() {
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#27ae60';
    for (let i = 0; i < snake.length; i++) {
        ctx.fillRect(snake[i].x * gridSize, snake[i].y * gridSize, gridSize - 2, gridSize - 2);
    }

    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);
}

function generateFood() {
    food.x = Math.floor(Math.random() * tileCount);
    food.y = Math.floor(Math.random() * tileCount);

    for (let segment of snake) {
        if (food.x === segment.x && food.y === segment.y) {
            generateFood();
            return;
        }
    }
}

function changeDirection(event) {
    const key = event.keyCode;

    if (key === 37 && dx === 0) {
        dx = -1;
        dy = 0;
    } else if (key === 38 && dy === 0) {
        dx = 0;
        dy = -1;
    } else if (key === 39 && dx === 0) {
        dx = 1;
        dy = 0;
    } else if (key === 40 && dy === 0) {
        dx = 0;
        dy = 1;
    }

    if (!gameStarted && (dx !== 0 || dy !== 0)) {
        startGame();
    }
}

function gameOver() {
    clearInterval(gameLoop);
    gameStarted = false;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('游戏结束!', canvas.width / 2, canvas.height / 2);
    ctx.font = '20px Arial';
    ctx.fillText('得分: ' + score, canvas.width / 2, canvas.height / 2 + 40);
}

draw();"""
}

# 记忆卡片游戏模板
MEMORY_GAME_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>记忆卡片游戏</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🧠 记忆卡片游戏</h1>
        <div class="game-info">
            <div>翻转次数: <span id="moves">0</span></div>
            <div>匹配数: <span id="matches">0</span> / 8</div>
            <div>时间: <span id="timer">0</span>s</div>
        </div>
        <div id="gameBoard" class="game-board"></div>
        <button id="resetBtn">重新开始</button>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 30px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    text-align: center;
}

h1 {
    color: #2c3e50;
    margin-bottom: 20px;
}

.game-info {
    display: flex;
    justify-content: space-around;
    margin-bottom: 30px;
    font-size: 16px;
    font-weight: bold;
    color: #34495e;
}

.game-board {
    display: grid;
    grid-template-columns: repeat(4, 100px);
    grid-gap: 10px;
    margin: 0 auto 30px;
    justify-content: center;
}

.card {
    width: 100px;
    height: 100px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 10px;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 40px;
    cursor: pointer;
    transition: all 0.3s;
    position: relative;
}

.card:hover {
    transform: scale(1.05);
}

.card.flipped {
    background: white;
    border: 3px solid #667eea;
}

.card.matched {
    background: #27ae60;
    cursor: default;
    opacity: 0.7;
}

.card .front {
    display: none;
}

.card.flipped .front,
.card.matched .front {
    display: block;
}

#resetBtn {
    padding: 12px 40px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
}

#resetBtn:hover {
    background: #5568d3;
    transform: scale(1.05);
}""",

    "script.js": """const symbols = ['🍎', '🍌', '🍇', '🍊', '🍓', '🍒', '🥝', '🍑'];
let cards = [...symbols, ...symbols];
let flippedCards = [];
let matchedPairs = 0;
let moves = 0;
let timer = 0;
let timerInterval;

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function initGame() {
    cards = shuffle([...symbols, ...symbols]);
    const gameBoard = document.getElementById('gameBoard');
    gameBoard.innerHTML = '';
    flippedCards = [];
    matchedPairs = 0;
    moves = 0;
    timer = 0;
    clearInterval(timerInterval);

    document.getElementById('moves').textContent = moves;
    document.getElementById('matches').textContent = matchedPairs;
    document.getElementById('timer').textContent = timer;

    cards.forEach((symbol, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = index;
        card.innerHTML = `<div class="front">${symbol}</div>`;
        card.addEventListener('click', flipCard);
        gameBoard.appendChild(card);
    });
}

function flipCard() {
    if (flippedCards.length >= 2) return;
    if (this.classList.contains('flipped') || this.classList.contains('matched')) return;

    if (flippedCards.length === 0) {
        timerInterval = setInterval(() => {
            timer++;
            document.getElementById('timer').textContent = timer;
        }, 1000);
    }

    this.classList.add('flipped');
    flippedCards.push(this);

    if (flippedCards.length === 2) {
        moves++;
        document.getElementById('moves').textContent = moves;
        checkMatch();
    }
}

function checkMatch() {
    const [card1, card2] = flippedCards;
    const index1 = card1.dataset.index;
    const index2 = card2.dataset.index;

    if (cards[index1] === cards[index2]) {
        card1.classList.add('matched');
        card2.classList.add('matched');
        matchedPairs++;
        document.getElementById('matches').textContent = matchedPairs;
        flippedCards = [];

        if (matchedPairs === 8) {
            clearInterval(timerInterval);
            setTimeout(() => {
                alert(`恭喜完成! 用时: ${timer}秒, 步数: ${moves}`);
            }, 500);
        }
    } else {
        setTimeout(() => {
            card1.classList.remove('flipped');
            card2.classList.remove('flipped');
            flippedCards = [];
        }, 1000);
    }
}

document.getElementById('resetBtn').addEventListener('click', initGame);

initGame();"""
}

# 问答应用模板
QUIZ_APP_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>趣味问答</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <div id="quiz" class="quiz">
            <h1>🎯 趣味问答</h1>
            <div id="question" class="question"></div>
            <div id="options" class="options"></div>
            <div class="quiz-footer">
                <div class="progress">
                    题目 <span id="currentQuestion">1</span> / <span id="totalQuestions">5</span>
                </div>
                <button id="nextBtn" style="display:none;">下一题</button>
            </div>
        </div>
        <div id="result" class="result" style="display:none;">
            <h1>🎉 测验完成!</h1>
            <div class="score-display">
                <div class="score-circle">
                    <span id="scoreText">0</span>
                    <span class="score-total">/ 5</span>
                </div>
            </div>
            <button id="restartBtn">重新开始</button>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 600px;
}

h1 {
    color: #2c3e50;
    text-align: center;
    margin-bottom: 30px;
}

.question {
    font-size: 20px;
    color: #34495e;
    margin-bottom: 30px;
    font-weight: 500;
    line-height: 1.6;
}

.options {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.option {
    padding: 15px 20px;
    background: #f8f9fa;
    border: 2px solid #e9ecef;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s;
    font-size: 16px;
}

.option:hover {
    background: #e9ecef;
    transform: translateX(5px);
}

.option.correct {
    background: #d4edda;
    border-color: #28a745;
}

.option.wrong {
    background: #f8d7da;
    border-color: #dc3545;
}

.option.disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.quiz-footer {
    margin-top: 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.progress {
    color: #6c757d;
    font-weight: bold;
}

button {
    padding: 12px 30px;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
}

button:hover {
    transform: scale(1.05);
    box-shadow: 0 5px 15px rgba(245, 87, 108, 0.4);
}

.result {
    text-align: center;
}

.score-display {
    margin: 40px 0;
}

.score-circle {
    width: 200px;
    height: 200px;
    margin: 0 auto;
    border-radius: 50%;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    box-shadow: 0 10px 30px rgba(245, 87, 108, 0.3);
}

#scoreText {
    font-size: 60px;
    font-weight: bold;
}

.score-total {
    font-size: 24px;
}""",

    "script.js": """const questions = [
    {
        question: "世界上最高的山峰是?",
        options: ["乞力马扎罗山", "珠穆朗玛峰", "富士山", "泰山"],
        correct: 1
    },
    {
        question: "太阳系中最大的行星是?",
        options: ["地球", "火星", "木星", "土星"],
        correct: 2
    },
    {
        question: "中国的首都是?",
        options: ["上海", "广州", "北京", "深圳"],
        correct: 2
    },
    {
        question: "一天有多少小时?",
        options: ["12", "24", "48", "36"],
        correct: 1
    },
    {
        question: "世界上最大的海洋是?",
        options: ["大西洋", "印度洋", "北冰洋", "太平洋"],
        correct: 3
    }
];

let currentQuestionIndex = 0;
let score = 0;

function showQuestion() {
    const question = questions[currentQuestionIndex];
    document.getElementById('question').textContent = question.question;
    document.getElementById('currentQuestion').textContent = currentQuestionIndex + 1;
    document.getElementById('totalQuestions').textContent = questions.length;

    const optionsDiv = document.getElementById('options');
    optionsDiv.innerHTML = '';

    question.options.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option';
        optionDiv.textContent = option;
        optionDiv.addEventListener('click', () => selectOption(index));
        optionsDiv.appendChild(optionDiv);
    });

    document.getElementById('nextBtn').style.display = 'none';
}

function selectOption(selectedIndex) {
    const question = questions[currentQuestionIndex];
    const options = document.querySelectorAll('.option');

    options.forEach(option => {
        option.classList.add('disabled');
    });

    if (selectedIndex === question.correct) {
        options[selectedIndex].classList.add('correct');
        score++;
    } else {
        options[selectedIndex].classList.add('wrong');
        options[question.correct].classList.add('correct');
    }

    document.getElementById('nextBtn').style.display = 'block';
}

function nextQuestion() {
    currentQuestionIndex++;

    if (currentQuestionIndex < questions.length) {
        showQuestion();
    } else {
        showResult();
    }
}

function showResult() {
    document.getElementById('quiz').style.display = 'none';
    document.getElementById('result').style.display = 'block';
    document.getElementById('scoreText').textContent = score;
}

function restart() {
    currentQuestionIndex = 0;
    score = 0;
    document.getElementById('quiz').style.display = 'block';
    document.getElementById('result').style.display = 'none';
    showQuestion();
}

document.getElementById('nextBtn').addEventListener('click', nextQuestion);
document.getElementById('restartBtn').addEventListener('click', restart);

showQuestion();"""
}

# 打字测试模板
TYPING_TEST_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>打字速度测试</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>⌨️ 打字速度测试</h1>
        <div class="stats">
            <div class="stat">
                <div class="stat-value" id="wpm">0</div>
                <div class="stat-label">WPM</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="accuracy">100</div>
                <div class="stat-label">准确率%</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="timer">60</div>
                <div class="stat-label">剩余时间(秒)</div>
            </div>
        </div>
        <div id="textDisplay" class="text-display"></div>
        <textarea id="textInput" class="text-input" placeholder="点击此处开始打字..." disabled></textarea>
        <div class="controls">
            <button id="startBtn">开始测试</button>
            <button id="resetBtn">重新开始</button>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Courier New', monospace;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 800px;
}

h1 {
    color: #2c3e50;
    text-align: center;
    margin-bottom: 30px;
}

.stats {
    display: flex;
    justify-content: space-around;
    margin-bottom: 30px;
}

.stat {
    text-align: center;
}

.stat-value {
    font-size: 36px;
    font-weight: bold;
    color: #667eea;
}

.stat-label {
    color: #6c757d;
    margin-top: 5px;
    font-size: 14px;
}

.text-display {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 20px;
    font-size: 18px;
    line-height: 1.8;
    min-height: 120px;
}

.text-display span.correct {
    color: #28a745;
}

.text-display span.incorrect {
    color: #dc3545;
    background: #f8d7da;
}

.text-display span.current {
    background: #667eea;
    color: white;
}

.text-input {
    width: 100%;
    padding: 20px;
    border: 2px solid #e9ecef;
    border-radius: 10px;
    font-size: 18px;
    font-family: 'Courier New', monospace;
    resize: vertical;
    min-height: 120px;
    margin-bottom: 20px;
}

.text-input:focus {
    outline: none;
    border-color: #667eea;
}

.text-input:disabled {
    background: #e9ecef;
    cursor: not-allowed;
}

.controls {
    display: flex;
    gap: 10px;
    justify-content: center;
}

button {
    padding: 12px 30px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
}

#startBtn {
    background: #28a745;
    color: white;
}

#startBtn:hover {
    background: #218838;
}

#resetBtn {
    background: #6c757d;
    color: white;
}

#resetBtn:hover {
    background: #5a6268;
}""",

    "script.js": """const sampleTexts = [
    "The quick brown fox jumps over the lazy dog.",
    "Practice makes perfect when learning to type faster.",
    "Speed and accuracy are both important in typing tests.",
    "Keep your fingers on the home row keys for better results.",
    "Good posture and proper technique lead to faster typing speeds."
];

let currentText = '';
let startTime;
let timerInterval;
let timeLeft = 60;
let isTestRunning = false;

function init() {
    currentText = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
    displayText();
}

function displayText() {
    const textDisplay = document.getElementById('textDisplay');
    textDisplay.innerHTML = currentText.split('').map((char, index) => {
        return `<span data-index="${index}">${char}</span>`;
    }).join('');
}

function startTest() {
    if (isTestRunning) return;

    isTestRunning = true;
    startTime = Date.now();
    timeLeft = 60;
    document.getElementById('textInput').disabled = false;
    document.getElementById('textInput').value = '';
    document.getElementById('textInput').focus();

    timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
    timeLeft--;
    document.getElementById('timer').textContent = timeLeft;

    if (timeLeft <= 0) {
        endTest();
    }
}

function endTest() {
    clearInterval(timerInterval);
    isTestRunning = false;
    document.getElementById('textInput').disabled = true;
}

function resetTest() {
    clearInterval(timerInterval);
    isTestRunning = false;
    timeLeft = 60;
    document.getElementById('timer').textContent = timeLeft;
    document.getElementById('wpm').textContent = 0;
    document.getElementById('accuracy').textContent = 100;
    document.getElementById('textInput').value = '';
    document.getElementById('textInput').disabled = true;
    init();
}

function calculateStats(input) {
    const typedChars = input.length;
    const correctChars = input.split('').filter((char, index) => char === currentText[index]).length;
    const accuracy = typedChars > 0 ? Math.round((correctChars / typedChars) * 100) : 100;

    const timeElapsed = (Date.now() - startTime) / 1000 / 60;
    const wpm = Math.round((correctChars / 5) / timeElapsed);

    document.getElementById('wpm').textContent = wpm || 0;
    document.getElementById('accuracy').textContent = accuracy;
}

function updateTextDisplay(input) {
    const spans = document.querySelectorAll('#textDisplay span');

    spans.forEach((span, index) => {
        span.className = '';
        if (index < input.length) {
            if (input[index] === currentText[index]) {
                span.classList.add('correct');
            } else {
                span.classList.add('incorrect');
            }
        } else if (index === input.length) {
            span.classList.add('current');
        }
    });
}

document.getElementById('textInput').addEventListener('input', (e) => {
    const input = e.target.value;
    updateTextDisplay(input);
    calculateStats(input);

    if (input.length >= currentText.length) {
        endTest();
    }
});

document.getElementById('startBtn').addEventListener('click', startTest);
document.getElementById('resetBtn').addEventListener('click', resetTest);

init();"""
}

# 单位转换器模板
UNIT_CONVERTER_TEMPLATE = {
    "index.html": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>单位转换器</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>🔄 单位转换器</h1>

        <div class="category-selector">
            <button class="category-btn active" data-category="length">长度</button>
            <button class="category-btn" data-category="weight">重量</button>
            <button class="category-btn" data-category="temperature">温度</button>
            <button class="category-btn" data-category="area">面积</button>
        </div>

        <div class="converter">
            <div class="input-group">
                <input type="number" id="fromValue" placeholder="0">
                <select id="fromUnit"></select>
            </div>

            <div class="swap-btn" onclick="swapUnits()">⇄</div>

            <div class="input-group">
                <input type="number" id="toValue" placeholder="0" readonly>
                <select id="toUnit"></select>
            </div>
        </div>

        <div class="formula" id="formula"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>""",

    "styles.css": """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 500px;
}

h1 {
    color: #2c3e50;
    text-align: center;
    margin-bottom: 30px;
}

.category-selector {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
    flex-wrap: wrap;
}

.category-btn {
    flex: 1;
    padding: 12px;
    background: #f8f9fa;
    border: 2px solid #e9ecef;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
    font-size: 14px;
}

.category-btn:hover {
    background: #e9ecef;
}

.category-btn.active {
    background: #667eea;
    color: white;
    border-color: #667eea;
}

.converter {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.input-group {
    display: flex;
    gap: 10px;
}

input[type="number"] {
    flex: 2;
    padding: 15px;
    border: 2px solid #e9ecef;
    border-radius: 8px;
    font-size: 18px;
}

input[type="number"]:focus {
    outline: none;
    border-color: #667eea;
}

select {
    flex: 1;
    padding: 15px;
    border: 2px solid #e9ecef;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    background: white;
}

select:focus {
    outline: none;
    border-color: #667eea;
}

.swap-btn {
    width: 50px;
    height: 50px;
    margin: 0 auto;
    background: #667eea;
    color: white;
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 24px;
    cursor: pointer;
    transition: all 0.3s;
}

.swap-btn:hover {
    transform: rotate(180deg);
    background: #5568d3;
}

.formula {
    margin-top: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    text-align: center;
    color: #6c757d;
    font-size: 14px;
}""",

    "script.js": """const units = {
    length: {
        meter: { name: '米', factor: 1 },
        kilometer: { name: '千米', factor: 0.001 },
        centimeter: { name: '厘米', factor: 100 },
        millimeter: { name: '毫米', factor: 1000 },
        mile: { name: '英里', factor: 0.000621371 },
        yard: { name: '码', factor: 1.09361 },
        foot: { name: '英尺', factor: 3.28084 },
        inch: { name: '英寸', factor: 39.3701 }
    },
    weight: {
        kilogram: { name: '千克', factor: 1 },
        gram: { name: '克', factor: 1000 },
        milligram: { name: '毫克', factor: 1000000 },
        ton: { name: '吨', factor: 0.001 },
        pound: { name: '磅', factor: 2.20462 },
        ounce: { name: '盎司', factor: 35.274 }
    },
    temperature: {
        celsius: { name: '摄氏度' },
        fahrenheit: { name: '华氏度' },
        kelvin: { name: '开尔文' }
    },
    area: {
        square_meter: { name: '平方米', factor: 1 },
        square_kilometer: { name: '平方千米', factor: 0.000001 },
        square_centimeter: { name: '平方厘米', factor: 10000 },
        hectare: { name: '公顷', factor: 0.0001 },
        acre: { name: '英亩', factor: 0.000247105 },
        square_mile: { name: '平方英里', factor: 3.861e-7 },
        square_foot: { name: '平方英尺', factor: 10.7639 }
    }
};

let currentCategory = 'length';

function populateUnits() {
    const fromUnit = document.getElementById('fromUnit');
    const toUnit = document.getElementById('toUnit');

    fromUnit.innerHTML = '';
    toUnit.innerHTML = '';

    Object.keys(units[currentCategory]).forEach(key => {
        const option1 = document.createElement('option');
        option1.value = key;
        option1.textContent = units[currentCategory][key].name;
        fromUnit.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = key;
        option2.textContent = units[currentCategory][key].name;
        toUnit.appendChild(option2);
    });

    if (toUnit.options.length > 1) {
        toUnit.selectedIndex = 1;
    }
}

function convert() {
    const fromValue = parseFloat(document.getElementById('fromValue').value) || 0;
    const fromUnit = document.getElementById('fromUnit').value;
    const toUnit = document.getElementById('toUnit').value;

    let result;

    if (currentCategory === 'temperature') {
        result = convertTemperature(fromValue, fromUnit, toUnit);
    } else {
        const fromFactor = units[currentCategory][fromUnit].factor;
        const toFactor = units[currentCategory][toUnit].factor;
        result = (fromValue / fromFactor) * toFactor;
    }

    document.getElementById('toValue').value = result.toFixed(4);
    updateFormula(fromValue, fromUnit, result, toUnit);
}

function convertTemperature(value, from, to) {
    let celsius;

    if (from === 'celsius') celsius = value;
    else if (from === 'fahrenheit') celsius = (value - 32) * 5/9;
    else if (from === 'kelvin') celsius = value - 273.15;

    if (to === 'celsius') return celsius;
    else if (to === 'fahrenheit') return celsius * 9/5 + 32;
    else if (to === 'kelvin') return celsius + 273.15;
}

function updateFormula(fromValue, fromUnit, toValue, toUnit) {
    const fromName = units[currentCategory][fromUnit].name;
    const toName = units[currentCategory][toUnit].name;
    document.getElementById('formula').textContent =
        `${fromValue} ${fromName} = ${toValue.toFixed(4)} ${toName}`;
}

function swapUnits() {
    const fromUnit = document.getElementById('fromUnit');
    const toUnit = document.getElementById('toUnit');
    const fromValue = document.getElementById('fromValue');
    const toValue = document.getElementById('toValue');

    [fromUnit.value, toUnit.value] = [toUnit.value, fromUnit.value];
    [fromValue.value, toValue.value] = [toValue.value, fromValue.value];

    convert();
}

document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category;
        populateUnits();
        convert();
    });
});

document.getElementById('fromValue').addEventListener('input', convert);
document.getElementById('fromUnit').addEventListener('change', convert);
document.getElementById('toUnit').addEventListener('change', convert);

populateUnits();"""
}

# 模板映射
TEMPLATES = {
    "todo": TODO_APP_TEMPLATE,
    "blog": BLOG_TEMPLATE,
    "portfolio": PORTFOLIO_TEMPLATE,
    "expense": EXPENSE_TRACKER_TEMPLATE,
    "video": VIDEO_PLAYER_TEMPLATE,
    "videoplayer": VIDEO_PLAYER_TEMPLATE,  # 别名
    "calendar": CALENDAR_TEMPLATE,
    "schedule": CALENDAR_TEMPLATE,  # 别名
    "pomodoro": POMODORO_TEMPLATE,
    "tomato": POMODORO_TEMPLATE,  # 别名
    "focus": POMODORO_TEMPLATE,  # 别名
    "note": NOTE_APP_TEMPLATE,
    "notes": NOTE_APP_TEMPLATE,  # 别名
    "notepad": NOTE_APP_TEMPLATE,  # 别名
    "weather": WEATHER_APP_TEMPLATE,
    "tracker": EXPENSE_TRACKER_TEMPLATE,  # 别名
    "accounting": EXPENSE_TRACKER_TEMPLATE,  # 别名
    "drawing": DRAWING_BOARD_TEMPLATE,
    "paint": DRAWING_BOARD_TEMPLATE,  # 别名
    "calculator": CALCULATOR_TEMPLATE,
    "calc": CALCULATOR_TEMPLATE,  # 别名
    "timer": TIMER_TEMPLATE,
    "countdown": TIMER_TEMPLATE,  # 别名
    "stopwatch": TIMER_TEMPLATE,  # 别名
    "music": MUSIC_PLAYER_TEMPLATE,
    "player": MUSIC_PLAYER_TEMPLATE,  # 别名
    "audio": MUSIC_PLAYER_TEMPLATE,  # 别名
    "gallery": PHOTO_GALLERY_TEMPLATE,
    "photo": PHOTO_GALLERY_TEMPLATE,  # 别名
    "album": PHOTO_GALLERY_TEMPLATE,  # 别名
    "login": LOGIN_PAGE_TEMPLATE,
    "signin": LOGIN_PAGE_TEMPLATE,  # 别名
    "survey": SURVEY_FORM_TEMPLATE,
    "form": SURVEY_FORM_TEMPLATE,  # 别名
    "questionnaire": SURVEY_FORM_TEMPLATE,  # 别名
    "kanban": KANBAN_TEMPLATE,
    "board": KANBAN_TEMPLATE,  # 别名
    "taskboard": KANBAN_TEMPLATE,  # 别名
    "chat": CHAT_UI_TEMPLATE,
    "chatui": CHAT_UI_TEMPLATE,  # 别名
    "messaging": CHAT_UI_TEMPLATE,  # 别名
    "colorpicker": COLOR_PICKER_TEMPLATE,
    "color": COLOR_PICKER_TEMPLATE,  # 别名
    "picker": COLOR_PICKER_TEMPLATE,  # 别名
    "snake": SNAKE_GAME_TEMPLATE,
    "snakegame": SNAKE_GAME_TEMPLATE,  # 别名
    "game": SNAKE_GAME_TEMPLATE,  # 别名
    "memory": MEMORY_GAME_TEMPLATE,
    "memorygame": MEMORY_GAME_TEMPLATE,  # 别名
    "cardgame": MEMORY_GAME_TEMPLATE,  # 别名
    "quiz": QUIZ_APP_TEMPLATE,
    "quizapp": QUIZ_APP_TEMPLATE,  # 别名
    "test": QUIZ_APP_TEMPLATE,  # 别名
    "typing": TYPING_TEST_TEMPLATE,
    "typingtest": TYPING_TEST_TEMPLATE,  # 别名
    "typetest": TYPING_TEST_TEMPLATE,  # 别名
    "converter": UNIT_CONVERTER_TEMPLATE,
    "unitconverter": UNIT_CONVERTER_TEMPLATE,  # 别名
    "unit": UNIT_CONVERTER_TEMPLATE,  # 别名
}


def get_template(template_name: str) -> dict:
    """
    获取指定名称的模板

    Args:
        template_name: 模板名称 (todo, blog, portfolio)

    Returns:
        模板字典，包含HTML、CSS、JS内容
    """
    return TEMPLATES.get(template_name.lower())


def has_template(template_name: str) -> bool:
    """检查是否存在指定模板"""
    return template_name.lower() in TEMPLATES
