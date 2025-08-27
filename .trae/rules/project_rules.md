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

---

# MCP Web Research 项目配置指南

本文档详细解释了项目的关键配置文件及其选项，帮助开发者理解和维护项目配置。

## package.json 配置说明

`package.json`是项目的核心配置文件，定义了项目信息、依赖关系和脚本命令等。

```json
{
  "name": "@mzxrai/mcp-webresearch",
  "version": "0.1.7",
  "description": "MCP server for web research",
  "license": "MIT",
  "author": "mzxrai",
  "homepage": "https://github.com/mzxrai/mcp-webresearch",
  "bugs": "https://github.com/mzxrai/mcp-webresearch/issues",
  "type": "module",
  "bin": {
    "mcp-server-webresearch": "dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc && shx chmod +x dist/*.js",
    "prepare": "pnpm run build",
    "postinstall": "playwright install chromium",
    "watch": "tsc --watch",
    "dev": "tsx watch index.ts"
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "web-research",
    "ai",
    "web-scraping"
  ],
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.0.1",
    "playwright": "^1.49.0",
    "turndown": "^7.1.2"
  },
  "devDependencies": {
    "shx": "^0.3.4",
    "tsx": "^4.19.2",
    "typescript": "^5.6.2",
    "@types/turndown": "^5.0.4"
  }
}
```

### 关键配置项说明

#### 基本信息
- `name`: 包名称，使用scoped package格式
- `version`: 项目版本号，遵循语义化版本规范
- `description`: 项目描述
- `license`: 许可证类型，使用MIT许可证
- `type`: 模块类型，设置为"module"表示使用ES模块系统

#### 可执行文件配置
- `bin`: 定义命令行可执行文件映射
  - `mcp-server-webresearch`: 命令名称，指向构建后的入口文件

#### 文件包含配置
- `files`: 指定发布时包含的文件和目录
  - `dist`: 只包含编译后的输出目录

#### 脚本命令配置
- `scripts`: 定义各种npm/pnpm脚本命令
  - `build`: 编译TypeScript代码并设置可执行权限
  - `prepare`: 准备发布，自动运行build脚本
  - `postinstall`: 安装依赖后自动安装Playwright Chromium浏览器
  - `watch`: 监视TypeScript文件变化并自动编译
  - `dev`: 在开发模式下运行项目，支持热重载

#### 发布配置
- `publishConfig`: 发布到npm的配置
  - `access`: 设置为"public"表示公开包

#### 依赖配置
- `dependencies`: 运行时依赖
  - `@modelcontextprotocol/sdk`: MCP协议SDK，提供服务器和协议处理功能
  - `playwright`: 浏览器自动化工具，用于网页抓取和截图
  - `turndown`: HTML到Markdown转换工具
- `devDependencies`: 开发依赖
  - `shx`: Shell命令跨平台封装
  - `tsx`: TypeScript执行工具，用于开发模式
  - `typescript`: TypeScript编译器
  - `@types/turndown`: Turndown类型定义

## tsconfig.json 配置说明

`tsconfig.json`是TypeScript编译器的配置文件，定义了编译选项、输出目录和目标版本等。

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,
    "skipLibCheck": true,
    "lib": [
      "ES2023",
      "DOM",
      "DOM.Iterable"
    ]
  },
  "include": [
    "*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

### 关键配置项说明

#### 编译选项
- `compilerOptions`: TypeScript编译器的主要配置项
  - `target`: 编译目标ECMAScript版本，设置为ES2023
  - `module`: 模块系统，设置为NodeNext以支持最新的Node.js模块功能
  - `moduleResolution`: 模块解析策略，与module保持一致
  - `esModuleInterop`: 启用ES模块互操作性，简化CommonJS模块导入
  - `strict`: 启用严格类型检查
  - `outDir`: 编译输出目录，设置为dist
  - `sourceMap`: 生成源码映射文件，便于调试
  - `declaration`: 生成类型声明文件(.d.ts)
  - `skipLibCheck`: 跳过第三方库的类型检查，提高编译速度
  - `lib`: 包含的标准库文件
    - `ES2023`: ES2023标准库
    - `DOM`: DOM API类型定义
    - `DOM.Iterable`: DOM可迭代对象类型定义

#### 文件包含与排除
- `include`: 指定要编译的文件
  - `*.ts`: 包含根目录下所有.ts文件
- `exclude`: 指定要排除的文件和目录
  - `node_modules`: 排除第三方依赖
  - `dist`: 排除编译输出目录

## 开发环境配置建议

### Node.js版本管理
推荐使用[nvm](https://github.com/nvm-sh/nvm)（Node Version Manager）来管理Node.js版本：

```bash
# 安装nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

# 安装并使用Node.js 18+
nvm install 18
nvm use 18
```

### 包管理器配置
推荐使用pnpm作为包管理器：

```bash
# 全局安装pnpm
npm install -g pnpm

# 配置pnpm存储路径（可选）
pnpm config set store-dir ~/.pnpm-store
```

### IDE配置
对于Visual Studio Code，推荐安装以下插件：
- TypeScript Extension Pack
- ESLint
- Prettier - Code formatter
- Playwright Test for VSCode

## Claude Desktop配置说明

为了使用MCP Web Research服务器，需要在Claude Desktop应用中进行如下配置：

### macOS配置
编辑文件：`~/Library/Application Support/Claude/claude_desktop_config.json`

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

### Windows配置
编辑文件：`%APPDATA%\Claude\claude_desktop_config.json`

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

### 配置项说明
- `mcpServers`: MCP服务器配置对象
  - `webresearch`: 服务器标识符
    - `command`: 启动命令，使用npx
    - `args`: 命令参数
      - `-y`: 自动确认安装
      - `@mzxrai/mcp-webresearch@latest`: 包名称和版本