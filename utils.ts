/**
 * Utility Functions Module
 * 
 * This module provides a collection of utility functions that support the core
 * functionality of the MCP Web Research Server. It includes tools for HTML to Markdown
 * conversion, URL validation, screenshot management, file operations, and retry mechanisms.
 * These utilities are used throughout the application to handle common tasks.
 */

import fs from 'fs';
import path from 'path';
import TurndownService from 'turndown';

/**
 * Path to temporary directory for storing screenshots
 * 
 * This constant defines the path to the temporary directory where screenshots
 * captured during research sessions are stored. The directory is created automatically
 * if it doesn't exist.
 */
const TEMP_DIR = path.join(process.cwd(), 'temp');

// Ensure temporary directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Configured Turndown service instance for HTML to Markdown conversion
 * 
 * This instance of TurndownService is configured with specific options for
 * consistent Markdown formatting. It also includes custom rules for handling
 * figures with captions and code blocks with language specifications.
 */
export const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full'
});

/**
 * Add custom rules to improve HTML to Markdown conversion
 * 
 * These custom rules extend the base functionality of the Turndown service
 * to better handle specific HTML elements and patterns commonly found on web pages.
 */

// 1. Custom rule for handling images with captions (figure/figcaption elements)
const figureFigureCaptionRule = {
    filter: (node: any) => {
        return node.nodeName === 'FIGURE' && node.querySelector('figcaption');
    },
    replacement: (content: string, node: any, options: any) => {
        const img = node.querySelector('img');
        const caption = node.querySelector('figcaption');
        if (!img) return content;
        
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        const captionText = caption?.textContent || '';
        
        return `![${alt}](${src})\n*${captionText.trim()}*\n`;
    }
};

turndownService.addRule('figureWithCaption', figureFigureCaptionRule);

