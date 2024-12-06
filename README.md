# MCP Web Research Server

A Model Context Protocol (MCP) server for web research. 

This server provides AI models (for now, Claude via the Claude Desktop app) the ability to perform Google searches, visit web pages, and capture screenshots while maintaining a research session.

## Features

- Google search integration
- Webpage content extraction
- Research session tracking (list of visited pages, search queries, etc.)
- Screenshot capture

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 (includes `npm` and `npx`)
- [Claude Desktop app](https://claude.ai/download)

## Installation

First, ensure you've downloaded and installed the [Claude Desktop app](https://claude.ai/download) and you have npm installed.

Next, add this entry to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webresearch": {
      "command": "npx",
      "args": ["-y", "@mzxrai/mcp-webresearch"]
    }
  }
}
```

This config allows Claude Desktop to automatically start the web research MCP server when needed.

## Usage

Simply start a chat with Claude and send a prompt that would benefit from web research. If you'd like a prebuilt prompt customized for deeper web research, you can use the `agentic-research` prompt that we provide through this package. Access that prompt in Claude Desktop by clicking the Paperclip icon in the chat input and then selecting `Choose an integration` -> `webresearch` -> `agentic-research`.

<img src="https://i.ibb.co/N6Y3C0q/Screenshot-2024-12-05-at-11-01-27-PM.png" alt="Example screenshot of web research" width="400"/>

### Available Tools

1. `search_google`
   - Performs Google searches and extracts results
   - Arguments: `{ query: string }`

2. `visit_page`
   - Visits a webpage and extracts its content
   - Arguments: `{ url: string, takeScreenshot?: boolean }`

3. `take_screenshot`
   - Takes a screenshot of the current page
   - No arguments required

### Available Prompts

#### `agentic-research`
A guided research prompt that helps Claude conduct thorough web research. The prompt instructs Claude to:
- Start with broad searches to understand the topic landscape
- Prioritize high-quality, authoritative sources
- Iteratively refine the research direction based on findings
- Keep you informed and let you guide the research interactively
- Always cite sources with URLs

### Research Session Management

The server maintains a research session that includes:
- Search queries
- Visited pages
- Extracted content
- Screenshots
- Timestamps

You can access it via the Paperclip icon in Claude Desktop.

### Resources

When you take a screenshot, it's saved as an MCP resource. You can access captured screenshots in Claude Desktop via the Paperclip icon as well.

## Development

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Watch for changes
pnpm watch

# Run in development mode
pnpm dev
```

## Requirements

- Node.js >= 18
- Playwright (automatically installed as a dependency)

## License

MIT

## Author

[mzxrai](https://github.com/mzxrai) 