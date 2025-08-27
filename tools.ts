/**
 * Research Tools Module
 * 
 * This module provides core research functionality for the MCP Web Research Server,
 * including Google search capabilities, web page content extraction, and screenshot
 * functionality. It leverages Playwright for browser automation to perform these tasks.
 */

import { Page } from 'playwright';
import { htmlToMarkdown, isValidUrl, saveScreenshot } from './utils.js';
import { ResearchResult, addResult } from './session.js';
import { dismissGoogleConsent, safePageNavigation } from './browser.js';

/**
 * Interface representing a single search result
 * 
 * This interface defines the structure of individual search results obtained
 * from search engine queries, containing metadata about the found pages.
 */
export interface SearchResult {
    /** Title of the search result page */
    title: string;
    
    /** URL of the search result page */
    url: string;
    
    /** Snippet text extracted from the search result */
    snippet: string;
}

/**
 * Interface representing the complete result of a Google search
 * 
 * This interface defines the structure of results returned from the Google search
 * operation, including the list of individual results and metadata about the search.
 */
export interface SearchGoogleResult {
    /** Array of individual search results */
    results: SearchResult[];
    
    /** Optional total results count text as displayed in search engine */
    totalResults?: string;
}

/**
 * Interface representing the result of a page visit operation
 * 
 * This interface defines the structure of results returned from visiting a web page,
 * containing extracted content, metadata, and optional media references.
 */
export interface VisitPageResult {
    /** URL of the visited page */
    url: string;
    
    /** Title of the visited page */
    title: string;
    
    /** Content extracted from the page, formatted as markdown */
    content: string;
    
    /** Optional path to screenshot file stored on disk */
    screenshotPath?: string;
}

/**
 * Interface representing the result of a screenshot operation
 * 
 * This interface defines the structure of results returned from taking a screenshot,
 * containing the screenshot path and associated page metadata.
 */
export interface TakeScreenshotResult {
    /** Path to screenshot file stored on disk */
    screenshotPath: string;
    
    /** URL of the page that was screenshotted */
    url: string;
    
    /** Title of the page that was screenshotted */
    title: string;
}

/**
 * Performs a Google search and extracts structured results
 * 
 * This function executes a Google search using the provided query, navigates
 * to the search results page, and extracts structured data from the results.
 * It handles different Google UI variations and provides clean, formatted results.
 * 
 * @param page - Playwright Page object to use for navigation and content extraction
 * @param query - Search query string to execute
 * @returns Promise resolving to structured search results data
 * @throws Error if the search operation fails
 */
export async function searchGoogle(page: Page, query: string): Promise<SearchGoogleResult> {
    // Create the Google search URL
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    
    try {
        // Navigate to the search URL safely
        await safePageNavigation(page, searchUrl);
        
        // Dismiss Google consent dialog if present
        await dismissGoogleConsent(page);
        
        // Extract search results using page.evaluate
        const results = await page.evaluate<{ results: SearchResult[], totalResultsText?: string }>(() => {
            // Function to extract search result data
            const extractSearchResults = () => {
                const searchResults: { title: string, url: string, snippet: string }[] = [];
                
                // Select search result elements (different Google UI variations)
                const resultSelectors = [
                    'div.g',                     // Standard result containers
                    'div.tF2Cxc',                // Modern Google result containers
                    'div.yuRUbf',                // URL containers
                    'div[data-hveid]'            // Elements with data-hveid attribute
                ];
                
                // Try all selectors until we find results
                let resultElements: HTMLElement[] = [];
                for (const selector of resultSelectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        resultElements = Array.from(elements) as HTMLElement[];
                        break;
                    }
                }
                
                // Process each search result element
                for (const element of resultElements) {
                    try {
                        // Extract title
                        const titleElement = element.querySelector('h3, h2');
                        const title = titleElement?.textContent || '';
                        
                        // Extract URL
                        const urlElement = element.querySelector('a[href^="http"]');
                        let url = urlElement?.getAttribute('href') || '';
                        
                        // Clean up URL (remove tracking parameters, etc.)
                        if (url) {
                            try {
                                const urlObj = new URL(url);
                                if (urlObj.searchParams.has('url')) {
                                    url = urlObj.searchParams.get('url') || url;
                                }
                            } catch (e) {
                                // Invalid URL format, keep original
                            }
                        }
                        
                        // Extract snippet
                        const snippetElement = element.querySelector('div.VwiC3b, div.s, span.st');
                        const snippet = snippetElement?.textContent || '';
                        
                        // Only add valid results
                        if (title && url && url.startsWith('http')) {
                            searchResults.push({
                                title,
                                url,
                                snippet
                            });
                        }
                    } catch (error) {
                        console.error('Error processing search result:', error);
                    }
                }
                
                // Extract total results count
                const totalResultsElement = document.querySelector('div#result-stats');
                const totalResultsText = totalResultsElement?.textContent || '';
                
                return {
                    results: searchResults,
                    totalResultsText
                };
            };
            
            return extractSearchResults();
        });
        
        // Return the search results with proper undefined checks
        return {
            results: results?.results || [],
            totalResults: results?.totalResultsText
        };
    } catch (error) {
        console.error(`Google search failed for query "${query}":`, error);
        throw new Error(`Google search failed: ${(error as Error).message}`);
    }
}

/**
 * Visits a web page, extracts clean content, and optionally takes a screenshot
 * 
 * This function navigates to the specified URL, extracts the main content while
 * removing advertisements and other non-essential elements, converts the content
 * to markdown format, and optionally captures a screenshot of the page.
 * 
 * @param page - Playwright Page object to use for navigation and content extraction
 * @param url - URL of the web page to visit
 * @param takeScreenshot - Whether to capture a screenshot of the page (default: true)
 * @returns Promise resolving to structured page visit result data
 * @throws Error if the URL format is invalid or the page visit operation fails
 */
