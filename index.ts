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
  Tool,
  Resource,
  McpError,
  ErrorCode,
  TextContent,
  ImageContent,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import TurndownService from "turndown";
import type { Node } from "turndown";
import sharp from 'sharp';

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
    name: "take_screenshot",
    description: "Take a screenshot of the current page",
    inputSchema: {
      type: "object",
      properties: {},  // No parameters needed
    },
  },
];

// Define prompt types
type PromptName = "agentic-research";

interface AgenticResearchArgs {
  topic: string;
}

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
      }
    ]
  }
} as const;

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
let currentSession: ResearchSession | undefined;

// Add at the top with other constants
const MAX_RESULTS_PER_SESSION = 100;
const MAX_CONTENT_LENGTH = 100000; // 100KB limit for content
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Add utility functions for retry logic and error handling
async function withRetry<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        console.error(`Attempt ${i + 1} failed, retrying in ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

// Enhanced error handling for navigation
async function safePageNavigation(page: Page, url: string): Promise<void> {
  try {
    // First try with just domcontentloaded - faster and more permissive
    const response = await page.goto(url, {
      waitUntil: ['domcontentloaded'],
      timeout: 15000 // Reduced timeout
    });

    if (!response) {
      console.warn('Navigation resulted in no response, but continuing anyway');
    } else {
      const status = response.status();
      if (status >= 400) {
        throw new Error(`HTTP ${status}: ${response.statusText()}`);
      }
    }

    // Wait for body with a short timeout
    try {
      await page.waitForSelector('body', { timeout: 3000 });
    } catch (error) {
      console.warn('Body selector timeout, but continuing anyway');
    }

    // Minimal delay to let the most critical elements load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check for bot protection pages and empty content
    const pageContent = await page.evaluate(() => {
      // Only check for actual bot protection elements/classes
      const botProtectionSelectors = [
        '#challenge-running',     // Cloudflare
        '#cf-challenge-running',  // Cloudflare
        '#px-captcha',            // PerimeterX
        '#ddos-protection',       // Various
        '#waf-challenge-html'     // Various WAFs
      ];

      // Check for actual bot protection elements
      const hasBotProtection = botProtectionSelectors.some(selector =>
        document.querySelector(selector) !== null
      );

      // Get meaningful text content (excluding scripts, styles, etc.)
      const meaningfulText = Array.from(document.body.getElementsByTagName('*'))
        .map(element => {
          if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE' || element.tagName === 'NOSCRIPT') {
            return '';
          }
          return element.textContent || '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        hasBotProtection,
        meaningfulText,
        title: document.title
      };
    });

    if (pageContent.hasBotProtection) {
      throw new Error('Bot protection detected (Cloudflare or similar service)');
    }

    // Check for empty or meaningless content
    if (!pageContent.meaningfulText || pageContent.meaningfulText.length < 1000) {
      throw new Error('Page appears to be empty or has no meaningful content');
    }

    // Additional check for suspicious titles that might indicate bot protection
    const suspiciousTitles = ['security check', 'ddos protection', 'please wait', 'just a moment', 'attention required'];
    if (suspiciousTitles.some(title => pageContent.title.toLowerCase().includes(title))) {
      throw new Error('Suspicious page title indicates possible bot protection');
    }

  } catch (error) {
    // If the error is a timeout, we'll still try to proceed
    if ((error as Error).message.includes('timeout')) {
      console.warn('Navigation timeout, but continuing with available content');
      return;
    }
    throw new Error(`Navigation failed: ${(error as Error).message}`);
  }
}

// Helper function to ensure browser is running
async function ensureBrowser() {
  try {
    // Check if browser is disconnected but page reference exists
    if ((!browser || browser.connected === false) && page) {
      // Clean up listeners before destroying page
      await page.removeAllListeners();
      page = undefined;
    }

    if (!browser || browser.connected === false) {
      // Clean up any existing browser instance
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          console.error('Error closing existing browser:', error);
        }
        browser = undefined;
      }

      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--hide-scrollbars',
          '--mute-audio'
        ]
      });

      // Set up error handling for browser
      browser.on('disconnected', async () => {
        console.error('Browser disconnected');
        if (page) {
          await page.removeAllListeners();
        }
        browser = undefined;
        page = undefined;
      });
    }

    // Ensure we have a valid page
    if (!page || page.isClosed()) {
      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

      // Set up error handling for page
      page.on('error', error => {
        console.error('Page error:', error);
        page = undefined;
      });

      // Request interception with safe handling
      await page.setRequestInterception(true);
      page.on('request', async request => {
        try {
          const resourceType = request.resourceType();
          const url = request.url();

          if (resourceType === 'media' || url.endsWith('.pdf')) {
            await request.abort();
          } else {
            // Only continue if request hasn't been handled
            if (!request.response() && !request.failure()) {
              await request.continue();
            }
          }
        } catch (error: unknown) {
          // Check if request is already handled
          const isAlreadyHandledError =
            error instanceof Error &&
            (error.message.includes('Request is already handled') ||
              error.message.includes('Request Interception is not enabled'));

          if (!isAlreadyHandledError) {
            console.error('Request interception error:', error);
          }

          // Only try to abort if it's not an "already handled" error
          if (!isAlreadyHandledError) {
            try {
              await request.abort();
            } catch (abortError) {
              if (!(abortError instanceof Error && abortError.message.includes('Request is already handled'))) {
                console.error('Failed to abort request:', abortError);
              }
            }
          }
        }
      });
    }

    return page;
  } catch (error) {
    // Clean up on initialization error
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser during error cleanup:', closeError);
      }
      browser = undefined;
    }
    page = undefined;

    console.error('Failed to initialize browser:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to initialize browser: ${(error as Error).message}`
    );
  }
}

