/**
 * MCP Web Research Server Module
 * 
 * This module serves as the core component of the MCP Web Research Server, responsible for
 * initializing the MCP server, handling tool call requests, managing resources, and
 * providing prompt configurations. It acts as the main entry point for communication
 * between Claude and the web research capabilities.
 */

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
import * as fs from 'fs';
import * as path from 'path';

// Forward declarations
import { ensureBrowser } from './browser.js';
import { searchGoogle, visitPage, takeScreenshot } from './tools.js';
import { currentSession } from './session.js';
import { cleanupScreenshots } from './utils.js';

/**
 * Result structure for tool executions
 * 
 * This type defines the standard response format for tools executed by the MCP server.
 * It can contain both text and image content, and indicates whether the execution resulted in an error.
 */
export type ToolResult = {
    /** Array of content items returned by the tool */
    content: (TextContent | ImageContent)[];
    /** Flag indicating if the tool execution resulted in an error */
    isError?: boolean;
};

/**
 * Available prompt names for the server
 * 
 * This type defines the valid prompt names that can be requested from the server.
 * Currently, only "agentic-research" is supported.
 */
export type PromptName = "agentic-research";

/**
 * Arguments for the agentic-research prompt
 * 
 * This interface defines the parameters that can be passed to the agentic-research prompt.
 */
export interface AgenticResearchArgs {
    /** The topic or question to research */
    topic: string;
}

/**
 * Global server instance
 * 
 * This variable holds the singleton instance of the MCP server once it's initialized.
 */
let server: Server;

/**
 * Retrieves the current MCP server instance
 * 
 * This function returns the singleton instance of the MCP server, ensuring it has been
 * initialized before returning.
 * 
 * @returns The initialized MCP server instance
 * @throws Error if the server has not been initialized yet
 */
export function getServer(): Server {
    if (!server) {
        throw new Error('Server not initialized');
    }
    return server;
}

/**
 * Initializes and starts the MCP Web Research Server
 * 
 * This function creates a new MCP server instance, registers request handlers,
 * and connects it to the standard input/output transport. It sets up all the
 * necessary infrastructure for the server to communicate with Claude.
 * 
 * @returns Promise that resolves when the server is initialized
 */
export async function initializeServer(): Promise<void> {
    server = new Server(
        {
            name: "webresearch",
            version: "0.1.7",
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        }
    );

    // Register handlers
    registerRequestHandlers();

    // Connect server
    const transport = new StdioServerTransport();
    server.connect(transport).catch((error) => {
        console.error("Failed to start server:", error);
        process.exit(1);
    });
}

/**
 * Registers all request handlers for the MCP server
 * 
 * This function sets up handlers for various MCP request types including:
 * - List available tools
 * - List available resources
 * - Read resource content
 * - Execute tool calls
 * - List available prompts
 * - Retrieve specific prompts
 * 
 * These handlers enable Claude to interact with the web research capabilities.
 */
function registerRequestHandlers(): void {
    if (!server) return;

    // Tools listing handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS
    }));

    // Resources listing handler
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
                .map((r, i): Resource | undefined => r.screenshotPath ? {
                    uri: `research://screenshots/${i}`,
                    name: `Screenshot of ${r.title}`,
                    description: `Screenshot taken from ${r.url}`,
                    mimeType: "image/png"
                } : undefined)
                .filter((r): r is Resource => r !== undefined)
        ];

        return { resources };
    });

    // Resource content handler
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri.toString();

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
                            timestamp: r.timestamp,
                            screenshotPath: r.screenshotPath
                        }))
                    }, null, 2)
                }]
            };
        }

        if (uri.startsWith("research://screenshots/")) {
            const index = parseInt(uri.split("/").pop() || "", 10);

            if (!currentSession) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    "No active research session"
                );
            }

            if (isNaN(index) || index < 0 || index >= currentSession.results.length) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Screenshot index out of bounds: ${index}`
                );
            }

            const result = currentSession.results[index];
            if (!result?.screenshotPath) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `No screenshot available at index: ${index}`
                );
            }

            try {
                const screenshotData = await fs.promises.readFile(result.screenshotPath);
                const base64Data = screenshotData.toString('base64');

                return {
                    contents: [{
                        uri,
                        mimeType: "image/png",
                        blob: base64Data
                    }]
                };
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                throw new McpError(
                    ErrorCode.InternalError,
                    `Failed to read screenshot: ${errorMessage}`
                );
            }
        }

        throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${uri}`
        );
    });

    // Tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
        const page = await ensureBrowser();

        try {
            switch (request.params.name) {
                case "search_google":
                    if (!request.params.arguments || typeof request.params.arguments !== 'object' || !('query' in request.params.arguments) || typeof request.params.arguments.query !== 'string') {
                        throw new McpError(ErrorCode.InvalidRequest, 'Missing or invalid query parameter');
                    }
                    const searchResult = await searchGoogle(page, request.params.arguments.query as string);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(searchResult) }]
                    };
                
                case "visit_page":
                    if (!request.params.arguments || typeof request.params.arguments !== 'object' || !('url' in request.params.arguments) || typeof request.params.arguments.url !== 'string') {
                        throw new McpError(ErrorCode.InvalidRequest, 'Missing or invalid url parameter');
                    }
                    const visitResult = await visitPage(
                        page,
                        request.params.arguments.url as string,
                        request.params.arguments.takeScreenshot !== false
                    );
                    return {
                        content: [{ type: 'text', text: JSON.stringify(visitResult) }]
                    };
                
                case "take_screenshot":
                    const screenshotResult = await takeScreenshot(page);
                    // 读取截图文件并转换为base64
                    try {
                        const screenshotData = await fs.promises.readFile(screenshotResult.screenshotPath);
                        const base64Data = screenshotData.toString('base64');
                        return {
                            content: [
                                { type: 'text', text: JSON.stringify({ url: screenshotResult.url, title: screenshotResult.title }) },
                                { type: 'image', data: base64Data, mimeType: 'image/png' }
                            ]
                        };
                    } catch (error) {
                        // 如果读取截图失败，只返回文本信息
                        return {
                            content: [{ type: 'text', text: JSON.stringify(screenshotResult) }]
                        };
                    }
                
                default:
                    throw new McpError(
                        ErrorCode.MethodNotFound,
                        `Unknown tool: ${request.params.name}`
                    );
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                isError: true
            };
        }
    });

    // Prompts listing handler
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return { prompts: Object.values(PROMPTS) };
    });

    // Prompt retrieval handler
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

        throw new McpError(ErrorCode.InvalidRequest, "Prompt implementation not found");
    });
}

/**
 * Configuration for tools available through the MCP server
 * 
 * This array defines all the tools that Claude can use, including search_google,
 * visit_page, and take_screenshot. Each tool definition includes its name,
 * description, and input schema for validation.
 */
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
            properties: {},
        },
    },
];

/**
 * Configuration for prompts available through the MCP server
 * 
 * This object defines all the prompts that Claude can use. Currently, it only
 * includes the "agentic-research" prompt, which guides Claude through a structured
 * research process on a given topic.
 */
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