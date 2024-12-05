#!/usr/bin/env node

// Core dependencies for MCP server and protocol handling
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

// Web scraping and content processing dependencies
import puppeteer, { Browser, Page } from "puppeteer";
import TurndownService from "turndown";
import type { Node } from "turndown";
import sharp from 'sharp';

// Initialize Turndown service for converting HTML to Markdown
// Configure with specific formatting preferences
const turndownService: TurndownService = new TurndownService({
    headingStyle: 'atx',          // Use # style headings
    hr: '---',                    // Horizontal rule style
    bulletListMarker: '-',        // List item marker
    codeBlockStyle: 'fenced',     // Use ``` for code blocks
    emDelimiter: '_',             // Italics style
    strongDelimiter: '**',        // Bold style
    linkStyle: 'inlined',         // Use inline links
});

// Custom Turndown rules for better content extraction
// Remove script and style tags completely
turndownService.addRule('removeScripts', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => ''
});

// Preserve link elements with their href attributes
turndownService.addRule('preserveLinks', {
    filter: 'a',
    replacement: (content: string, node: Node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        return href ? `[${content}](${href})` : content;
    }
});

// Preserve image elements with their src and alt attributes
turndownService.addRule('preserveImages', {
    filter: 'img',
    replacement: (content: string, node: Node) => {
        const element = node as HTMLImageElement;
        const alt = element.getAttribute('alt') || '';
        const src = element.getAttribute('src');
        return src ? `![${alt}](${src})` : '';
    }
});

// Core interfaces for research data management
interface ResearchResult {
    url: string;              // URL of the researched page
    title: string;           // Page title
    content: string;         // Extracted content in markdown
    timestamp: string;       // When the result was captured
    screenshot?: string;     // Optional base64 encoded screenshot
}

// Define structure for research session data
interface ResearchSession {
    query: string;           // Search query that initiated the session
    results: ResearchResult[];  // Collection of research results
    lastUpdated: string;     // Timestamp of last update
}

// Available tools for web research functionality
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

// Define available prompt types for type safety
type PromptName = "agentic-research";

// Define structure for research prompt arguments
interface AgenticResearchArgs {
    topic: string;  // Research topic provided by user
}

// Configure available prompts with their specifications
const PROMPTS = {
    // Agentic research prompt configuration
    "agentic-research": {
        name: "agentic-research" as const,  // Type-safe name
        description: "Conduct iterative web research on a topic, exploring it thoroughly through multiple steps while maintaining a dialogue with the user",
        arguments: [
            {
                name: "topic",                                     // Topic argument specification
                description: "The topic or question to research",  // Description of the argument
                required: true                                     // Topic is mandatory
            }
        ]
    }
} as const;  // Make object immutable

// Global state management for browser and research session
let browser: Browser | undefined;                 // Puppeteer browser instance
let page: Page | undefined;                       // Current active page
let currentSession: ResearchSession | undefined;  // Current research session data

// Configuration constants for session management
const MAX_RESULTS_PER_SESSION = 100;  // Maximum number of results to store per session
const MAX_CONTENT_LENGTH = 100000;    // Maximum content length (100KB) per result
const MAX_RETRIES = 3;                // Maximum retry attempts for operations
const RETRY_DELAY = 1000;             // Delay between retries in milliseconds

// Screenshot dimension constraints to ensure reasonable image sizes
const MAX_SCREENSHOT_DIMENSION = 10000;  // Maximum allowed width/height in pixels
const MIN_SCREENSHOT_DIMENSION = 100;    // Minimum allowed width/height in pixels

// Generic retry mechanism for handling transient failures
async function withRetry<T>(
    operation: () => Promise<T>,  // Operation to retry
    retries = MAX_RETRIES,        // Number of retry attempts
    delay = RETRY_DELAY           // Delay between retries
): Promise<T> {
    let lastError: Error;

    // Attempt operation up to max retries
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

    throw lastError!;  // Throw last error if all retries failed
}