// 2. Custom rule for handling code blocks with language specifications
const preCodeRule = {
    filter: (node: any) => {
        return node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
    },
    replacement: (content: string, node: any, options: any) => {
        const codeNode = node.firstChild;
        let language = '';
        
        // Extract language from class name (common patterns)
        const className = codeNode.getAttribute('class') || '';
        if (className) {
            // Handle GitHub-style syntax highlighting (class="language-javascript")
            const match = className.match(/language-([^\s]+)/);
            if (match && match[1]) {
                language = match[1];
            }
        }
        
        // Get the code content and format it with proper indentation
        const code = codeNode.textContent || '';
        
        // Return the code block with language specification
        return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
};

turndownService.addRule('preCode', preCodeRule);

/**
 * Converts HTML content to clean, formatted Markdown
 * 
 * This function uses the configured Turndown service to convert HTML content
 * to Markdown format. It includes post-processing to clean up the output and
 * ensure consistent formatting.
 * 
 * @param html - HTML content to convert to Markdown
 * @returns Clean, formatted Markdown string
 */
export function htmlToMarkdown(html: string): string {
    try {
        // Convert HTML to Markdown using the configured Turndown service
        const markdown = turndownService.turndown(html);
        
        // Post-processing to clean up and improve the Markdown output
        return markdown
            // Remove extra newlines
            .replace(/\n{3,}/g, '\n\n')
            // Ensure proper spacing around headers
            .replace(/(^|\n)(#+)\s+([^\n]+)/g, '$1\n$2 $3\n')
            // Normalize whitespace
            .trim();
    } catch (error) {
        console.error('Error converting HTML to Markdown:', error);
        // Return original HTML as fallback
        return html;
    }
}

/**
 * Validates if a string is a properly formatted URL
 * 
 * This function performs basic URL validation by attempting to create
 * a URL object from the input string. It catches any exceptions that
 * occur during URL construction to determine validity.
 * 
 * @param url - String to validate as a URL
 * @returns Boolean indicating whether the string is a valid URL format
 */
export function isValidUrl(url: string): boolean {
    try {
        // Basic URL validation
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Saves a screenshot buffer to a uniquely named temporary file
 * 
 * This function generates a unique filename based on the current timestamp,
 * writes the screenshot buffer to a file in the temporary directory, and
 * returns the full path to the saved file.
 * 
 * @param screenshotBuffer - Buffer containing the screenshot image data
 * @returns Promise resolving to the full path of the saved screenshot file
 * @throws Error if saving the screenshot fails
 */
export async function saveScreenshot(screenshotBuffer: Buffer): Promise<string> {
    // Generate a unique filename based on timestamp
    const timestamp = Date.now();
    const screenshotPath = path.join(TEMP_DIR, `${timestamp}.png`);
    
    try {
        // Write the screenshot buffer to a file
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        return screenshotPath;
    } catch (error) {
        console.error('Error saving screenshot:', error);
        throw new Error(`Failed to save screenshot: ${(error as Error).message}`);
    }
}

/**
 * Deletes all screenshot files in the temporary directory
 * 
 * This function removes all files from the temporary directory used for
 * storing screenshots. It's designed to be called during application shutdown
 * or periodically to free up disk space.
 * 
 * @returns Promise that resolves when cleanup is complete
 */
export async function cleanupScreenshots(): Promise<void> {
    try {
        // Check if the temporary directory exists
        if (!fs.existsSync(TEMP_DIR)) {
            return;
        }
        
        // Get list of all files in the temporary directory
        const files = await fs.promises.readdir(TEMP_DIR);
        
        // Delete each file
        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            try {
                // Only delete files, not subdirectories
                if (fs.lstatSync(filePath).isFile()) {
                    await fs.promises.unlink(filePath);
                }
            } catch (error) {
                console.error(`Error deleting file ${filePath}:`, error);
            }
        }
    } catch (error) {
        console.error('Error during screenshot cleanup:', error);
    }
}

/**
 * Executes an asynchronous operation with exponential backoff retry logic
 * 
 * This function attempts to execute the provided asynchronous operation,
 * automatically retrying with exponential backoff (1s, 2s, 4s, etc.)
 * if the operation fails. It's useful for handling transient failures.
 * 
 * @template T - The return type of the operation
 * @param operation - Async function to execute and potentially retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Promise resolving to the result of the successful operation
 * @throws Error if all retry attempts fail
 */
export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | undefined;
    
    // Try the operation up to maxRetries times
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // If it's not the first attempt, wait before retrying
            if (attempt > 0) {
                // Exponential backoff: wait 1s, then 2s, then 4s, etc.
                const delayMs = Math.pow(2, attempt - 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            // Attempt the operation
            return await operation();
        } catch (error) {
            lastError = error as Error;
            console.log(`Attempt ${attempt + 1} failed: ${lastError.message}`);
        }
    }
    
    // If all attempts fail, throw the last error
    throw lastError || new Error('All retry attempts failed');
}

/**
 * Safely reads file content with comprehensive error handling
 * 
 * This function checks if the file exists before attempting to read it,
 * provides detailed error logging, and properly propagates errors.
 * 
 * @param filePath - Path to the file to be read
 * @returns Promise resolving to the file content as a string
 * @throws Error if the file doesn't exist or cannot be read
 */
export async function readFileSafely(filePath: string): Promise<string> {
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        // Read and return the file content
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
    }
}

/**
 * Safely writes content to a file with directory creation and error handling
 * 
 * This function ensures the target directory exists before writing,
 * provides detailed error logging, and properly propagates errors.
 * 
 * @param filePath - Path to the file to be written
 * @param content - Content to write to the file
 * @returns Promise that resolves when writing is complete
 * @throws Error if the file cannot be written
 */
export async function writeFileSafely(filePath: string, content: string): Promise<void> {
    try {
        // Ensure the directory exists
        const directory = path.dirname(filePath);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        
        // Write the content to the file
        await fs.promises.writeFile(filePath, content, 'utf-8');
    } catch (error) {
        console.error(`Error writing to file ${filePath}:`, error);
        throw error;
    }
}