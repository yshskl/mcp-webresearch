# Web Research MCP Server

An MCP server that enables LLM clients to perform web research using Puppeteer. This server provides tools for searching Google, visiting web pages, extracting content, and taking screenshots.

## Installation

```bash
npx @modelcontextprotocol/server-webresearch
```

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webresearch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-webresearch"]
    }
  }
}
```

## Features

### Tools

1. **search_google**
   - Search Google and extract search results
   - Arguments: `query` (string)

2. **visit_page**
   - Visit a webpage and extract its content
   - Arguments: 
     - `url` (string)
     - `takeScreenshot` (boolean, optional)

3. **extract_content**
   - Extract specific content from the current page
   - Arguments: `selector` (string, CSS selector)

4. **take_screenshot**
   - Take a screenshot of the current page or element
   - Arguments: `selector` (string, optional CSS selector)

### Resources

The server maintains a research session that stores:
- Search queries
- Visited pages
- Extracted content
- Screenshots
- Timestamps

Access the current research session via the `research://` URI scheme.

## Example Usage

Here are some example prompts you can use with Claude Desktop:

1. Basic research:
   ```
   Can you research the latest developments in quantum computing?
   ```

2. Focused research:
   ```
   I need to learn about TypeScript decorators. Can you find and summarize some good documentation?
   ```

3. Visual research:
   ```
   Can you show me what the React.js homepage looks like and extract its main features?
   ```

## Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build:
   ```bash
   npm run build
   ```
4. Watch mode for development:
   ```bash
   npm run watch
   ```

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 