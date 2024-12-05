#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
  Resource,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import TurndownService from "turndown";
import type { Node } from "turndown";

// Initialize turndown with custom options
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

// Add additional rules for better content extraction
turndownService.addRule('removeScripts', {
  filter: ['script', 'style', 'noscript'],
  replacement: () => ''
});

turndownService.addRule('preserveLinks', {
  filter: 'a',
  replacement: (content: string, node: Node) => {
    const element = node as HTMLAnchorElement;
    const href = element.getAttribute('href');
    return href ? `[${content}](${href})` : content;
  }
});

turndownService.addRule('preserveImages', {
  filter: 'img',
  replacement: (content: string, node: Node) => {
    const element = node as HTMLImageElement;
    const alt = element.getAttribute('alt') || '';
    const src = element.getAttribute('src');
    return src ? `![${alt}](${src})` : '';
  }
});

// Types for our research session
interface ResearchResult {
  url: string;
  title: string;
  content: string;
  timestamp: string;
  screenshot?: string;
}

interface ResearchSession {
  query: string;
  results: ResearchResult[];
  lastUpdated: string;
}

// Define tools
const TOOLS: Tool[] = [
  {
    name: "search_google",
    description: "Search Google for a query",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "visit_page",
    description: "Visit a webpage and extract its content",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to visit" },
        takeScreenshot: { type: "boolean", description: "Whether to take a screenshot" },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_content",
    description: "Extract specific content from the current page using CSS selectors",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to extract content from" },
      },
      required: ["selector"],
    },
  },
  {
    name: "take_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to screenshot" },
      },
    },
  },
];

// Define prompt types
type PromptName = "agentic-research";
type ResearchDepth = "basic" | "moderate" | "thorough";

interface AgenticResearchArgs {
  topic: string;
  depth?: ResearchDepth;
}

type PromptArgs = {
  "agentic-research": AgenticResearchArgs;
};

// Define prompts with proper typing
const PROMPTS = {
  "agentic-research": {
    name: "agentic-research" as const,
    description: "Conduct iterative web research on a topic, exploring it thoroughly through multiple steps while maintaining a dialogue with the user",
    arguments: [
      {
        name: "topic",
        description: "The topic or question to research",
        required: true
      },
      {
        name: "depth",
        description: "Desired depth of research (basic, moderate, thorough)",
        required: false
      }
    ]
  }
} as const;

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
let currentSession: ResearchSession | undefined;

// Helper function to ensure browser is running
async function ensureBrowser() {
  if (!browser) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });

      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

      // Set up error handling
      browser.on('disconnected', () => {
        browser = undefined;
        page = undefined;
      });

      page.on('error', error => {
        console.error('Page error:', error);
      });

      // Add request interception for better performance
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (
          request.resourceType() === 'image' ||
          request.resourceType() === 'font' ||
          request.resourceType() === 'media'
        ) {
          request.abort();
        } else {
          request.continue();
        }
      });
    } catch (error) {
      console.error('Failed to launch browser:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to launch browser: ${(error as Error).message}`
      );
    }
  }
  return page!;
}

// Helper function to add a result to the current session
function addResult(result: ResearchResult) {
  if (!currentSession) {
    currentSession = {
      query: "Research Session",
      results: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  currentSession.results.push(result);
  currentSession.lastUpdated = new Date().toISOString();

  // Notify clients that resources have changed
  server.notification({
    method: "notifications/resources/list_changed",
  });
}

// Create server instance
const server = new Server(
  {
    name: "web-research-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Resource[] = [];

  if (currentSession) {
    resources.push({
      uri: `research://${encodeURIComponent(currentSession.query)}`,
      name: `Research: ${currentSession.query}`,
      description: `Research session with ${currentSession.results.length} results`,
      mimeType: "application/json",
    });
  }

  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri.startsWith("research://") && currentSession) {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(currentSession, null, 2),
      }],
    };
  }

  throw new McpError(
    ErrorCode.InvalidRequest,
    `Unknown resource: ${uri}`
  );
});

