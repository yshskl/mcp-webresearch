# MCP Web Research 项目本地调试指南

本文档详细介绍了如何在本地环境中调试 MCP Web Research 项目，包括基础调试方法、可视化调试以及与大模型的集成调试。

## 一、环境准备

在开始调试前，请确保您已完成以下准备工作：

1. 安装 Node.js（推荐版本：16.x 或 18.x）
2. 安装 pnpm 包管理器：`npm install -g pnpm`
3. 克隆项目仓库并安装依赖：
   ```bash
   git clone <项目仓库地址>
   cd mcp-webresearch
   pnpm install
   ```
4. 确保 Playwright Chromium 已正确安装：
   ```bash
   pnpm postinstall
   ```

## 二、基础开发调试

### 2.1 使用开发服务器进行热重载调试

项目提供了开发服务器支持实时重载，是日常开发的主要方式：

```bash
pnpm dev
```

此命令会使用 `tsx watch index.ts` 启动服务器，当您修改代码后，服务器会自动重启并应用更改，无需手动停止和启动。

### 2.2 使用控制台日志进行调试

在代码中添加 `console.log()` 语句是最基础的调试方法：

```javascript
// 在 index.ts 或其他需要调试的文件中添加
console.log('变量值:', variable);
console.log('执行到某一步骤');

// 更详细的对象打印
console.dir(object, { depth: null });
```

运行 `pnpm dev` 后，日志会显示在终端中，帮助您了解代码执行流程和变量状态。

### 2.3 查看 MCP 服务器日志

当通过 Claude Desktop 连接到 MCP 服务器时，可以查看 MCP 相关日志：

- Windows: 在 Claude Desktop 的界面中查看日志输出
- macOS/Linux: 通常位于应用程序日志目录中

这些日志包含了工具调用、请求处理和潜在错误的详细信息。

## 三、浏览器可视化调试

项目使用 Playwright 进行网页操作，默认以无头模式运行。您可以修改代码，以有界面模式运行浏览器，直观地观察浏览器操作：

### 3.1 修改浏览器启动模式

找到 `index.ts` 文件中的 `ensureBrowser` 函数，修改 Playwright 的启动配置：

```javascript
async function ensureBrowser() {
  if (!browser) {
    browser = await playwright.chromium.launch({
      headless: false, // 改为 false 以显示浏览器界面
      slowMo: 100, // 可选：放慢操作速度，便于观察
    });
  }
  return browser;
}
```

### 3.2 添加调试截图

您可以在关键操作点添加截图功能，记录浏览器状态：

```javascript
// 在网页操作后添加截图
await page.screenshot({
  path: `debug-screenshot-${Date.now()}.png`,
  fullPage: true
});
```

## 四、添加可视化调试界面

为了更方便地进行调试，您可以添加一个简单的可视化界面来监控 MCP 服务器的状态和请求：

### 4.1 安装必要的依赖

```bash
pnpm add express ejs
pnpm add -D @types/express @types/ejs
```

### 4.2 创建调试服务器文件

在项目根目录创建 `debug-server.ts`：

```typescript
import express from 'express';
import path from 'path';

const app = express();
const PORT = 3001;

// 存储最近的请求记录
const requestLogs: Array<{
  id: string;
  timestamp: string;
  method: string;
  path: string;
  body?: any;
  response?: any;
}> = [];

// 设置模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 调试界面路由
app.get('/', (req, res) => {
  res.render('index', {
    requestLogs: requestLogs.slice(-50), // 只显示最近50条记录
    serverStatus: 'running'
  });
});

// 接收日志的API
app.post('/log', (req, res) => {
  const logEntry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...req.body
  };
  requestLogs.push(logEntry);
  res.json({ success: true });
});

// 启动调试服务器
app.listen(PORT, () => {
  console.log(`调试界面已启动：http://localhost:${PORT}`);
});

// 导出日志记录函数，供主程序调用
export function logRequest(method: string, path: string, body?: any, response?: any) {
  const logEntry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    method,
    path,
    body,
    response
  };
  requestLogs.push(logEntry);
  // 保持日志量合理
  if (requestLogs.length > 100) {
    requestLogs.shift();
  }
}
```

### 4.3 创建视图模板

创建 `views` 目录和 `views/index.ejs` 文件：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Web Research 调试控制台</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .log-entry { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 4px; }
    .log-header { font-weight: bold; }
    .log-body { background: #f9f9f9; padding: 10px; margin-top: 5px; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>MCP Web Research 调试控制台</h1>
  <h2>服务器状态: <%= serverStatus %></h2>
  
  <h2>最近请求记录</h2>
  <div id="logs">
    <% requestLogs.forEach(log => { %>
      <div class="log-entry">
        <div class="log-header">
          <%= log.timestamp %> - <%= log.method %> <%= log.path %>
        </div>
        <% if (log.body) { %>
          <div class="log-body">请求: <%= JSON.stringify(log.body, null, 2) %></div>
        <% } %>
        <% if (log.response) { %>
          <div class="log-body">响应: <%= JSON.stringify(log.response, null, 2) %></div>
        <% } %>
      </div>
    <% }); %>
  </div>
</body>
</html>
```

