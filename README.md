# MCP Web Research Server

## 项目简介
A Model Context Protocol (MCP) 服务器，专为网络研究设计。将实时信息引入 Claude AI，并轻松研究任何主题。

## 技术栈

### 核心技术
- **编程语言**: TypeScript
- **运行环境**: Node.js >= 18
- **包管理**: pnpm
- **构建工具**: TypeScript Compiler (tsc)

### 主要依赖
- **@modelcontextprotocol/sdk**: MCP 协议 SDK，版本 1.0.1
- **playwright**: 浏览器自动化工具，用于网页抓取和截图，版本 ^1.49.0
- **turndown**: HTML 到 Markdown 转换工具，版本 ^7.1.2

### 开发依赖
- **typescript**: TypeScript 编译器，版本 ^5.6.2
- **tsx**: TypeScript 执行工具，用于开发模式，版本 ^4.19.2
- **shx**: Shell 命令跨平台封装，版本 ^0.3.4
- **@types/turndown**: Turndown 类型定义

## 项目结构

```
├── .cursorrules         # Cursor IDE 配置
├── .gitignore           # Git 忽略规则
├── LICENSE              # MIT 许可证
├── README.md            # 项目文档
├── docs/                # 文档目录
│   └── mcp_spec/        # MCP 规范文档
│       └── llms-full.txt
├── index.ts             # 主入口文件
├── package.json         # 项目配置和依赖
├── pnpm-lock.yaml       # pnpm 依赖锁定文件
└── tsconfig.json        # TypeScript 配置
```

## 工作流程

### 服务器工作流程
1. 服务器通过 MCP 协议与 Claude Desktop 应用通信
2. 接收来自 Claude 的工具调用请求（搜索、访问页面、截图）
3. 使用 Playwright 执行相应的网络操作
4. 处理结果（提取内容、转换格式、保存截图）
5. 通过 MCP 协议返回结果给 Claude

### 工具功能流程

1. **search_google**
   - 接收搜索查询
   - 使用 Playwright 执行 Google 搜索
   - 提取搜索结果
   - 返回结构化的结果数据

2. **visit_page**
   - 接收 URL 和是否截图的参数
   - 使用 Playwright 访问指定 URL
   - 提取页面内容并转换为 Markdown
   - 如需要，捕获页面截图
   - 返回页面内容和截图路径（如适用）

3. **take_screenshot**
   - 捕获当前页面的截图
   - 保存截图到临时目录
   - 返回截图路径

## 关键配置文件

### package.json
项目配置文件，包含项目信息、依赖、脚本命令等。

### tsconfig.json
TypeScript 配置文件，定义编译选项、输出目录、目标版本等。

### .gitignore
Git 忽略规则文件，指定哪些文件和目录不纳入版本控制。

## 开发系统与环境配置要求

### 前置要求
- **操作系统**: Windows/macOS/Linux
- **Node.js**: 版本 >= 18
- **包管理器**: pnpm (推荐) 或 npm/yarn
- **Claude Desktop 应用**: 用于使用 MCP 服务器

### 环境配置
1. 安装 Node.js 和 pnpm
   ```bash
   # 安装 Node.js (根据官方文档)
   # 安装 pnpm
   npm install -g pnpm
   ```

2. 克隆项目并安装依赖
   ```bash
   git clone https://github.com/mzxrai/mcp-webresearch.git
   cd mcp-webresearch
   pnpm install
   ```

3. Claude Desktop 配置
   在 Claude Desktop 配置文件中添加 MCP 服务器配置：
   ```json
   {
     "mcpServers": {
       "webresearch": {
         "command": "npx",
         "args": ["-y", "@mzxrai/mcp-webresearch@latest"]
       }
     }
   }
   ```
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## 项目运行与开发命令

### 开发模式
```bash
# 启动开发服务器（带热重载）
pnpm dev

# 监视文件变化并自动编译
pnpm watch
```

### 构建与部署
```bash
# 编译项目
pnpm build

# 准备发布（自动运行构建）
pnpm prepare

# 安装后自动执行（安装 Playwright Chromium）
pnpm postinstall
```

### 测试与调试
```bash
# 在开发模式下运行
pnpm dev

# 查看 Claude Desktop MCP 日志
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log  # macOS
type %APPDATA%\Claude\logs\mcp*.log  # Windows
```

## 使用说明

### 基本使用
1. 确保 Claude Desktop 应用已安装并配置了 MCP 服务器
2. 启动 Claude Desktop 应用并开始对话
3. 发送需要网络研究的提示，或使用预定义的 `agentic-research` 提示

### 访问预定义提示
在 Claude Desktop 中：
1. 点击聊天输入框中的回形针图标
2. 选择 `Choose an integration`
3. 选择 `webresearch`
4. 选择 `agentic-research`

### 工具列表

1. **search_google**
   - 功能: 执行 Google 搜索并提取结果
   - 参数: `{ query: string }` - 搜索查询字符串

2. **visit_page**
   - 功能: 访问网页并提取内容
   - 参数: 
     - `url: string` - 要访问的网页 URL
     - `takeScreenshot?: boolean` - 是否捕获截图（可选）

3. **take_screenshot**
   - 功能: 捕获当前页面的截图
   - 参数: 无

## 资源管理

### 截图管理
- 截图保存在临时目录中（由操作系统管理）
- 作为 MCP 资源提供给 Claude Desktop
- 可通过 Claude Desktop 中的回形针图标访问

### 研究会话
服务器维护一个研究会话，包含：
- 搜索查询历史
- 访问过的页面
- 提取的内容
- 截图
- 时间戳

## 开发建议

1. 使用 TypeScript 严格模式确保类型安全
2. 遵循项目现有的代码风格和命名约定
3. 使用 Playwright 提供的 API 进行浏览器操作
4. 利用 Turndown 服务进行 HTML 到 Markdown 的转换
5. 注意处理可能的错误和边界情况

## 问题排查

- 查看 Claude Desktop 的 MCP 日志获取详细错误信息
- 确保 Node.js 版本符合要求
- 确认 Playwright Chromium 已正确安装
- 检查网络连接和防火墙设置
