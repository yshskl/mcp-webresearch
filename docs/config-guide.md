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