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
type ResearchDepth = "basic" | "moderate" | "thorough";

interface AgenticResearchArgs {
  topic: string;
  depth?: ResearchDepth;
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
  if (!browser) {
    try {
      browser = await puppeteer.launch({
        headless: true,  // Run in headless mode
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

      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

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

      // More permissive request interception - only block potentially problematic resources
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (
          // Only block media and other heavy resources that might cause issues
          request.resourceType() === 'media' ||
          request.url().endsWith('.pdf')
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
    currentSession.results.shift();
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
    const index = parseInt(uri.split("/").pop() || "", 10);
    const result = currentSession.results[index];

    if (!result?.screenshot) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Screenshot not found: ${uri}`
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

// Add cleanup handlers
process.on('SIGINT', async () => {
  console.error('Shutting down...');
  if (browser) {
    await browser.close();
  }
  await server.close();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  if (browser) {
    await browser.close();
  }
  await server.close();
  process.exit(1);
});

// Start the server
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

async function takeScreenshotWithSizeLimit(
  page: Page,
  maxSizeBytes: number = 500000
): Promise<string> {
  try {
    // Take screenshot directly as base64
    const screenshot = await page.screenshot({
      type: 'png',
      encoding: 'base64',
      fullPage: true
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

    // Convert base64 back to buffer for resizing
    const buffer = Buffer.from(screenshot, 'base64');

    // Get original dimensions
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 1920;
    const originalHeight = metadata.height || 1080;
    console.error(`Original dimensions: ${originalWidth}x${originalHeight}`);

    // Calculate initial scale based on target size
    let scale = Math.sqrt(maxSizeBytes / approximateBytes) * 0.8;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const newWidth = Math.floor(originalWidth * scale);
      const newHeight = Math.floor(originalHeight * scale);
      console.error(`Attempt ${attempts + 1}: Resizing to ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`);

      const resized = await sharp(buffer)
        .resize(newWidth, newHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png({
          compressionLevel: 9,
          quality: 40,
          effort: 10
        })
        .toBuffer();

      console.error(`Resized image size: ${resized.length} bytes`);

      if (resized.length <= maxSizeBytes) {
        return resized.toString('base64');
      }

      scale *= 0.7;
      attempts++;
    }

    // Final attempt with most aggressive compression
    const finalAttempt = await sharp(buffer)
      .resize(640, 480, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({
        compressionLevel: 9,
        quality: 20,
        effort: 10
      })
      .toBuffer();

    return finalAttempt.toString('base64');

  } catch (error) {
    console.error('Screenshot error:', error);
    throw error;
  }
}
