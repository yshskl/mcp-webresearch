/**
 * Browser module for Playwright automation
 * 
 * This module provides functionality to manage browser instances, pages,
 * and perform common browser operations with error handling and security checks.
 * It handles browser initialization, page creation, navigation, and cleanup.
 */

import { Browser, Page, chromium } from 'playwright';

// Global browser and page instances
let browser: Browser | undefined;
let page: Page | undefined;

/**
 * Ensures a browser instance is initialized and returns a page
 * 
 * This function checks if a browser instance and page already exist,
 * creating them if necessary. It's a convenience method to get a working
 * page instance without worrying about initialization details.
 * 
 * @returns Playwright Page instance ready for use
 * @throws Error if browser or page creation fails
 */
export async function ensureBrowser(): Promise<Page> {
    try {
        // Launch browser if not already running
        if (!browser) {
            browser = await chromium.launch({
                headless: true,  // Run in headless mode for automation
            });

            // Create initial context and page
            const context = await browser.newContext();
            page = await context.newPage();
        }

        // Create new page if current one is closed/invalid
        if (!page && browser) {
            const context = await browser.newContext();
            page = await context.newPage();
        }

        // Return the current page
        if (!page) {
            throw new Error('Failed to create or retrieve page');
        }
        return page;
    } catch (error) {
        console.error('Error ensuring browser is ready:', error);
        throw new Error(`Failed to ensure browser is ready: ${(error as Error).message}`);
    }
}

/**
 * Handles cookie consent banners automatically
 * 
 * This function detects and clicks common cookie consent buttons
 * on websites to ensure unobstructed browsing. It uses a variety
 * of text patterns in multiple languages to identify consent buttons.
 * 
 * @param page - Playwright Page object to process
 */
export async function dismissGoogleConsent(page: Page): Promise<void> {
    // Regions that commonly show cookie/consent banners
    const regions = [
        // Europe
        '.google.de', '.google.fr', '.google.co.uk',
        '.google.it', '.google.es', '.google.nl',
        '.google.pl', '.google.ie', '.google.dk',
        '.google.no', '.google.se', '.google.fi',
        '.google.at', '.google.ch', '.google.be',
        '.google.pt', '.google.gr', '.google.com.tr',
        // Asia Pacific
        '.google.co.id', '.google.com.sg', '.google.co.th',
        '.google.com.my', '.google.com.ph', '.google.com.au',
        '.google.co.nz', '.google.com.vn',
        // Generic domains
        '.google.com', '.google.co'
    ];

    try {
        // Get current URL
        const currentUrl = page.url();

        // Skip consent check if not in a supported region
        if (!regions.some(domain => currentUrl.includes(domain))) {
            return;
        }

        // Quick check for consent dialog existence
        const hasConsent = await page.$(
            'form:has(button[aria-label]), div[aria-modal="true"], ' +
            // Common dialog containers
            'div[role="dialog"], div[role="alertdialog"], ' +
            // Common cookie/consent specific elements
            'div[class*="consent"], div[id*="consent"], ' +
            'div[class*="cookie"], div[id*="cookie"], ' +
            // Common modal/popup classes
            'div[class*="modal"]:has(button), div[class*="popup"]:has(button), ' +
            // Common banner patterns
            'div[class*="banner"]:has(button), div[id*="banner"]:has(button)'
        ).then(Boolean);

        // If no consent dialog is found, return
        if (!hasConsent) {
            return;
        }

        // Handle the consent dialog using common consent button patterns
        await page.evaluate(() => {
            const consentPatterns = {
                // Common accept button text patterns across languages
                text: [
                    // English
                    'accept all', 'agree', 'consent',
                    // German
                    'alle akzeptieren', 'ich stimme zu', 'zustimmen',
                    // French
                    'tout accepter', 'j\'accepte',
                    // Spanish
                    'aceptar todo', 'acepto',
                    // Italian
                    'accetta tutto', 'accetto',
                    // Portuguese
                    'aceitar tudo', 'concordo',
                    // Dutch
                    'alles accepteren', 'akkoord',
                    // Polish
                    'zaakceptuj wszystko', 'zgadzam się',
                    // Swedish
                    'godkänn alla', 'godkänn',
                    // Danish
                    'accepter alle', 'accepter',
                    // Norwegian
                    'godta alle', 'godta',
                    // Finnish
                    'hyväksy kaikki', 'hyväksy',
                    // Indonesian
                    'terima semua', 'setuju', 'saya setuju',
                    // Malay
                    'terima semua', 'setuju',
                    // Thai
                    'ยอมรับทั้งหมด', 'ยอมรับ',
                    // Vietnamese
                    'chấp nhận tất cả', 'đồng ý',
                    // Filipino/Tagalog
                    'tanggapin lahat', 'sumang-ayon',
                    // Japanese
                    'すべて同意する', '同意する',
                    // Korean
                    '모두 동의', '동의'
                ],
                // Common aria-label patterns
                ariaLabels: [
                    'consent', 'accept', 'agree',
                    'cookie', 'privacy', 'terms',
                    'persetujuan', 'setuju',  // Indonesian
                    'ยอมรับ',  // Thai
                    'đồng ý',  // Vietnamese
                    '同意'     // Japanese/Chinese
                ]
            };

            // Finds the accept button by text or aria-label
            const findAcceptButton = () => {
                // Get all buttons on the page
                const buttons = Array.from(document.querySelectorAll('button'));

                // Find the accept button
                return buttons.find(button => {
                    // Get the text content and aria-label of the button
                    const text = button.textContent?.toLowerCase() || '';
                    const label = button.getAttribute('aria-label')?.toLowerCase() || '';

                    // Check for matching text patterns
                    const hasMatchingText = consentPatterns.text.some(pattern =>
                        text.includes(pattern)
                    );

                    // Check for matching aria-labels
                    const hasMatchingLabel = consentPatterns.ariaLabels.some(pattern =>
                        label.includes(pattern)
                    );

                    // Return true if either text or aria-label matches
                    return hasMatchingText || hasMatchingLabel;
                });
            };

            // Find the accept button
            const acceptButton = findAcceptButton();

            // If an accept button is found, click it
            if (acceptButton) {
                acceptButton.click();
            }
        });
    } catch (error) {
        console.log('Consent handling failed:', error);
    }
}