// Add a new research result to the current session with data management
function addResult(result: ResearchResult): void {
    // Initialize new session if none exists
    if (!currentSession) {
        currentSession = {
            query: "Research Session",
            results: [],
            lastUpdated: new Date().toISOString(),
        };
    }

    // Enforce content size limits to prevent memory issues
    if (result.content && result.content.length > MAX_CONTENT_LENGTH) {
        result.content = result.content.substring(0, MAX_CONTENT_LENGTH) + '... (content truncated)';
    }

    // Implement FIFO queue for results management
    if (currentSession.results.length >= MAX_RESULTS_PER_SESSION) {
        const removedResult = currentSession.results.shift();
        // Clean up associated screenshot data if present
        if (removedResult?.screenshot) {
            // Remove screenshot data from memory
            if (removedResult.screenshot) {
                delete removedResult.screenshot;
                // Notify clients that resource list has changed
                server.notification({
                    method: "notifications/resources/list_changed"
                });
            }
        }
    }

    // Add new result and update session timestamp
    currentSession.results.push(result);
    currentSession.lastUpdated = new Date().toISOString();
}

// Safe page navigation with error handling and bot detection
async function safePageNavigation(page: Page, url: string): Promise<void> {
    try {
        // Initial navigation with minimal wait conditions
        const response = await page.goto(url, {
            waitUntil: ['domcontentloaded'],
            timeout: 15000 // 15s timeout
        });

        // Log warning if navigation resulted in no response
        if (!response) {
            console.warn('Navigation resulted in no response, but continuing anyway');
        } else {
            // Log error if HTTP status code indicates failure
            const status = response.status();
            if (status >= 400) {
                throw new Error(`HTTP ${status}: ${response.statusText()}`);
            }
        }

        // Wait for basic page structure
        try {
            await page.waitForSelector('body', { timeout: 3000 });
        } catch (error) {
            console.warn('Body selector timeout, but continuing anyway');
        }

        // Brief pause for dynamic content
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check for bot protection and page content
        const pageContent = await page.evaluate(() => {
            // Common bot protection selectors
            const botProtectionSelectors = [
                '#challenge-running',     // Cloudflare
                '#cf-challenge-running',  // Cloudflare
                '#px-captcha',            // PerimeterX
                '#ddos-protection',       // Various
                '#waf-challenge-html'     // Various WAFs
            ];

            // Check for bot protection elements
            const hasBotProtection = botProtectionSelectors.some(selector =>
                document.querySelector(selector) !== null
            );

            // Extract meaningful text content
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

        // Handle bot protection detection
        if (pageContent.hasBotProtection) {
            throw new Error('Bot protection detected (Cloudflare or similar service)');
        }

        // Validate content quality
        if (!pageContent.meaningfulText || pageContent.meaningfulText.length < 1000) {
            throw new Error('Page appears to be empty or has no meaningful content');
        }

        // Check for suspicious titles indicating bot protection
        const suspiciousTitles = ['security check', 'ddos protection', 'please wait', 'just a moment', 'attention required'];
        if (suspiciousTitles.some(title => pageContent.title.toLowerCase().includes(title))) {
            throw new Error('Suspicious page title indicates possible bot protection');
        }

    } catch (error) {
        // Handle navigation timeouts gracefully
        if ((error as Error).message.includes('timeout')) {
            console.warn('Navigation timeout, but continuing with available content');
            return;
        }
        throw new Error(`Navigation failed: ${(error as Error).message}`);
    }
}

// Take and optimize a screenshot with size constraints
async function takeScreenshotWithSizeLimit(
    page: Page,                    // Puppeteer page to screenshot
    maxSizeBytes: number = 500000  // Maximum file size (500KB default)
): Promise<string> {
    // Track Sharp instance for proper cleanup
    let sharpInstance: sharp.Sharp | undefined;

    try {
        // Step 1: Get page dimensions while respecting maximum limits
        const dimensions = await page.evaluate((maxDimension) => ({
            width: Math.min(document.documentElement.scrollWidth, maxDimension),
            height: Math.min(document.documentElement.scrollHeight, maxDimension)
        }), MAX_SCREENSHOT_DIMENSION);

        // Step 2: Validate minimum dimensions
        if (dimensions.width < MIN_SCREENSHOT_DIMENSION || dimensions.height < MIN_SCREENSHOT_DIMENSION) {
            throw new Error('Page dimensions too small for screenshot');
        }

        // Step 3: Configure viewport to match content dimensions
        await page.setViewport({
            width: dimensions.width,
            height: dimensions.height
        });

        // Step 4: Take full page screenshot
        const screenshot = await page.screenshot({
            type: 'png',         // Use PNG for better quality
            encoding: 'base64',  // Get result as base64 string
            fullPage: true       // Capture entire page
        });

        // Step 5: Validate screenshot data
        if (typeof screenshot !== 'string') {
            throw new Error('Screenshot failed: Invalid encoding');
        }

        // Step 6: Check if size is already within limits
        const approximateBytes = Math.ceil(screenshot.length * 0.75);  // base64 to binary ratio
        console.error(`Original screenshot size: ~${approximateBytes} bytes`);

        // Return as-is if size is acceptable
        if (approximateBytes <= maxSizeBytes) {
            return screenshot;
        }

        // Step 7: Process oversized screenshot
        const buffer = Buffer.from(screenshot, 'base64');

        try {
            // Initialize Sharp for image processing
            sharpInstance = sharp(buffer);

            // Get actual image dimensions
            const metadata = await sharpInstance.metadata();
            const originalWidth = metadata.width || dimensions.width;
            const originalHeight = metadata.height || dimensions.height;
            console.error(`Original dimensions: ${originalWidth}x${originalHeight}`);

            // Step 8: Progressive image resizing
            let scale = Math.sqrt(maxSizeBytes / approximateBytes) * 0.8;  // Initial scale with 20% margin
            let attempts = 0;
            const maxAttempts = 5;  // Limit resize attempts

            // Try different scales until size requirement is met
            while (attempts < maxAttempts) {
                // Calculate new dimensions while maintaining aspect ratio
                const newWidth = Math.max(MIN_SCREENSHOT_DIMENSION, Math.floor(originalWidth * scale));
                const newHeight = Math.max(MIN_SCREENSHOT_DIMENSION, Math.floor(originalHeight * scale));
                console.error(`Attempt ${attempts + 1}: Resizing to ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`);

                // Create new Sharp instance for this attempt
                const resizeInstance = sharp(buffer)
                    .resize(newWidth, newHeight, {
                        fit: 'inside',             // Maintain aspect ratio
                        withoutEnlargement: true   // Prevent upscaling
                    })
                    .png({
                        compressionLevel: 9,  // Maximum PNG compression
                        quality: 40,          // Reduced quality
                        effort: 10            // Maximum compression effort
                    });

                // Process image and check size
                const resized = await resizeInstance.toBuffer();
                console.error(`Resized image size: ${resized.length} bytes`);

                // Return if size requirement met
                if (resized.length <= maxSizeBytes) {
                    return resized.toString('base64');
                }

                scale *= 0.7;  // Reduce scale by 30% for next attempt
                attempts++;
            }

            // Step 9: Final fallback to minimum size
            const finalInstance = sharp(buffer)
                .resize(
                    Math.max(MIN_SCREENSHOT_DIMENSION, 640),  // Minimum width with 640px floor
                    Math.max(MIN_SCREENSHOT_DIMENSION, 480),  // Minimum height with 480px floor
                    {
                        fit: 'inside',
                        withoutEnlargement: true
                    }
                )
                .png({
                    compressionLevel: 9,  // Maximum compression
                    quality: 20,          // Lowest acceptable quality
                    effort: 10            // Maximum compression effort
                });

            // Return final attempt result regardless of size
            const finalAttempt = await finalInstance.toBuffer();
            return finalAttempt.toString('base64');

        } finally {
            // Step 10: Clean up Sharp instance
            if (sharpInstance) {
                await sharpInstance.destroy();
            }
        }

    } catch (error) {
        // Log and rethrow any errors
        console.error('Screenshot error:', error);
        throw error;
    }
}

// Initialize MCP server with basic configuration
const server: Server = new Server(
    {
        name: "webresearch",  // Server name identifier
        version: "0.1.0",     // Server version number
    },
    {
        capabilities: {
            tools: {},      // Available tool configurations
            resources: {},  // Resource handling capabilities
            prompts: {}     // Prompt processing capabilities
        },
    }
);

// Register handler for tool listing requests
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS  // Return list of available research tools
}));

