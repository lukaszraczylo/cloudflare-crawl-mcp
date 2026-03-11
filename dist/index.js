import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
const API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 10000;
let lastRequestTime = 0;
let requestCount = 0;
let windowStart = Date.now();
function getEnv(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
async function enforceRateLimit() {
    const now = Date.now();
    const windowDuration = 60000;
    if (now - windowStart >= windowDuration) {
        requestCount = 0;
        windowStart = now;
    }
    const requestsPerMinute = parseInt(process.env.CF_RATE_LIMIT || "6", 10);
    if (requestCount >= requestsPerMinute) {
        const waitTime = windowDuration - (now - windowStart);
        console.error(`Rate limit reached (${requestsPerMinute}/min). Waiting ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        requestCount = 0;
        windowStart = Date.now();
    }
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS && requestCount > 0) {
        const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastRequestTime = Date.now();
    requestCount++;
}
async function fetchWithRetry(fn, retries = MAX_RETRIES) {
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const errorStr = error.message || "";
            const isRateLimit = errorStr.includes("429") ||
                errorStr.includes("Rate limit");
            if (!isRateLimit || attempt === retries - 1) {
                throw error;
            }
            const retryAfterMatch = errorStr.match(/Retry-After[:\s]*(\d+)/i);
            const delay = retryAfterMatch
                ? parseInt(retryAfterMatch[1], 10) * 1000
                : Math.min(1000 * Math.pow(2, attempt), 30000);
            console.error(`Rate limited. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
async function initiateCrawl(accountId, apiToken, options) {
    await enforceRateLimit();
    return fetchWithRetry(async () => {
        const response = await fetch(`${API_BASE}/accounts/${accountId}/browser-rendering/crawl`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url: options.url,
                limit: options.limit ?? 10,
                depth: options.depth ?? 1,
                formats: options.formats ?? ["markdown"],
                render: options.render ?? true,
                maxAge: options.maxAge,
                source: options.source ?? "all",
                options: options.options ?? {},
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            const retryAfter = response.headers.get("Retry-After");
            const errorMsg = `Failed to initiate crawl: ${response.status} ${error}${retryAfter ? ` Retry-After: ${retryAfter}` : ""}`;
            throw new Error(errorMsg);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(`Crawl initiation failed: ${JSON.stringify(data.errors)}`);
        }
        return data.result.id;
    });
}
async function waitForCrawl(accountId, apiToken, jobId, maxAttempts = 120, delayMs = 5000) {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await fetch(`${API_BASE}/accounts/${accountId}/browser-rendering/crawl/${jobId}?limit=1`, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to check crawl status: ${response.status} ${error}`);
        }
        const data = await response.json();
        const status = data.result.status;
        if (status !== "running") {
            return data.result;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error("Crawl job did not complete within timeout");
}
function buildCrawlOptions(args, formats) {
    return {
        url: args.url,
        limit: args.limit,
        depth: args.depth,
        formats,
        render: args.render,
        options: {
            includeExternalLinks: args.includeExternalLinks,
            includeSubdomains: args.includeSubdomains,
            includePatterns: args.includePatterns,
            excludePatterns: args.excludePatterns,
        },
    };
}
function formatMarkdownResult(result) {
    const records = result.records || [];
    const completedRecords = records.filter((r) => r.status === "completed");
    const content = completedRecords
        .map((record) => {
        const title = record.metadata?.title || record.url;
        return `## ${title}\n\nURL: ${record.url}\n\n${record.markdown || ""}\n\n---\n`;
    })
        .join("\n");
    return `Crawl completed: ${completedRecords.length} of ${result.total} pages crawled successfully.\n\n${content}`;
}
function formatHtmlResult(result) {
    const records = result.records || [];
    const completedRecords = records.filter((r) => r.status === "completed");
    const content = completedRecords
        .map((record) => {
        const title = record.metadata?.title || record.url;
        return `<article>\n  <h2>${title}</h2>\n  <p>Source: <a href="${record.url}">${record.url}</a></p>\n  <div class="content">${record.html || ""}</div>\n</article>\n`;
    })
        .join("\n");
    return `Crawl completed: ${completedRecords.length} of ${result.total} pages crawled successfully.\n\n${content}`;
}
function formatJsonResult(result) {
    const records = result.records || [];
    const completedRecords = records.filter((r) => r.status === "completed");
    const jsonOutput = {
        summary: {
            total: result.total,
            completed: completedRecords.length,
            status: result.status,
        },
        pages: completedRecords.map((record) => ({
            url: record.url,
            title: record.metadata?.title,
            status: record.metadata?.status,
            markdown: record.markdown,
            html: record.html,
            json: record.json,
        })),
    };
    return JSON.stringify(jsonOutput, null, 2);
}
function handleErrorResult(result, jobId) {
    const errorMessages = {
        errored: `Crawl job errored. Job ID: ${jobId}`,
        cancelled_due_to_timeout: `Crawl job cancelled due to timeout (7 days max). Job ID: ${jobId}`,
        cancelled_due_to_limits: `Crawl job cancelled due to account limits. Job ID: ${jobId}`,
        cancelled_by_user: `Crawl job was cancelled by user. Job ID: ${jobId}`,
    };
    const message = errorMessages[result.status] || `Crawl job failed with status: ${result.status}. Job ID: ${jobId}`;
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}
const server = new Server({
    name: "cloudflare-crawl-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
const baseToolSchema = {
    type: "object",
    properties: {
        url: {
            type: "string",
            description: "The starting URL to crawl",
        },
        limit: {
            type: "number",
            description: "Maximum number of pages to crawl (default: 10, max: 100000)",
        },
        depth: {
            type: "number",
            description: "Maximum link depth to crawl from the starting URL (default: 1)",
        },
        includeSubdomains: {
            type: "boolean",
            description: "If true, follows links to subdomains of the starting URL (default: false)",
        },
        includeExternalLinks: {
            type: "boolean",
            description: "If true, follows links to external domains (default: false)",
        },
        includePatterns: {
            type: "array",
            items: { type: "string" },
            description: "Only visits URLs that match one of these wildcard patterns",
        },
        excludePatterns: {
            type: "array",
            items: { type: "string" },
            description: "Does not visit URLs that match any of these wildcard patterns",
        },
        render: {
            type: "boolean",
            description: "If false, does a fast HTML fetch without executing JavaScript (default: true)",
        },
    },
    required: ["url"],
};
const RATE_LIMIT_INFO = `
---
**Cloudflare Browser Rendering Limits:**

| Plan | Concurrent Browsers | Browser Time | REST API Rate |
|------|---------------------|--------------|---------------|
| Free | 3 | 10 min/day | 6 req/min |
| Paid | 10 | 10 hours/month | 600 req/min |

**Environment Variables:**
- CF_RATE_LIMIT: Override REST API requests per minute (default: 6 for Free, 600 for Paid)

**Tips:**
- Use \`render: false\` for static content to avoid browser time usage
- Use \`maxAge\` to cache results and reduce API calls
- Set \`limit\` and \`depth\` appropriately to stay within limits
---`;
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "crawl_url_markdown",
                description: `Crawl a website using Cloudflare Browser Rendering and return content in Markdown format. Supports following links across the site up to a configurable depth or page limit.${RATE_LIMIT_INFO}`,
                inputSchema: {
                    ...baseToolSchema,
                    properties: {
                        ...baseToolSchema.properties,
                    },
                },
            },
            {
                name: "crawl_url_html",
                description: `Crawl a website using Cloudflare Browser Rendering and return content in HTML format. Supports following links across the site up to a configurable depth or page limit.${RATE_LIMIT_INFO}`,
                inputSchema: baseToolSchema,
            },
            {
                name: "crawl_url_json",
                description: `Crawl a website using Cloudflare Browser Rendering and return content in JSON format. This uses Workers AI for data extraction. Supports following links across the site up to a configurable depth or page limit.${RATE_LIMIT_INFO}`,
                inputSchema: baseToolSchema,
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolMatch = name.match(/^crawl_url_(markdown|html|json)$/);
    if (!toolMatch) {
        return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
        };
    }
    const format = toolMatch[1];
    const formatMap = {
        markdown: ["markdown"],
        html: ["html"],
        json: ["json"],
    };
    const formats = formatMap[format];
    try {
        const apiToken = getEnv("CF_API_TOKEN");
        const accountId = getEnv("CF_ACCOUNT_ID");
        const crawlArgs = {
            url: args.url,
            limit: args.limit,
            depth: args.depth,
            includeSubdomains: args.includeSubdomains,
            includeExternalLinks: args.includeExternalLinks,
            includePatterns: args.includePatterns,
            excludePatterns: args.excludePatterns,
            render: args.render,
        };
        const options = buildCrawlOptions(crawlArgs, formats);
        const jobId = await initiateCrawl(accountId, apiToken, options);
        const result = await waitForCrawl(accountId, apiToken, jobId);
        const terminalStatuses = ["errored", "cancelled_due_to_timeout", "cancelled_due_to_limits", "cancelled_by_user"];
        if (terminalStatuses.includes(result.status)) {
            return handleErrorResult(result, jobId);
        }
        const formatterMap = {
            markdown: formatMarkdownResult,
            html: formatHtmlResult,
            json: formatJsonResult,
        };
        const formattedContent = formatterMap[format](result);
        return {
            content: [{ type: "text", text: formattedContent }],
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