/**
 * Safe page navigation with error handling, security checks, and bot detection
 * 
 * This function performs robust navigation to a URL with multiple safety checks:
 * 1. Sets cookies to bypass common consent banners
 * 2. Validates response status codes
 * 3. Waits for proper page load states
 * 4. Detects bot protection mechanisms
 * 5. Validates content quality
 * 
 * @param page - Playwright Page object to use for navigation
 * @param url - URL to navigate to
 * @throws Error if navigation fails for any reason (status code, bot detection, etc.)
 */
export async function safePageNavigation(page: Page, url: string): Promise<void> {
    try {
        // Step 1: Set cookies to bypass consent banner
        await page.context().addCookies([{
            name: 'CONSENT',
            value: 'YES+',
            domain: '.google.com',
            path: '/'
        }]);

        // Step 2: Initial navigation
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        // Step 3: Basic response validation
        if (!response) {
            throw new Error('Navigation failed: no response received');
        }

        // Check HTTP status code; if 400 or higher, throw an error
        const status = response.status();
        if (status >= 400) {
            throw new Error(`HTTP ${status}: ${response.statusText()}`);
        }

        // Step 4: Wait for network to become idle or timeout
        await Promise.race([
            page.waitForLoadState('networkidle', { timeout: 5000 })
                .catch(() => {/* ignore timeout */ }),
            // Fallback timeout in case networkidle never occurs
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

        // Step 5: Security and content validation
        const validation = await page.evaluate(() => {
            const botProtectionExists = [
                '#challenge-running',     // Cloudflare
                '#cf-challenge-running',  // Cloudflare
                '#px-captcha',            // PerimeterX
                '#ddos-protection',       // Various
                '#waf-challenge-html'     // Various WAFs
            ].some(selector => document.querySelector(selector));

            // Check for suspicious page titles
            const suspiciousTitle = [
                'security check',
                'ddos protection',
                'please wait',
                'just a moment',
                'attention required'
            ].some(phrase => document.title.toLowerCase().includes(phrase));

            // Count words in the page content
            const bodyText = document.body.innerText || '';
            const words = bodyText.trim().split(/\s+/).length;

            // Return validation results
            return {
                wordCount: words,
                botProtection: botProtectionExists,
                suspiciousTitle,
                title: document.title
            };
        });

        // If bot protection is detected, throw an error
        if (validation.botProtection) {
            throw new Error('Bot protection detected');
        }

        // If the page title is suspicious, throw an error
        if (validation.suspiciousTitle) {
            throw new Error(`Suspicious page title detected: "${validation.title}"`);
        }

        // If the page contains insufficient content, throw an error
        if (validation.wordCount < 10) {
            throw new Error('Page contains insufficient content');
        }

    } catch (error) {
        // If an error occurs during navigation, throw an error with the URL and the error message
        throw new Error(`Navigation to ${url} failed: ${(error as Error).message}`);
    }
}

/**
 * Closes the browser instance and cleans up resources
 * 
 * This function safely closes the browser instance and resets
 * the global browser and page references. It's important to call
 * this function when done with browser operations to free up resources.
 */
export async function closeBrowser(): Promise<void> {
    try {
        if (browser) {
            await browser.close();
        }
    } catch (error) {
        console.error('Error closing browser:', error);
    } finally {
        browser = undefined;
        page = undefined;
    }
}