// Register handler for resource listing requests
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Return empty list if no active session
    if (!currentSession) {
        return { resources: [] };
    }

    // Compile list of available resources
    const resources: Resource[] = [
        // Add session summary resource
        {
            uri: "research://current/summary",  // Resource identifier
            name: "Current Research Session Summary",
            description: "Summary of the current research session including queries and results",
            mimeType: "application/json"
        },
        // Add screenshot resources if available
        ...currentSession.results
            .filter(r => r.screenshot)               // Only include results with screenshots
            .map((r, i) => ({
                uri: `research://screenshots/${i}`,  // Unique URI for each screenshot
                name: `Screenshot of ${r.title}`,
                description: `Screenshot taken from ${r.url}`,
                mimeType: "image/png"
            }))
    ];

    return { resources };
});

// Register handler for resource content requests
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri.toString();

    // Handle session summary requests for research data
    if (uri === "research://current/summary") {
        if (!currentSession) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                "No active research session"
            );
        }

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

    // Handle screenshot requests
    if (uri.startsWith("research://screenshots/")) {
        const index = parseInt(uri.split("/").pop() || "", 10);

        // Verify session exists
        if (!currentSession) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                "No active research session"
            );
        }

        // Verify index is within bounds
        if (isNaN(index) || index < 0 || index >= currentSession.results.length) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                `Screenshot index out of bounds: ${index}`
            );
        }

        // Get result containing screenshot
        const result = currentSession.results[index];
        if (!result?.screenshot) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                `No screenshot available at index: ${index}`
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

    // Handle unknown resource types
    throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource: ${uri}`
    );
});

// Initialize server connection using stdio transport
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
    // Log initialization errors and exit
    console.error("Failed to start server:", error);
    process.exit(1);
});

// Convert HTML content to clean, readable markdown format
async function extractContentAsMarkdown(
    page: Page,        // Puppeteer page to extract from
    selector?: string  // Optional CSS selector to target specific content
): Promise<string> {
    // Step 1: Execute content extraction in browser context
    const html = await page.evaluate((sel) => {
        // Handle case where specific selector is provided
        if (sel) {
            const element = document.querySelector(sel);
            // Return element content or empty string if not found
            return element ? element.outerHTML : '';
        }

        // Step 2: Try standard content containers first
        const contentSelectors = [
            'main',           // HTML5 semantic main content
            'article',        // HTML5 semantic article content
            '[role="main"]',  // ARIA main content role
            '#content',       // Common content ID
            '.content',       // Common content class
            '.main',          // Alternative main class
            '.post',          // Blog post content
            '.article',       // Article content container
        ];

        // Try each selector in priority order
        for (const contentSelector of contentSelectors) {
            const element = document.querySelector(contentSelector);
            if (element) {
                return element.outerHTML;  // Return first matching content
            }
        }

        // Step 3: Fallback to cleaning full body content
        const body = document.body;

        // Define elements to remove for cleaner content
        const elementsToRemove = [
            // Navigation elements
            'header',                    // Page header
            'footer',                    // Page footer
            'nav',                       // Navigation sections
            '[role="navigation"]',       // ARIA navigation elements

            // Sidebars and complementary content
            'aside',                     // Sidebar content
            '.sidebar',                  // Sidebar by class
            '[role="complementary"]',    // ARIA complementary content

            // Navigation-related elements
            '.nav',                      // Navigation classes
            '.menu',                     // Menu elements

            // Page structure elements
            '.header',                   // Header classes
            '.footer',                   // Footer classes

            // Advertising and notices
            '.advertisement',            // Advertisement containers
            '.ads',                      // Ad containers
            '.cookie-notice',            // Cookie consent notices
        ];

        // Remove each unwanted element from content
        elementsToRemove.forEach(sel => {
            body.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Return cleaned body content
        return body.outerHTML;
    }, selector);

    // Step 4: Handle empty content case
    if (!html) {
        return '';
    }

    try {
        // Step 5: Convert HTML to Markdown
        const markdown = turndownService.turndown(html);

        // Step 6: Clean up and format markdown
        return markdown
            .replace(/\n{3,}/g, '\n\n')      // Replace excessive newlines with double
            .replace(/^- $/gm, '')           // Remove empty list items
            .replace(/^\s+$/gm, '')          // Remove whitespace-only lines
            .trim();                         // Remove leading/trailing whitespace

    } catch (error) {
        // Log conversion errors and return original HTML as fallback
        console.error('Error converting HTML to Markdown:', error);
        return html;
    }
}

// Validate URL format and ensure security constraints
function isValidUrl(urlString: string): boolean {
    try {
        // Attempt to parse URL string
        const url = new URL(urlString);

        // Only allow HTTP and HTTPS protocols for security
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        // Return false for any invalid URL format
        return false;
    }
}

// Define result type for tool operations
type ToolResult = {
    content: (TextContent | ImageContent)[];  // Array of text or image content
    isError?: boolean;                        // Optional error flag
};

// Tool request handler for executing research operations
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
    // Initialize browser for tool operations
    const page = await ensureBrowser();

    switch (request.params.name) {
        // Handle Google search operations
        case "search_google": {
            // Extract search query from request parameters
            const { query } = request.params.arguments as { query: string };

            try {
                // Execute search with retry mechanism
                const results = await withRetry(async () => {
                    // Step 1: Navigate to Google search page
                    await safePageNavigation(page, 'https://www.google.com');

                    // Step 2: Find and interact with search input
                    await withRetry(async () => {
                        // Wait for any search input element to appear
                        await Promise.race([
                            // Try multiple possible selectors for search input
                            page.waitForSelector('input[name="q"]', { timeout: 5000 }),
                            page.waitForSelector('textarea[name="q"]', { timeout: 5000 }),
                            page.waitForSelector('input[type="text"]', { timeout: 5000 })
                        ]).catch(() => {
                            throw new Error('Search input not found - no matching selectors');
                        });

                        // Find the actual search input element
                        const searchInput = await page.$('input[name="q"]') ||
                            await page.$('textarea[name="q"]') ||
                            await page.$('input[type="text"]');

                        // Verify search input was found
                        if (!searchInput) {
                            throw new Error('Search input element not found after waiting');
                        }

                        // Step 3: Enter search query
                        await searchInput.click({ clickCount: 3 });  // Select all existing text
                        await searchInput.press('Backspace');        // Clear selected text
                        await searchInput.type(query);               // Type new query
                    }, 3, 2000); // Allow 3 retries with 2s delay

                    // Step 4: Submit search and wait for results
                    await withRetry(async () => {
                        await Promise.all([
                            page.keyboard.press('Enter'),             // Submit search
                            page.waitForNavigation({                  // Wait for results page
                                waitUntil: ['load', 'networkidle0'],  // Wait until page loads and network is idle
                                timeout: 15000                        // 15s timeout for navigation
                            })
                        ]);
                    });

                    // Step 5: Extract search results
                    const searchResults = await withRetry(async () => {
                        const results = await page.evaluate(() => {
                            // Find all search result containers
                            const elements = document.querySelectorAll('div.g');
                            if (!elements || elements.length === 0) {
                                throw new Error('No search results found');
                            }

                            // Extract data from each result
                            return Array.from(elements).map((el) => {
                                // Find required elements within result container
                                const titleEl = el.querySelector('h3');                // Title element
                                const linkEl = el.querySelector('a');                 // Link element
                                const snippetEl = el.querySelector('div.VwiC3b');     // Snippet element

                                // Skip results missing required elements
                                if (!titleEl || !linkEl || !snippetEl) {
                                    return null;
                                }

                                // Return structured result data
                                return {
                                    title: titleEl.textContent || '',         // Result title
                                    url: linkEl.getAttribute('href') || '',   // Result URL
                                    snippet: snippetEl.textContent || '',     // Result description
                                };
                            }).filter(result => result !== null);  // Remove invalid results
                        });

                        // Verify we found valid results
                        if (!results || results.length === 0) {
                            throw new Error('No valid search results found');
                        }

                        return results;
                    });

                    // Step 6: Store results in session
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

                // Step 7: Return formatted results
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(results, null, 2)  // Pretty-print JSON results
                    }]
                };
            } catch (error) {
                // Handle and format search errors
                return {
                    content: [{
                        type: "text",
                        text: `Failed to perform search: ${(error as Error).message}`
                    }],
                    isError: true
                };
            }
        }

        // Handle webpage visit and content extraction
        case "visit_page": {
            // Extract URL and screenshot flag from request
            const { url, takeScreenshot } = request.params.arguments as {
                url: string;                    // Target URL to visit
                takeScreenshot?: boolean;       // Optional screenshot flag
            };

            // Step 1: Validate URL format and security
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
                // Step 2: Visit page and extract content with retry mechanism
                const result = await withRetry(async () => {
                    // Navigate to target URL safely
                    await safePageNavigation(page, url);
                    const title = await page.title();

                    // Step 3: Extract and process page content
                    const content = await withRetry(async () => {
                        // Convert page content to markdown
                        const extractedContent = await extractContentAsMarkdown(page);
                        if (!extractedContent) {
                            throw new Error('Failed to extract content');
                        }
                        return extractedContent;
                    });

                    // Step 4: Create result object with page data
                    const pageResult: ResearchResult = {
                        url,                            // Original URL
                        title,                          // Page title
                        content,                        // Markdown content
                        timestamp: new Date().toISOString(),  // Capture time
                    };

                    // Step 5: Take screenshot if requested
                    if (takeScreenshot) {
                        // Capture and process screenshot
                        const screenshot = await takeScreenshotWithSizeLimit(page);
                        pageResult.screenshot = screenshot;

                        // Notify clients about new screenshot resource
                        server.notification({
                            method: "notifications/resources/list_changed"
                        });
                    }

                    // Step 6: Store result in session
                    addResult(pageResult);
                    return pageResult;
                });

                // Step 7: Return formatted result
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            ...result,
                            // Replace screenshot data with availability message
                            screenshot: result.screenshot ? "Screenshot taken and available as a Resource (Paperclip icon -> Attach from MCP)." : undefined
                        }, null, 2)  // Pretty-print JSON
                    }]
                };
            } catch (error) {
                // Handle and format page visit errors
                return {
                    content: [{
                        type: "text",
                        text: `Failed to visit page: ${(error as Error).message}`
                    }],
                    isError: true
                };
            }
        }

        // Handle standalone screenshot requests
        case "take_screenshot": {
            try {
                // Step 1: Capture screenshot with retry mechanism
                const shot = await withRetry(async () => {
                    // Take and optimize screenshot with default size limits
                    return await takeScreenshotWithSizeLimit(page);
                });

                // Step 2: Initialize session if needed
                if (!currentSession) {
                    currentSession = {
                        query: "Screenshot Session",            // Session identifier
                        results: [],                            // Empty results array
                        lastUpdated: new Date().toISOString(),  // Current timestamp
                    };
                }

                // Step 3: Get current page information
                const pageUrl = await page.url();      // Current page URL
                const pageTitle = await page.title();  // Current page title

                // Step 4: Create and store screenshot result
                addResult({
                    url: pageUrl,
                    title: pageTitle || "Untitled Page",  // Fallback title if none available
                    content: "Screenshot taken",          // Simple content description
                    timestamp: new Date().toISOString(),  // Capture time
                    screenshot: shot                      // Screenshot data
                });

                // Step 5: Notify clients about new screenshot resource
                server.notification({
                    method: "notifications/resources/list_changed"
                });

                // Step 6: Return success message
                return {
                    content: [{
                        type: "text",
                        text: "Screenshot taken successfully. The screenshot is now available as a resource."
                    }]
                };
            } catch (error) {
                // Handle and format screenshot errors
                return {
                    content: [{
                        type: "text",
                        text: `Failed to take screenshot: ${(error as Error).message}`
                    }],
                    isError: true
                };
            }
        }

        // Handle unknown tool requests
        default:
            throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${request.params.name}`
            );
    }
});