// Modify addResult function
function addResult(result: ResearchResult) {
  if (!currentSession) {
    currentSession = {
      query: "Research Session",
      results: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // Trim content if it exceeds limit
  if (result.content && result.content.length > MAX_CONTENT_LENGTH) {
    result.content = result.content.substring(0, MAX_CONTENT_LENGTH) + '... (content truncated)';
  }

  // Remove oldest result if we hit the limit
  if (currentSession.results.length >= MAX_RESULTS_PER_SESSION) {
    const removedResult = currentSession.results.shift();
    // Clean up screenshot data
    if (removedResult?.screenshot) {
      removedResult.screenshot = undefined;
    }
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
    name: "webresearch",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  if (!currentSession) {
    return { resources: [] };
  }

  const resources: Resource[] = [
    {
      uri: "research://current/summary",
      name: "Current Research Session Summary",
      description: "Summary of the current research session including queries and results",
      mimeType: "application/json"
    },
    ...currentSession.results
      .filter(r => r.screenshot)
      .map((r, i) => ({
        uri: `research://screenshots/${i}`,
        name: `Screenshot of ${r.title}`,
        description: `Screenshot taken from ${r.url}`,
        mimeType: "image/png"
      }))
  ];

  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (!currentSession) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "No active research session"
    );
  }

  const uri = request.params.uri;

  if (uri === "research://current/summary") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          query: currentSession.query,
          resultCount: currentSession.results.length,
          lastUpdated: currentSession.lastUpdated,
          results: currentSession.results.map(r => ({
            title: r.title,
            url: r.url,
            timestamp: r.timestamp
          }))
        }, null, 2)
      }]
    };
  }

  if (uri.startsWith("research://screenshots/")) {
    const indexStr = uri.split("/").pop();
    if (!indexStr) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid screenshot URI format: ${uri}`
      );
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid screenshot index: ${indexStr}`
      );
    }

    if (index < 0 || index >= currentSession.results.length) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Screenshot index out of bounds: ${index}`
      );
    }

    const result = currentSession.results[index];
    if (!result?.screenshot) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `No screenshot available at index ${index}`
      );
    }

    return {
      contents: [{
        uri,
        mimeType: "image/png",
        blob: result.screenshot
      }]
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

// Update the type alias at the top of the file
type ToolResult = {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
};

// Add URL validation helper
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Update handler to use type alias
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
  const page = await ensureBrowser();

  switch (request.params.name) {
    case "search_google": {
      const { query } = request.params.arguments as { query: string };

      try {
        const results = await withRetry(async () => {
          await safePageNavigation(page, 'https://www.google.com');

          // Wait for and find search input with multiple strategies
          await withRetry(async () => {
            // Wait for any of the possible search input selectors
            await Promise.race([
              page.waitForSelector('input[name="q"]', { timeout: 5000 }),
              page.waitForSelector('textarea[name="q"]', { timeout: 5000 }),
              page.waitForSelector('input[type="text"]', { timeout: 5000 })
            ]).catch(() => {
              throw new Error('Search input not found - no matching selectors');
            });

            // Try different selector strategies
            const searchInput = await page.$('input[name="q"]') ||
              await page.$('textarea[name="q"]') ||
              await page.$('input[type="text"]');

            if (!searchInput) {
              throw new Error('Search input element not found after waiting');
            }

            // Clear any existing text and type the query
            await searchInput.click({ clickCount: 3 }); // Select all existing text
            await searchInput.press('Backspace'); // Clear the selection
            await searchInput.type(query);
          }, 3, 2000); // 3 retries, 2 second delay

          // Perform search with retry
          await withRetry(async () => {
            await Promise.all([
              page.keyboard.press('Enter'),
              page.waitForNavigation({
                waitUntil: ['load', 'networkidle0'],
                timeout: 30000
              })
            ]);
          });

          // Extract results with retry
          const searchResults = await withRetry(async () => {
            const results = await page.evaluate(() => {
              const elements = document.querySelectorAll('div.g');
              if (!elements || elements.length === 0) {
                throw new Error('No search results found');
              }

              return Array.from(elements).map((el) => {
                const titleEl = el.querySelector('h3');
                const linkEl = el.querySelector('a');
                const snippetEl = el.querySelector('div.VwiC3b');

                if (!titleEl || !linkEl || !snippetEl) {
                  return null;
                }

                return {
                  title: titleEl.textContent || '',
                  url: linkEl.getAttribute('href') || '',
                  snippet: snippetEl.textContent || '',
                };
              }).filter(result => result !== null);
            });

            if (!results || results.length === 0) {
              throw new Error('No valid search results found');
            }

            return results;
          });

          searchResults.forEach((result) => {
            addResult({
              url: result.url,
              title: result.title,
              content: result.snippet,
              timestamp: new Date().toISOString(),
            });
          });

          return searchResults;
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(results, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to perform search: ${(error as Error).message}`
          }],
          isError: true
        };
      }
    }

    case "visit_page": {
      const { url, takeScreenshot } = request.params.arguments as { url: string; takeScreenshot?: boolean };

      // Validate URL before proceeding
      if (!isValidUrl(url)) {
        return {
          content: [{
            type: "text",
            text: `Invalid URL: ${url}. Only http and https protocols are supported.`
          }],
          isError: true
        };
      }

      try {
        const result = await withRetry(async () => {
          await safePageNavigation(page, url);
          const title = await page.title();

          const content = await withRetry(async () => {
            const extractedContent = await extractContentAsMarkdown(page);
            if (!extractedContent) {
              throw new Error('Failed to extract content');
            }
            return extractedContent;
          });

          const pageResult: ResearchResult = {
            url,
            title,
            content,
            timestamp: new Date().toISOString(),
          };

          if (takeScreenshot) {
            const screenshot = await takeScreenshotWithSizeLimit(page);
            pageResult.screenshot = screenshot;

            // Notify that a new screenshot resource is available
            server.notification({
              method: "notifications/resources/list_changed"
            });
          }

          addResult(pageResult);
          return pageResult;
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...result,
              screenshot: result.screenshot ? "Screenshot taken and available as a resource" : undefined
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to visit page: ${(error as Error).message}`
          }],
          isError: true
        };
      }
    }

    case "take_screenshot": {
      try {
        const shot = await withRetry(async () => {
          return await takeScreenshotWithSizeLimit(page);
        });

        // Add screenshot to current session results
        if (!currentSession) {
          currentSession = {
            query: "Screenshot Session",
            results: [],
            lastUpdated: new Date().toISOString(),
          };
        }

        // Store the screenshot and add result
        const pageUrl = await page.url();
        const pageTitle = await page.title();
        addResult({
          url: pageUrl,
          title: pageTitle || "Untitled Page",
          content: "Screenshot taken",
          timestamp: new Date().toISOString(),
          screenshot: shot
        });

        // Notify that a new screenshot resource is available
        server.notification({
          method: "notifications/resources/list_changed"
        });

        return {
          content: [{
            type: "text",
            text: "Screenshot taken successfully. The screenshot is now available as a resource."
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to take screenshot: ${(error as Error).message}`
          }],
          isError: true
        };
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

    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "I am ready to help you with your research. I will conduct thorough web research, explore topics deeply, and maintain a dialogue with you throughout the process."
          }
        },
        {
          role: "user",
          content: {
            type: "text",
            text: `I'd like to research this topic: <topic>${topic}</topic>

Please help me explore it deeply, like you're a thoughtful, highly-trained research assistant.

General instructions:
1. Start by proposing your research approach -- namely, formulate what initial query you will use to search the web. Propose a relatively broad search to understand the topic landscape. At the same time, make your queries optimized for returning high-quality results based on what you know about constructing Google search queries.
2. Next, get my input on whether you should proceed with that query or if you should refine it.
3. Once you have an approved query, perform the search.
4. Prioritize high quality, authoritative sources when they are available and relevant to the topic. Avoid low quality or spammy sources.
5. Retrieve information that is relevant to the topic at hand.
6. Iteratively refine your research direction based on what you find.
7. Keep me informed of what you find and let *me* guide the direction of the research interactively.
8. If you run into a dead end while researching, do a Google search for the topic and attempt to find a URL for a relevant page. Then, explore that page in depth.
9. Only conclude when my research goals are met.
10. Always cite your sources, providing direct links when possible.

You can use these tools:
- search_google: Search for information
- visit_page: Visit and extract content from web pages

Do *NOT* use the following tools:
- Anything related to knowledge graphs or memory, unless explicitly instructed to do so by the user.`
          }
        }
      ]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, "Prompt implementation not found");
});

