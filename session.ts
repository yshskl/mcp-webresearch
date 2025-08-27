/**
 * Research Session Management Module
 * 
 * This module handles the management of research session data, including search queries,
 * visited pages, and the storage and retrieval of research results. It provides functionality
 * for creating, updating, and clearing research sessions.
 */

/**
 * Interface representing a single research result
 * 
 * This interface defines the structure of a research result obtained from visiting
 * a web page, containing metadata, extracted content, and optional media references.
 */
export interface ResearchResult {
    /** URL of the researched web page */
    url: string;
    
    /** Title of the researched web page */
    title: string;
    
    /** Content extracted from the page, formatted as markdown */
    content: string;
    
    /** ISO timestamp when the result was captured */
    timestamp: string;
    
    /** Optional path to screenshot file stored on disk */
    screenshotPath?: string;
}

/**
 * Interface representing a complete research session
 * 
 * This interface defines the structure of a research session, which contains
 * the initial search query, a collection of research results, and metadata
 * about the session's state and timing.
 */
export interface ResearchSession {
    /** Search query that initiated the research session */
    query: string;
    
    /** Collection of research results gathered during the session */
    results: ResearchResult[];
    
    /** ISO timestamp of when the session was last updated */
    lastUpdated: string;
}

/**
 * Maximum number of results to store per research session
 * 
 * This constant limits the number of results kept in memory for a single session
 * to prevent excessive memory usage. When the limit is reached, older results are removed.
 */
export const MAX_RESULTS_PER_SESSION = 100;

/**
 * Current active research session
 * 
 * This variable holds the state of the currently active research session, if one exists.
 * It contains all the results and metadata for the ongoing research process.
 */
export let currentSession: ResearchSession | undefined;

/**
 * Adds a new research result to the current session with automatic data management
 * 
 * This function adds a research result to the current session, initializing a new session
 * if one doesn't exist. It also handles result limits by removing the oldest result when
 * the maximum capacity is reached.
 * 
 * @param result - Research result object to add to the session
 */
export function addResult(result: ResearchResult): void {
    // If no current session exists, initialize a new one
    if (!currentSession) {
        currentSession = {
            query: "Research Session",
            results: [],
            lastUpdated: new Date().toISOString(),
        };
    }

    // If the session has reached the maximum number of results, remove the oldest result
    if (currentSession.results.length >= MAX_RESULTS_PER_SESSION) {
        currentSession.results.shift();
    }

    // Add the new result to the session and update the last updated timestamp
    currentSession.results.push(result);
    currentSession.lastUpdated = new Date().toISOString();
}

/**
 * Creates a new research session with the specified query
 * 
 * This function initializes a new research session, replacing any existing session.
 * It sets up an empty result set and records the initial search query.
 * 
 * @param query - Initial search query to associate with the new session
 */
export function createSession(query: string): void {
    currentSession = {
        query,
        results: [],
        lastUpdated: new Date().toISOString(),
    };
}

/**
 * Clears the current research session
 * 
 * This function removes the current research session from memory, effectively
 * resetting the research state. It does not perform any cleanup of associated
 * files like screenshots.
 */
export function clearSession(): void {
    currentSession = undefined;
}