export async function visitPage(
    page: Page,
    url: string,
    takeScreenshot: boolean = true
): Promise<VisitPageResult> {
    // Validate the URL format
    if (!isValidUrl(url)) {
        throw new Error(`Invalid URL format: ${url}`);
    }
    
    try {
        // Navigate to the URL safely
        await safePageNavigation(page, url);
        
        // Extract page content
        const pageData = await page.evaluate(() => {
            // Function to extract clean HTML content
            const extractCleanContent = () => {
                // Try common content selectors for clean content extraction
                const contentSelectors = [
                    // Common article/content containers
                    'article',
                    'main',
                    '[role="main"]',
                    'div#content',
                    'div.content',
                    'div.article-content',
                    'div.post-content',
                    'div.entry-content',
                    'div.main-content',
                    
                    // Fallback to body if no specific content container found
                    'body'
                ];
                
                // Try each selector until we find a valid one
                let mainContent: HTMLElement | null = null;
                for (const selector of contentSelectors) {
                    mainContent = document.querySelector(selector);
                    if (mainContent && mainContent.textContent && mainContent.textContent.trim().length > 100) {
                        break;
                    }
                }
                
                // If no valid content found, use body
                if (!mainContent) {
                    mainContent = document.body;
                }
                
                // Clean up content by removing unwanted elements
                const unwantedSelectors = [
                    'nav',
                    'header',
                    'footer',
                    '.sidebar',
                    '.widget',
                    '.advertisement',
                    '.ad',
                    '.ads',
                    '.banner',
                    '.social-links',
                    '.share-buttons',
                    '.comments',
                    '[role="navigation"]',
                    '[role="complementary"]',
                    '[aria-hidden="true"]'
                ];
                
                // Create a clone of the content to modify
                const cleanContent = mainContent.cloneNode(true) as HTMLElement;
                
                // Remove unwanted elements from the clone
                unwantedSelectors.forEach(selector => {
                    const elements = cleanContent.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });
                
                return cleanContent.innerHTML;
            };
            
            return {
                title: document.title,
                contentHtml: extractCleanContent(),
                url: document.URL
            };
        });
        
        // Convert HTML content to Markdown
        const content = htmlToMarkdown(pageData.contentHtml);
        
        // Take a screenshot if requested
        let screenshotPath: string | undefined;
        if (takeScreenshot) {
            try {
                // Take a screenshot of the full page
                const screenshotBuffer = await page.screenshot({
                    fullPage: true,
                    type: 'png'
                });
                
                // Save the screenshot to disk
                screenshotPath = await saveScreenshot(screenshotBuffer);
            } catch (error) {
                console.warn('Failed to take screenshot:', error);
                // Continue without screenshot
            }
        }
        
        // Create a research result object
        const result: ResearchResult = {
            url: pageData.url,
            title: pageData.title,
            content,
            timestamp: new Date().toISOString(),
            screenshotPath
        };
        
        // Add the result to the current session
        addResult(result);
        
        // Return the visit result data
        return {
            url: pageData.url,
            title: pageData.title,
            content,
            screenshotPath
        };
    } catch (error) {
        console.error(`Failed to visit page ${url}:`, error);
        throw new Error(`Page visit failed: ${(error as Error).message}`);
    }
}

/**
 * Takes a full-page screenshot of the current page
 * 
 * This function captures a screenshot of the entire current page,
 * saves it to disk, and returns metadata about the screenshot.
 * 
 * @param page - Playwright Page object representing the current page
 * @returns Promise resolving to structured screenshot result data
 * @throws Error if the screenshot operation fails
 */
export async function takeScreenshot(page: Page): Promise<TakeScreenshotResult> {
    try {
        // Get current page information
        const pageInfo = await page.evaluate(() => ({
            url: document.URL,
            title: document.title
        }));
        
        // Take a screenshot of the full page
        const screenshotBuffer = await page.screenshot({
            fullPage: true,
            type: 'png'
        });
        
        // Save the screenshot to disk
        const screenshotPath = await saveScreenshot(screenshotBuffer);
        
        // Return the screenshot result data
        return {
            screenshotPath,
            url: pageInfo.url,
            title: pageInfo.title
        };
    } catch (error) {
        console.error('Failed to take screenshot:', error);
        throw new Error(`Screenshot failed: ${(error as Error).message}`);
    }
}

/**
 * Extracts content from the current web page without navigation
 * 
 * This function extracts content from the currently loaded page,
 * converts it to markdown format, and returns structured data.
 * It does not perform navigation, working with the current page state.
 * 
 * @param page - Playwright Page object representing the current page
 * @returns Promise resolving to structured page content data
 * @throws Error if the content extraction operation fails
 */
export async function extractPageContent(page: Page): Promise<{
    title: string;
    content: string;
    url: string;
}> {
    try {
        // Get current page HTML
        const pageData = await page.evaluate(() => ({
            title: document.title,
            contentHtml: document.body.innerHTML,
            url: document.URL
        }));
        
        // Convert HTML to Markdown
        const content = htmlToMarkdown(pageData.contentHtml);
        
        return {
            title: pageData.title,
            content,
            url: pageData.url
        };
    } catch (error) {
        console.error('Failed to extract page content:', error);
        throw new Error(`Content extraction failed: ${(error as Error).message}`);
    }
}