// Add cleanup timeout constant
const CLEANUP_TIMEOUT_MS = 5000;

// Helper function for cleanup with timeout
async function cleanupWithTimeout() {
  return Promise.race([
    (async () => {
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          console.error('Error closing browser:', error);
        }
        browser = undefined;
      }
      if (server) {
        await server.close();
      }
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cleanup timeout')), CLEANUP_TIMEOUT_MS)
    )
  ]).catch(error => {
    console.error('Cleanup failed:', error);
    // Force process exit after timeout
    process.exit(1);
  });
}

async function cleanupBrowser() {
  if (browser) {
    try {
      if (page) {
        await page.removeAllListeners();
        await page.close().catch(console.error);
      }
      await browser.close().catch(console.error);
    } catch (error) {
      console.error('Error during browser cleanup:', error);
    } finally {
      browser = undefined;
      page = undefined;
    }
  }
}

// Update process handlers with proper error handling
process.on('SIGINT', async () => {
  console.error('Shutting down...');
  await cleanupBrowser();
  await cleanupWithTimeout();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM signal...');
  try {
    await cleanupWithTimeout();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during SIGTERM cleanup:', error);
    process.exit(1);
  }
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  try {
    await cleanupWithTimeout();
    process.exit(1);
  } catch (cleanupError) {
    console.error('Fatal error during uncaught exception cleanup:', cleanupError);
    process.exit(1);
  }
});

