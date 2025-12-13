/**
 * WebFetch Tool
 *
 * Fetches content from URLs and processes it for analysis.
 * Converts HTML to markdown and can extract specific information.
 */

import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";

// Simple HTML to text converter (basic implementation)
function htmlToText(html) {
  return html
    // Remove script and style elements
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert common block elements to newlines
    .replace(/<\/?(div|p|br|hr|h[1-6]|ul|ol|li|blockquote|pre|table|tr)[^>]*>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

// Simple HTML to Markdown converter
function htmlToMarkdown(html) {
  return html
    // Remove script and style
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Convert headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n')
    // Convert emphasis
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    // Convert links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    // Convert code
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, '```\n$1\n```')
    // Convert lists
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/?[uo]l[^>]*>/gi, '\n')
    // Convert paragraphs and breaks
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Clean entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Clean whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * WebFetch Tool Implementation
 */
export class WebFetchTool extends BaseTool {
  constructor() {
    super({
      name: "WebFetch",
      description: `Fetches content from a specified URL and processes it.
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt
- Returns the processed content

Usage notes:
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- The prompt should describe what information you want to extract
- Results may be summarized if the content is very large
- Includes a self-cleaning 15-minute cache for faster responses
- When a URL redirects to a different host, make a new request with the redirect URL`,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            format: "uri",
            description: "The URL to fetch content from"
          },
          prompt: {
            type: "string",
            description: "The prompt to run on the fetched content"
          }
        },
        required: ["url", "prompt"]
      },
      requiresPermission: false
    });

    // Simple cache
    this.cache = new Map();
    this.cacheTimeout = 15 * 60 * 1000; // 15 minutes
  }

  /**
   * Validate URL
   * @param {string} url - URL to validate
   * @returns {URL|null} Parsed URL or null if invalid
   */
  validateUrl(url) {
    try {
      const parsed = new URL(url);
      // Upgrade HTTP to HTTPS
      if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
      }
      if (parsed.protocol !== 'https:') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Get cached content
   * @param {string} url - URL key
   * @returns {object|null} Cached content or null
   */
  getCached(url) {
    const entry = this.cache.get(url);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheTimeout) {
      this.cache.delete(url);
      return null;
    }

    return entry.content;
  }

  /**
   * Set cached content
   * @param {string} url - URL key
   * @param {object} content - Content to cache
   */
  setCache(url, content) {
    // Clean old entries
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }

    this.cache.set(url, { content, timestamp: now });
  }

  /**
   * Execute the web fetch
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { url, prompt } = input;

    debug(`WebFetch: Fetching ${url}`);

    // Validate URL
    const parsedUrl = this.validateUrl(url);
    if (!parsedUrl) {
      return this.error("Invalid URL. Must be a valid HTTP/HTTPS URL.");
    }

    const urlString = parsedUrl.toString();

    // Check cache
    const cached = this.getCached(urlString);
    if (cached) {
      debug("WebFetch: Using cached content");
      return this.success({
        url: urlString,
        prompt,
        content: cached,
        cached: true
      });
    }

    try {
      // Fetch the URL
      const response = await fetch(urlString, {
        headers: {
          'User-Agent': 'Claude-Code/2.0 (WebFetch Tool)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      // Check for redirects to different host
      const finalUrl = new URL(response.url);
      if (finalUrl.host !== parsedUrl.host) {
        return this.success({
          redirect: true,
          originalUrl: urlString,
          redirectUrl: response.url,
          message: `URL redirected to a different host. Please make a new WebFetch request with: ${response.url}`
        });
      }

      if (!response.ok) {
        return this.error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      // Process based on content type
      let processedContent;
      if (contentType.includes('text/html')) {
        processedContent = htmlToMarkdown(text);
      } else if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(text);
          processedContent = JSON.stringify(json, null, 2);
        } catch {
          processedContent = text;
        }
      } else {
        processedContent = text;
      }

      // Truncate if too long
      const maxLength = 50000;
      if (processedContent.length > maxLength) {
        processedContent = processedContent.substring(0, maxLength) +
          `\n\n... [Content truncated - ${processedContent.length - maxLength} characters omitted]`;
      }

      // Cache the result
      this.setCache(urlString, processedContent);

      debug(`WebFetch: Fetched ${processedContent.length} characters`);

      return this.success({
        url: urlString,
        prompt,
        content: processedContent,
        contentType,
        length: processedContent.length
      });
    } catch (err) {
      debug(`WebFetch error: ${err.message}`);

      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return this.error("Request timed out after 30 seconds");
      }

      return this.error(`Failed to fetch URL: ${err.message}`);
    }
  }
}

// Export singleton instance
export const webFetchTool = new WebFetchTool();

export default WebFetchTool;