### 4.4 集成到主程序

在 `index.ts` 中引入并使用调试服务器：

```typescript
// 在文件顶部添加
import { logRequest } from './debug-server';

// 在工具请求处理函数中添加日志记录
export const handleToolRequest: McpServerHandleToolRequest = async (req) => {
  try {
    // 记录请求
    logRequest('POST', '/tool', req);
    
    // 原有的工具处理逻辑
    // ...
    
    // 记录响应
    logRequest('POST', '/tool', req, result);
    
    return result;
  } catch (error) {
    // 记录错误
    logRequest('POST', '/tool', req, { error: error.message });
    throw error;
  }
};
```

### 4.5 修改启动脚本

在 `package.json` 中添加调试启动脚本：

```json
"scripts": {
  "dev-with-debug": "concurrently \"tsx watch index.ts\" \"tsx debug-server.ts\""
}
```

然后安装 `concurrently`：

```bash
pnpm add -D concurrently
```

现在可以使用以下命令同时启动主服务器和调试服务器：

```bash
pnpm dev-with-debug
```

打开浏览器访问 `http://localhost:3001` 即可查看调试界面。

## 五、大模型接入调试

### 5.1 配置 Claude Desktop 连接本地服务器

修改 Claude Desktop 的配置文件，添加本地 MCP 服务器配置：

- **Windows**: `%APPDATA%\Claude Desktop\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude Desktop/claude_desktop_config.json`
- **Linux**: `~/.config/Claude Desktop/claude_desktop_config.json`

配置文件示例：

```json
{
  "mcp": {
    "servers": [
      {
        "name": "web-research-local",
        "url": "http://localhost:3000",
        "api_key": "local-development-key",
        "enabled": true
      }
    ]
  }
}
```

### 5.2 使用预定义提示进行测试

在 Claude Desktop 中，使用 `agentic-research` 提示开始与本地 MCP 服务器交互：

```
agentic-research

我需要研究以下主题：[输入您的研究主题]
```

### 5.3 调试工具调用

在调试过程中，可以监控工具调用情况：

1. 通过终端查看 `pnpm dev` 输出的日志
2. 使用前面提到的可视化调试界面
3. 查看 Claude Desktop 中的 MCP 日志

## 六、问题排查

### 6.1 常见错误及解决方案

| 错误现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| 无法连接到 MCP 服务器 | 端口被占用或服务器未启动 | 检查服务器是否启动，尝试更改端口号 |
| Playwright 相关错误 | Chromium 未正确安装 | 执行 `pnpm postinstall` 重新安装 |
| 工具调用无响应 | 网络连接问题或浏览器启动失败 | 检查网络连接，确保防火墙未阻止连接 |
| TypeScript 编译错误 | 代码语法问题 | 执行 `pnpm build` 检查具体错误信息 |

### 6.2 高级调试技巧

1. **使用 Node.js 调试器**：
   ```bash
   pnpm add -D ts-node-dev
   npx ts-node-dev --inspect-brk index.ts
   ```
   然后使用 VS Code 的调试功能连接到 Node.js 调试器。

2. **调试 Playwright 脚本**：
   ```javascript
   // 在代码中添加调试器语句
   await page.pause(); // 暂停执行，等待手动操作
   ```

3. **环境变量配置**：
   创建 `.env` 文件来管理不同环境的配置：
   ```
   PORT=3000
   DEBUG=true
   HEADLESS=false
   ```

## 七、调试配置示例

以下是一个完整的调试配置示例，可根据需要调整：

```javascript
// 在 index.ts 中添加调试配置
const DEBUG_CONFIG = {
  enabled: process.env.DEBUG === 'true',
  headless: process.env.HEADLESS !== 'false',
  slowMo: process.env.DEBUG === 'true' ? 100 : 0,
  logLevel: process.env.LOG_LEVEL || 'info'
};

// 在 ensureBrowser 函数中使用
async function ensureBrowser() {
  if (!browser) {
    browser = await playwright.chromium.launch({
      headless: DEBUG_CONFIG.headless,
      slowMo: DEBUG_CONFIG.slowMo,
    });
  }
  return browser;
}

// 自定义日志函数
function debugLog(message, ...args) {
  if (DEBUG_CONFIG.enabled) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

// 在代码中使用
debugLog('当前执行步骤', { step: 'initialize', time: new Date() });
```

## 八、总结

有效的调试对于开发和维护 MCP Web Research 项目至关重要。本指南提供了从基础到高级的多种调试方法，包括：

1. **基础开发调试**：使用热重载、控制台日志和 MCP 服务器日志
2. **浏览器可视化调试**：通过修改浏览器启动模式直观观察操作
3. **添加可视化调试界面**：创建专门的调试控制台监控请求和响应
4. **大模型接入调试**：配置 Claude Desktop 连接本地服务器进行集成测试
5. **问题排查**：常见错误及解决方案

根据您的具体需求，选择适合的调试方法可以大大提高开发效率和问题解决能力。