// Start the server
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Add screenshot constraints
const MAX_SCREENSHOT_DIMENSION = 10000; // 10k pixels max dimension
const MIN_SCREENSHOT_DIMENSION = 100;    // 100 pixels min dimension

async function takeScreenshotWithSizeLimit(
  page: Page,
  maxSizeBytes: number = 500000
): Promise<string> {
  let sharpInstance: sharp.Sharp | undefined;
  try {
    // Get page dimensions first
    const dimensions = await page.evaluate(() => ({
      width: Math.min(document.documentElement.scrollWidth, MAX_SCREENSHOT_DIMENSION),
      height: Math.min(document.documentElement.scrollHeight, MAX_SCREENSHOT_DIMENSION)
    }));

    // Validate dimensions
    if (dimensions.width < MIN_SCREENSHOT_DIMENSION || dimensions.height < MIN_SCREENSHOT_DIMENSION) {
      throw new Error('Page dimensions too small for screenshot');
    }

    // Set viewport to capped dimensions
    await page.setViewport({
      width: dimensions.width,
      height: dimensions.height
    });

    // Take screenshot directly as base64
    const screenshot = await page.screenshot({
      type: 'png',
      encoding: 'base64',
      fullPage: true,
      clip: {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height
      }
    });

    if (typeof screenshot !== 'string') {
      throw new Error('Screenshot failed: Invalid encoding');
    }

    // Calculate approximate byte size (base64 is ~4/3 the size of binary)
    const approximateBytes = Math.ceil(screenshot.length * 0.75);
    console.error(`Original screenshot size: ~${approximateBytes} bytes`);

    // If already small enough, return it
    if (approximateBytes <= maxSizeBytes) {
      return screenshot;
    }

    // Convert base64 to buffer for resizing
    const buffer = Buffer.from(screenshot, 'base64');

    try {
      // Create Sharp instance
      sharpInstance = sharp(buffer);

      // Get original dimensions
      const metadata = await sharpInstance.metadata();
      const originalWidth = metadata.width || dimensions.width;
      const originalHeight = metadata.height || dimensions.height;
      console.error(`Original dimensions: ${originalWidth}x${originalHeight}`);

      // Calculate initial scale based on target size
      let scale = Math.sqrt(maxSizeBytes / approximateBytes) * 0.8;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        const newWidth = Math.max(MIN_SCREENSHOT_DIMENSION, Math.floor(originalWidth * scale));
        const newHeight = Math.max(MIN_SCREENSHOT_DIMENSION, Math.floor(originalHeight * scale));
        console.error(`Attempt ${attempts + 1}: Resizing to ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`);

        // Create new Sharp instance for each attempt
        const resizeInstance = sharp(buffer)
          .resize(newWidth, newHeight, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .png({
            compressionLevel: 9,
            quality: 40,
            effort: 10
          });

        const resized = await resizeInstance.toBuffer();
        console.error(`Resized image size: ${resized.length} bytes`);

        if (resized.length <= maxSizeBytes) {
          return resized.toString('base64');
        }

        scale *= 0.7;
        attempts++;
      }

      // Final attempt with most aggressive compression
      const finalInstance = sharp(buffer)
        .resize(
          Math.max(MIN_SCREENSHOT_DIMENSION, 640),
          Math.max(MIN_SCREENSHOT_DIMENSION, 480),
          {
            fit: 'inside',
            withoutEnlargement: true
          }
        )
        .png({
          compressionLevel: 9,
          quality: 20,
          effort: 10
        });

      const finalAttempt = await finalInstance.toBuffer();
      return finalAttempt.toString('base64');

    } finally {
      // Clean up Sharp instances
      if (sharpInstance) {
        await sharpInstance.destroy();
      }
    }

  } catch (error) {
    console.error('Screenshot error:', error);
    throw error;
  }
}
