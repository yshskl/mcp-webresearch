#!/usr/bin/env node

/**
 * MCP Web Research Server - Main Entry Point
 * 
 * This file serves as the main entry point for the MCP Web Research Server. It imports
 * and composes various modular components to provide complete web research functionality
 * through the Model Context Protocol (MCP) for Claude AI.
 * 
 * Modular Architecture:
 * - browser.ts: Manages Playwright browser instances for web interactions
 * - session.ts: Handles research session data, including search history and results
 * - utils.ts: Provides utility functions for common tasks like file operations and HTML conversion
 * - tools.ts: Implements the core research tools (search, page visiting, screenshot capture)
 * - server.ts: Configures the MCP server and handles protocol requests from Claude
 * 
 * This modular design improves code maintainability, testability, and allows for
 * easier extension of functionality in the future.
 */

// 导入核心模块

import { ensureBrowser, closeBrowser } from './browser.js';
import { createSession, addResult, currentSession } from './session.js';
import { initializeServer, getServer } from './server.js';
import { searchGoogle, visitPage, takeScreenshot } from './tools.js';
import { cleanupScreenshots } from './utils.js';
import fs from 'fs';

/**
 * Cleans up resources when the server shuts down
 * 
 * This function is responsible for properly releasing resources when the server exits,
 * including closing the browser instance and removing temporary screenshot files.
 * It's called when the process receives termination signals or when an error occurs.
 * 
 * @returns Promise that resolves when cleanup is complete
 */
async function cleanup() {
    try {
        console.log('Cleaning up resources...');
        
        // Close browser instance to free up system resources
        await closeBrowser();
        
        // Remove temporary screenshot files to free up disk space
        await cleanupScreenshots();
        
        console.log('Resources cleaned up successfully');
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// 处理进程退出信号
process.on('SIGINT', async () => {
    console.log('Received SIGINT signal. Shutting down...');
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal. Shutting down...');
    await cleanup();
    process.exit(0);
});

/**
 * Main server initialization function
 * 
 * This function orchestrates the startup process of the MCP Web Research Server,
 * including creating an initial research session, ensuring the browser is ready,
 * and starting the MCP server. It handles any errors that occur during startup
 * and performs cleanup before exiting if necessary.
 * 
 * @returns Promise that resolves when the server has started successfully
 * @throws Error if the server fails to start
 */
async function main() {
    try {
        console.log('Starting MCP Web Research Server...');
        
        // Create an initial research session to store search results
        createSession("Initial Research Session");
        
        // Ensure browser instance is initialized and ready for web operations
        await ensureBrowser();
        
        // Start the MCP server to handle requests from Claude
        await initializeServer();
        
        console.log('MCP Web Research Server started successfully');
    } catch (error) {
        console.error('Failed to start server:', error);
        
        // Perform cleanup if startup fails
        await cleanup();
        
        // Exit with non-zero status code to indicate failure
        process.exit(1);
    }
}

// 启动服务器
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});