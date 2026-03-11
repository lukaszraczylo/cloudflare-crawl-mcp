# @lukaszraczylo/cloudflare-crawl-mcp

<p align="center">
  <a href="https://www.npmjs.com/package/@lukaszraczylo/cloudflare-crawl-mcp">
    <img src="https://img.shields.io/npm/v/@lukaszraczylo/cloudflare-crawl-mcp" alt="NPM Version">
  </a>
  <a href="https://github.com/lukaszraczylo/cloudflare-crawl-mcp/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
</p>

MCP server for crawling websites using Cloudflare Browser Rendering API. Supports multiple output formats including Markdown, HTML, and JSON.

## Features

- **Multiple Output Formats**: Choose between Markdown, HTML, or JSON output
- **Configurable Crawling**: Control depth, page limits, and link following
- **Pattern Filtering**: Include/exclude URLs using wildcard patterns
- **JavaScript Rendering**: Execute JavaScript for dynamic content (or disable for static content)
- **Environment-Based Secrets**: Securely manage credentials via environment variables

## Prerequisites

- Node.js 18+
- Cloudflare account with Browser Rendering API access
- Cloudflare API Token with `Browser Rendering` permissions
- Cloudflare Account ID

## Quick Start

```bash
# Clone and setup
npm install
npm run build

# Run with environment variables
CF_API_TOKEN=your_token CF_ACCOUNT_ID=your_account_id npm start
```

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/lukaszraczylo/cloudflare-crawl-mcp.git
cd cloudflare-crawl-mcp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Server

```bash
npm run build
```

### 4. Configure Environment Variables

Copy the example environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Cloudflare credentials:

```
CF_API_TOKEN=your_cloudflare_api_token
CF_ACCOUNT_ID=your_cloudflare_account_id
```

#### Getting Cloudflare Credentials

1. **Account ID**: Find it at https://dash.cloudflare.com/_/account
2. **API Token**: Create one at https://dash.cloudflare.com/profile/api-tokens with these permissions:
   - `Account` > `Browser Rendering` > `Edit`

## MCP Configuration

### Claude Desktop (macOS)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cloudflare-crawl": {
      "command": "npm",
      "args": ["start"],
      "env": {
        "CF_API_TOKEN": "your_api_token",
        "CF_ACCOUNT_ID": "your_account_id"
      },
      "path": "/path/to/cloudflare-crawl-mcp"
    }
  }
}
```

### Claude Code (CLI)

```json
{
  "mcpServers": {
    "cloudflare-crawl": {
      "command": "npm",
      "args": ["start"],
      "env": {
        "CF_API_TOKEN": "your_api_token",
        "CF_ACCOUNT_ID": "your_account_id"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/settings.json` (MCP configuration):

```json
{
  "mcpServers": {
    "cloudflare-crawl": {
      "command": "npm",
      "args": ["start"],
      "env": {
        "CF_API_TOKEN": "your_api_token",
        "CF_ACCOUNT_ID": "your_account_id"
      },
      "path": "/path/to/cloudflare-crawl-mcp"
    }
  }
}
```

## Available Tools

### crawl_url_markdown

Crawl a website and return content in **Markdown** format.

```typescript
{
  "name": "crawl_url_markdown",
  "arguments": {
    "url": "https://example.com/docs",
    "limit": 50,
    "depth": 2,
    "includePatterns": ["https://example.com/docs/**"],
    "excludePatterns": ["https://example.com/docs/archive/**"],
    "render": true
  }
}
```

### crawl_url_html

Crawl a website and return content in **HTML** format.

```typescript
{
  "name": "crawl_url_html",
  "arguments": {
    "url": "https://example.com",
    "limit": 10
  }
}
```

### crawl_url_json

Crawl a website and return content in **JSON** format (uses Workers AI for data extraction).

```typescript
{
  "name": "crawl_url_json",
  "arguments": {
    "url": "https://example.com/products",
    "limit": 20
  }
}
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | Starting URL to crawl |
| `limit` | number | 10 | Maximum pages to crawl (max: 100,000) |
| `depth` | number | 1 | Maximum link depth from starting URL |
| `includeSubdomains` | boolean | false | Follow links to subdomains |
| `includeExternalLinks` | boolean | false | Follow links to external domains |
| `includePatterns` | string[] | [] | Wildcard patterns to include |
| `excludePatterns` | string[] | [] | Wildcard patterns to exclude |
| `render` | boolean | true | Execute JavaScript (false = faster static fetch) |

### Pattern Syntax

- `*` - Matches any characters except `/`
- `**` - Matches any characters including `/`

Examples:
- `https://example.com/docs/**` - All URLs under /docs
- `https://example.com/*.html` - All HTML files directly in root

## Development

### Commands

```bash
npm run build        # Build TypeScript
npm start           # Run server
npm test            # Run tests
npm run test:watch  # Run tests in watch mode
```

### Testing

The project includes comprehensive tests covering:

- Environment variable handling
- Crawl options building
- Result formatting (Markdown, HTML, JSON)
- Error handling
- API integration

Run tests:
```bash
npm test
```

## Architecture

```
src/
├── index.ts          # Main MCP server implementation
│
├── API Layer
│   ├── initiateCrawl()    # POST to /crawl endpoint
│   ├── waitForCrawl()     # Poll for job completion
│   └── getCrawlResults()  # Fetch final results
│
├── Formatters
│   ├── formatMarkdownResult()
│   ├── formatHtmlResult()
│   └── formatJsonResult()
│
└── MCP Handlers
    ├── ListToolsRequestSchema    # Tool registration
    └── CallToolRequestSchema     # Tool execution
```

## Cloudflare Limits

- **Max crawl duration**: 7 days
- **Results available**: 14 days after completion
- **Max pages per job**: 100,000
- **Free plan**: 10 minutes of browser time per day

See [Cloudflare Browser Rendering Limits](https://developers.cloudflare.com/browser-rendering/limits/) for details.

## Troubleshooting

### Crawl returns no results

- Check `robots.txt` blocking (use `render: false` to bypass)
- Verify `includePatterns` match actual URLs
- Try increasing `depth` or disabling pattern filters

### Job cancelled due to limits

- Upgrade to Workers Paid plan
- Use `render: false` for static content
- Reduce `limit` parameter

### Authentication errors

- Verify API Token has Browser Rendering permissions
- Confirm Account ID is correct

## License

MIT License - see [LICENSE](LICENSE) file.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs at https://github.com/lukaszraczylo/cloudflare-crawl-mcp.

## Support

- Open an issue at https://github.com/lukaszraczylo/cloudflare-crawl-mcp/issues
- Check Cloudflare's [Browser Rendering Docs](https://developers.cloudflare.com/browser-rendering/) for API details