// Register handler for prompt listing requests
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    // Return all available prompts
    return { prompts: Object.values(PROMPTS) };
});

// Register handler for prompt retrieval and execution
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    // Extract and validate prompt name
    const promptName = request.params.name as PromptName;
    const prompt = PROMPTS[promptName];

    // Handle unknown prompt requests
    if (!prompt) {
        throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${promptName}`);
    }

    // Handle agentic research prompt
    if (promptName === "agentic-research") {
        // Extract research topic from request arguments
        const args = request.params.arguments as AgenticResearchArgs | undefined;
        const topic = args?.topic || "";  // Use empty string if no topic provided

        // Return research assistant prompt with instructions
        return {
            messages: [
                // Initial assistant message establishing role
                {
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "I am ready to help you with your research. I will conduct thorough web research, explore topics deeply, and maintain a dialogue with you throughout the process."
                    }
                },
                // Detailed research instructions for the user
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
10. **Always cite your sources**, providing URLs to the sources you used in a citation block at the end of your response.

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

    // Handle unsupported prompt types
    throw new McpError(ErrorCode.InvalidRequest, "Prompt implementation not found");
});

// Constants for cleanup operations
const CLEANUP_TIMEOUT_MS = 5000;  // Maximum time to wait for cleanup (5 seconds)

// Perform cleanup with timeout protection to prevent hanging
async function cleanupWithTimeout(): Promise<void> {
    return Promise.race([
        // Attempt normal cleanup
        (async () => {
            if (browser) {
                await browser.close();
            }
        })(),
        // Timeout after defined period
        new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Cleanup timeout')), CLEANUP_TIMEOUT_MS)
        )
    ]) as Promise<void>;
}

// Clean up browser resources and handles
async function cleanupBrowser(): Promise<void> {
    if (browser) {
        try {
            // Clean up page resources first
            if (page) {
                await page.removeAllListeners();  // Remove event listeners
                await page.close().catch(console.error);  // Close page
            }
            // Close browser instance
            await browser.close().catch(console.error);
        } catch (error) {
            console.error('Error during browser cleanup:', error);
        } finally {
            // Reset references regardless of cleanup success
            browser = undefined;
            page = undefined;
        }
    }
}

// Process termination handlers
process.on('SIGINT', async () => {
    // Handle user-initiated termination (Ctrl+C)
    console.error('Shutting down...');
    await cleanupBrowser();
    await cleanupWithTimeout();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    // Handle system-initiated termination
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
    // Handle unexpected errors
    console.error('Uncaught exception:', error);
    try {
        await cleanupWithTimeout();
        process.exit(1);
    } catch (cleanupError) {
        console.error('Fatal error during uncaught exception cleanup:', cleanupError);
        process.exit(1);
    }
});

// Ensure browser instance is available and properly configured
async function ensureBrowser(): Promise<Page> {
    try {
        // Handle disconnected browser with existing page
        // If browser is disconnected/missing but page exists, clean up page
        if ((!browser || browser.connected === false) && page) {
            await page.removeAllListeners();  // Remove all event listeners from page
            page = undefined;  // Clear page reference
        }

        // Initialize or reinitialize browser if needed
        // If browser is missing or disconnected, create new browser instance
        if (!browser || browser.connected === false) {
            // Clean up existing browser if present
            if (browser) {
                try {
                    await browser.close();  // Close existing browser
                } catch (error) {
                    console.error('Error closing existing browser:', error);
                }
                browser = undefined;  // Clear browser reference
            }

            // Launch new browser instance with security and performance settings
            browser = await puppeteer.launch({
                headless: true,  // Run in headless mode
                args: [
                    '--no-sandbox',              // Disable sandbox for containerized environments
                    '--disable-setuid-sandbox',  // Disable setuid sandbox for stability
                    '--disable-dev-shm-usage',   // Disable shared memory usage
                    '--disable-gpu',             // Disable GPU hardware acceleration
                    '--window-size=1920,1080'    // Set default window size
                ]
            });

            // Handle browser disconnection events
            browser.on('disconnected', async () => {
                if (page) {
                    await page.removeAllListeners();  // Clean up page listeners
                }
                browser = undefined;  // Clear browser reference
                page = undefined;  // Clear page reference
            });
        }

        // Initialize or reinitialize page if needed
        // Create new page if none exists or current is closed
        if (!page || page.isClosed()) {
            const pages = await browser.pages();  // Get existing pages
            page = pages[0] || await browser.newPage();  // Use first page or create new
            await page.setViewport({ width: 1920, height: 1080 });  // Set viewport dimensions
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');  // Set user agent

            // Handle page errors
            page.on('error', error => {
                console.error('Page error:', error);
                page = undefined;  // Clear page reference on error
            });

            // Enable request interception for resource control
            await page.setRequestInterception(true);
            // Handle individual requests
            page.on('request', async request => {
                try {
                    // Block media and PDF requests, allow others
                    if (request.resourceType() === 'media' || request.url().endsWith('.pdf')) {
                        await request.abort();  // Block request
                    } else {
                        await request.continue();  // Allow request
                    }
                } catch (error: unknown) {
                    // Check if error is already handled
                    const isAlreadyHandledError = error instanceof Error &&
                        (error.message.includes('Request is already handled') ||
                            error.message.includes('Request Interception is not enabled'));
                    // Handle unhandled errors
                    if (!isAlreadyHandledError) {
                        console.error('Request interception error:', error);
                        try {
                            await request.abort();  // Attempt to abort request
                        } catch (abortError) {
                            // Log abort failures unless already handled
                            if (!(abortError instanceof Error && abortError.message.includes('Request is already handled'))) {
                                console.error('Failed to abort request:', abortError);
                            }
                        }
                    }
                }
            });
        }

        return page;  // Return configured page
    } catch (error) {
        // Handle initialization errors
        if (browser) {
            try {
                await browser.close();  // Clean up browser
            } catch (closeError) {
                console.error('Error closing browser during error cleanup:', closeError);
            }
            browser = undefined;  // Clear browser reference
        }
        page = undefined;  // Clear page reference
        throw new McpError(ErrorCode.InternalError, `Failed to initialize browser: ${(error as Error).message}`);
    }
}