// Helper function to extract and convert content to markdown
async function extractContentAsMarkdown(page: Page, selector?: string): Promise<string> {
  const html = await page.evaluate((sel) => {
    if (sel) {
      const element = document.querySelector(sel);
      return element ? element.outerHTML : '';
    }

    // Try to find main content area if no selector provided
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '#content',
      '.content',
      '.main',
      '.post',
      '.article',
    ];

    for (const contentSelector of contentSelectors) {
      const element = document.querySelector(contentSelector);
      if (element) {
        return element.outerHTML;
      }
    }

    // If no content area found, try to extract meaningful content
    const body = document.body;

    // Remove unwanted elements
    const elementsToRemove = [
      'header',
      'footer',
      'nav',
      'aside',
      '.sidebar',
      '.nav',
      '.menu',
      '.footer',
      '.header',
      '.advertisement',
      '.ads',
      '.cookie-notice',
      '[role="complementary"]',
      '[role="navigation"]',
    ];

    elementsToRemove.forEach(sel => {
      body.querySelectorAll(sel).forEach(el => el.remove());
    });

    return body.outerHTML;
  }, selector);

  // Convert HTML to Markdown
  if (!html) {
    return '';
  }

  try {
    const markdown = turndownService.turndown(html);

    // Clean up the markdown
    return markdown
      // Remove excessive newlines
      .replace(/\n{3,}/g, '\n\n')
      // Remove empty list items
      .replace(/^- $/gm, '')
      // Remove lines that are just whitespace
      .replace(/^\s+$/gm, '')
      // Trim whitespace
      .trim();
  } catch (error) {
    console.error('Error converting HTML to Markdown:', error);
    return html;
  }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const page = await ensureBrowser();

  switch (request.params.name) {
    case "search_google": {
      const { query } = request.params.arguments as { query: string };

      // Update current session
      currentSession = {
        query,
        results: [],
        lastUpdated: new Date().toISOString(),
      };

      try {
        // Navigate to Google and perform search
        await page.goto('https://www.google.com', { waitUntil: 'networkidle0' });
        await page.waitForSelector('input[name="q"]', { timeout: 5000 });
        await page.type('input[name="q"]', query);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          page.keyboard.press('Enter'),
        ]);

        // Extract search results
        const searchResults = await page.evaluate(() => {
          const results: { title: string; url: string; snippet: string; }[] = [];
          const elements = document.querySelectorAll('div.g');

          elements.forEach((el) => {
            const titleEl = el.querySelector('h3');
            const linkEl = el.querySelector('a');
            const snippetEl = el.querySelector('div.VwiC3b');

            if (titleEl && linkEl && snippetEl) {
              results.push({
                title: titleEl.textContent || '',
                url: linkEl.getAttribute('href') || '',
                snippet: snippetEl.textContent || '',
              });
            }
          });

          return results;
        });

        // Add results to session
        searchResults.forEach((result) => {
          addResult({
            url: result.url,
            title: result.title,
            content: result.snippet,
            timestamp: new Date().toISOString(),
          });
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(searchResults, null, 2),
          }],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to perform search: ${(error as Error).message}`
        );
      }
    }

    case "visit_page": {
      const { url, takeScreenshot } = request.params.arguments as { url: string; takeScreenshot?: boolean };

      try {
        await page.goto(url, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });
        const title = await page.title();

        // Extract content as markdown
        const content = await extractContentAsMarkdown(page);

        const result: ResearchResult = {
          url,
          title,
          content,
          timestamp: new Date().toISOString(),
        };

        if (takeScreenshot) {
          const screenshot = await page.screenshot({
            encoding: 'base64',
            fullPage: false,
            type: 'png',
            quality: 80
          });
          result.screenshot = screenshot as string;
        }

        addResult(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
            ...(takeScreenshot ? [{
              type: "image",
              data: result.screenshot,
              mimeType: "image/png",
            } as ImageContent] : []),
          ],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to visit page: ${(error as Error).message}`
        );
      }
    }

    case "extract_content": {
      const { selector } = request.params.arguments as { selector: string };

      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const content = await extractContentAsMarkdown(page, selector);

        const result: ResearchResult = {
          url: page.url(),
          title: await page.title(),
          content,
          timestamp: new Date().toISOString(),
        };

        addResult(result);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to extract content: ${(error as Error).message}`
        );
      }
    }

    case "take_screenshot": {
      const { selector } = request.params.arguments as { selector?: string };

      try {
        const screenshot = await (selector ?
          (await page.$(selector))?.screenshot({
            encoding: 'base64',
            type: 'png',
            quality: 80
          }) :
          page.screenshot({
            encoding: 'base64',
            fullPage: false,
            type: 'png',
            quality: 80
          }));

        if (!screenshot) {
          throw new Error(selector ? `Element not found: ${selector}` : 'Screenshot failed');
        }

        const result: ResearchResult = {
          url: page.url(),
          title: await page.title(),
          content: selector ? `Screenshot of element: ${selector}` : 'Full page screenshot',
          timestamp: new Date().toISOString(),
          screenshot: screenshot as string,
        };

        addResult(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
            {
              type: "image",
              data: screenshot,
              mimeType: "image/png",
            } as ImageContent,
          ],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to take screenshot: ${(error as Error).message}`
        );
      }
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

// Add prompt handlers
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: Object.values(PROMPTS) };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name as PromptName;
  const prompt = PROMPTS[promptName];
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${promptName}`);
  }

  if (promptName === "agentic-research") {
    const args = request.params.arguments as AgenticResearchArgs | undefined;
    const topic = args?.topic || "";
    const depth = args?.depth || "moderate";

    return {
      messages: [
        {
          role: "system",
          content: {
            type: "text",
            text: `You are a thorough research assistant conducting web research. Your goal is to explore topics deeply and iteratively, maintaining a dialogue with the user throughout the process. Follow these principles:

1. Start with broad searches to understand the topic landscape
2. Progressively narrow down to specific aspects
3. Verify information across multiple sources
4. Keep the user informed of your progress and findings
5. Ask for clarification or guidance when needed
6. Only conclude the research when the user confirms their goals are met

Available tools:
- search_google: Search for information
- visit_page: Visit and extract content from web pages
- extract_content: Extract specific content from pages
- take_screenshot: Capture visual information

Remember to:
- Explain your research strategy
- Share interesting findings as you discover them
- Suggest areas for deeper exploration
- Ask the user for feedback and preferences
- Adapt your approach based on user responses`
          }
        },
        {
          role: "user",
          content: {
            type: "text",
            text: `I'd like to research this topic: ${topic}

Please help me explore it ${depth === "thorough" ? "very thoroughly" : depth === "basic" ? "at a basic level" : "with moderate depth"}.

Start by explaining your research approach, then begin with initial searches. Keep me informed of what you find and let me guide the direction of the research.`
          }
        }
      ]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, "Prompt implementation not found");
});

// Main function to start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', async () => {
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  });
}

main().catch(console.error);
