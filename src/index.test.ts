import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const API_BASE = "https://api.cloudflare.com/client/v4";

interface CrawlOptions {
  url: string;
  limit?: number;
  depth?: number;
  formats?: string[];
  render?: boolean;
  maxAge?: number;
  source?: string;
  options?: {
    includeExternalLinks?: boolean;
    includeSubdomains?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
  };
}

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function initiateCrawl(
  accountId: string,
  apiToken: string,
  options: CrawlOptions
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/browser-rendering/crawl`,
    {
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
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to initiate crawl: ${response.status} ${error}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(`Crawl initiation failed: ${JSON.stringify(data.errors)}`);
  }

  return data.result.id;
}

async function waitForCrawl(
  accountId: string,
  apiToken: string,
  jobId: string,
  maxAttempts: number = 120,
  delayMs: number = 5000
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `${API_BASE}/accounts/${accountId}/browser-rendering/crawl/${jobId}?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

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

interface CrawlArgs {
  url: string;
  limit?: number;
  depth?: number;
  includeSubdomains?: boolean;
  includeExternalLinks?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  render?: boolean;
}

function buildCrawlOptions(args: CrawlArgs, formats: string[]): CrawlOptions {
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

function formatMarkdownResult(result: any): string {
  const records = result.records || [];
  const completedRecords = records.filter((r: any) => r.status === "completed");

  const content = completedRecords
    .map((record: any) => {
      const title = record.metadata?.title || record.url;
      return `## ${title}\n\nURL: ${record.url}\n\n${record.markdown || ""}\n\n---\n`;
    })
    .join("\n");

  return `Crawl completed: ${completedRecords.length} of ${result.total} pages crawled successfully.\n\n${content}`;
}

function formatHtmlResult(result: any): string {
  const records = result.records || [];
  const completedRecords = records.filter((r: any) => r.status === "completed");

  const content = completedRecords
    .map((record: any) => {
      const title = record.metadata?.title || record.url;
      return `<article>\n  <h2>${title}</h2>\n  <p>Source: <a href="${record.url}">${record.url}</a></p>\n  <div class="content">${record.html || ""}</div>\n</article>\n`;
    })
    .join("\n");

  return `Crawl completed: ${completedRecords.length} of ${result.total} pages crawled successfully.\n\n${content}`;
}

function formatJsonResult(result: any): string {
  const records = result.records || [];
  const completedRecords = records.filter((r: any) => r.status === "completed");

  const jsonOutput = {
    summary: {
      total: result.total,
      completed: completedRecords.length,
      status: result.status,
    },
    pages: completedRecords.map((record: any) => ({
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

function handleErrorResult(result: any, jobId: string): { content: any[]; isError: boolean } {
  const errorMessages: Record<string, string> = {
    errored: `Crawl job errored. Job ID: ${jobId}`,
    cancelled_due_to_timeout: `Crawl job cancelled due to timeout (7 days max). Job ID: ${jobId}`,
    cancelled_due_to_limits: `Crawl job cancelled due to account limits. Job ID: ${jobId}`,
    cancelled_by_user: `Crawl job was cancelled by user. Job ID: ${jobId}`,
  };

  const message = errorMessages[result.status] || `Crawl job failed with status: ${result.status}. Job ID: ${jobId}`;

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

describe('getEnv', () => {
  const testCases = [
    {
      name: 'returns value when env var exists',
      envKey: 'TEST_VAR',
      envValue: 'test-value',
      expected: 'test-value',
    },
    {
      name: 'throws when env var is empty string',
      envKey: 'EMPTY_VAR',
      envValue: '',
      expectedError: 'Missing required environment variable: EMPTY_VAR',
    },
    {
      name: 'throws when env var is undefined',
      envKey: 'UNDEFINED_VAR',
      envValue: undefined,
      expectedError: 'Missing required environment variable: UNDEFINED_VAR',
    },
  ];

  it.each(testCases)('$name', ({ envKey, envValue, expected, expectedError }: { envKey: string; envValue: string | undefined; expected?: string; expectedError?: string }) => {
    if (expectedError) {
      if (envValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = envValue;
      }
      expect(() => getEnv(envKey)).toThrow(expectedError);
    } else {
      process.env[envKey] = envValue;
      expect(getEnv(envKey)).toBe(expected);
    }
  });
});

describe('buildCrawlOptions', () => {
  const testCases = [
    {
      name: 'builds options with markdown format',
      args: { url: 'https://example.com' },
      formats: ['markdown'],
      expected: {
        url: 'https://example.com',
        limit: undefined,
        depth: undefined,
        formats: ['markdown'],
        render: undefined,
        options: {
          includeExternalLinks: undefined,
          includeSubdomains: undefined,
          includePatterns: undefined,
          excludePatterns: undefined,
        },
      },
    },
    {
      name: 'builds options with all parameters',
      args: {
        url: 'https://example.com',
        limit: 50,
        depth: 2,
        includeSubdomains: true,
        includeExternalLinks: false,
        includePatterns: ['**/docs/**'],
        excludePatterns: ['**/archive/**'],
        render: true,
      },
      formats: ['html'],
      expected: {
        url: 'https://example.com',
        limit: 50,
        depth: 2,
        formats: ['html'],
        render: true,
        options: {
          includeExternalLinks: false,
          includeSubdomains: true,
          includePatterns: ['**/docs/**'],
          excludePatterns: ['**/archive/**'],
        },
      },
    },
    {
      name: 'builds options with json format',
      args: { url: 'https://api.example.com', limit: 100 },
      formats: ['json'],
      expected: {
        url: 'https://api.example.com',
        limit: 100,
        formats: ['json'],
        depth: undefined,
        render: undefined,
        options: {
          includeExternalLinks: undefined,
          includeSubdomains: undefined,
          includePatterns: undefined,
          excludePatterns: undefined,
        },
      },
    },
    {
      name: 'handles empty options object',
      args: { url: 'https://test.com' },
      formats: ['markdown'],
      expected: {
        url: 'https://test.com',
        formats: ['markdown'],
        options: {
          includeExternalLinks: undefined,
          includeSubdomains: undefined,
          includePatterns: undefined,
          excludePatterns: undefined,
        },
      },
    },
  ];

  it.each(testCases)('$name', ({ args, formats, expected }: { args: CrawlArgs; formats: string[]; expected: CrawlOptions }) => {
    const result = buildCrawlOptions(args, formats);
    expect(result).toEqual(expected);
  });
});

describe('formatMarkdownResult', () => {
  const testCases: Array<{ name: string; result: any; expectedContains: string[] }> = [
    {
      name: 'formats single completed page',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            markdown: '# Hello World',
            metadata: { title: 'Home Page', status: 200 },
          },
        ],
      },
      expectedContains: ['## Home Page', '# Hello World', 'Crawl completed: 1 of 1'],
    },
    {
      name: 'formats multiple completed pages',
      result: {
        total: 2,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            markdown: '# Page 1',
            metadata: { title: 'Page One', status: 200 },
          },
          {
            url: 'https://example.com/about',
            status: 'completed',
            markdown: '# About Us',
            metadata: { title: 'About', status: 200 },
          },
        ],
      },
      expectedContains: ['## Page One', '## About', 'Crawl completed: 2 of 2'],
    },
    {
      name: 'handles missing markdown content',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            markdown: '',
            metadata: { title: 'Test', status: 200 },
          },
        ],
      },
      expectedContains: ['## Test', 'URL: https://example.com'],
    },
    {
      name: 'uses url as title when metadata.title is missing',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com/unnamed',
            status: 'completed',
            markdown: 'Content here',
          },
        ],
      },
      expectedContains: ['## https://example.com/unnamed', 'Content here'],
    },
    {
      name: 'handles empty records array',
      result: {
        total: 0,
        status: 'completed',
        records: [],
      },
      expectedContains: ['Crawl completed: 0 of 0'],
    },
    {
      name: 'filters out non-completed records',
      result: {
        total: 3,
        status: 'completed',
        records: [
          { url: 'https://example.com/1', status: 'completed', markdown: '# Done' },
          { url: 'https://example.com/2', status: 'errored', markdown: '# Failed' },
          { url: 'https://example.com/3', status: 'skipped' },
        ],
      },
      expectedContains: ['Crawl completed: 1 of 3', '# Done'],
    },
  ];

  it.each(testCases)('$name', ({ result, expectedContains }: { result: any; expectedContains: string[] }) => {
    const output = formatMarkdownResult(result);
    expectedContains.forEach((expected) => {
      expect(output).toContain(expected);
    });
  });
});

describe('formatHtmlResult', () => {
  const testCases: Array<{ name: string; result: any; expectedContains: string[] }> = [
    {
      name: 'formats single completed page with HTML',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            html: '<p>Hello World</p>',
            metadata: { title: 'Home Page', status: 200 },
          },
        ],
      },
      expectedContains: ['<h2>Home Page</h2>', '<p>Hello World</p>', 'Crawl completed: 1 of 1'],
    },
    {
      name: 'formats multiple completed pages',
      result: {
        total: 2,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            html: '<div>Page 1</div>',
            metadata: { title: 'Page One', status: 200 },
          },
          {
            url: 'https://example.com/about',
            status: 'completed',
            html: '<div>About Us</div>',
            metadata: { title: 'About', status: 200 },
          },
        ],
      },
      expectedContains: ['<h2>Page One</h2>', '<h2>About</h2>', 'Crawl completed: 2 of 2'],
    },
    {
      name: 'handles missing HTML content',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            html: '',
            metadata: { title: 'Test', status: 200 },
          },
        ],
      },
      expectedContains: ['<h2>Test</h2>', '<a href="https://example.com">'],
    },
  ];

  it.each(testCases)('$name', ({ result, expectedContains }: { result: any; expectedContains: string[] }) => {
    const output = formatHtmlResult(result);
    expectedContains.forEach((expected) => {
      expect(output).toContain(expected);
    });
  });
});

describe('formatJsonResult', () => {
  const testCases: Array<{ name: string; result: any }> = [
    {
      name: 'formats single completed page as JSON',
      result: {
        total: 1,
        status: 'completed',
        records: [
          {
            url: 'https://example.com',
            status: 'completed',
            markdown: '# Hello',
            html: '<h1>Hello</h1>',
            json: { key: 'value' },
            metadata: { title: 'Home', status: 200 },
          },
        ],
      },
    },
    {
      name: 'formats multiple completed pages as JSON',
      result: {
        total: 2,
        status: 'completed',
        records: [
          {
            url: 'https://example.com/page1',
            status: 'completed',
            markdown: '# Page 1',
          },
          {
            url: 'https://example.com/page2',
            status: 'completed',
            markdown: '# Page 2',
          },
        ],
      },
    },
    {
      name: 'includes summary with correct counts',
      result: {
        total: 5,
        status: 'completed',
        records: [
          { url: 'https://example.com/1', status: 'completed' },
          { url: 'https://example.com/2', status: 'completed' },
          { url: 'https://example.com/3', status: 'errored' },
          { url: 'https://example.com/4', status: 'skipped' },
          { url: 'https://example.com/5', status: 'completed' },
        ],
      },
    },
    {
      name: 'handles empty records',
      result: {
        total: 0,
        status: 'completed',
        records: [],
      },
    },
  ];

  it.each(testCases)('$name', ({ result }: { result: any }) => {
    const output = formatJsonResult(result);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('pages');

    const completedCount = result.records.filter((r: any) => r.status === 'completed').length;
    expect(parsed.summary.completed).toBe(completedCount);
    expect(parsed.summary.total).toBe(result.total);
    expect(parsed.summary.status).toBe(result.status);
  });
});

describe('handleErrorResult', () => {
  const testCases: Array<{ name: string; result: any; jobId: string; expectedError: boolean; expectedContains: string[] }> = [
    {
      name: 'handles errored status',
      result: { status: 'errored' },
      jobId: 'test-job-123',
      expectedError: true,
      expectedContains: ['errored', 'test-job-123'],
    },
    {
      name: 'handles cancelled_due_to_timeout status',
      result: { status: 'cancelled_due_to_timeout' },
      jobId: 'job-456',
      expectedError: true,
      expectedContains: ['timeout', 'job-456'],
    },
    {
      name: 'handles cancelled_due_to_limits status',
      result: { status: 'cancelled_due_to_limits' },
      jobId: 'job-789',
      expectedError: true,
      expectedContains: ['limits', 'job-789'],
    },
    {
      name: 'handles cancelled_by_user status',
      result: { status: 'cancelled_by_user' },
      jobId: 'job-000',
      expectedError: true,
      expectedContains: ['cancelled by user', 'job-000'],
    },
    {
      name: 'handles unknown status',
      result: { status: 'some_unknown_status' },
      jobId: 'job-unknown',
      expectedError: true,
      expectedContains: ['some_unknown_status', 'job-unknown'],
    },
  ];

  it.each(testCases)('$name', ({ result, jobId, expectedError, expectedContains }: { result: any; jobId: string; expectedError: boolean; expectedContains: string[] }) => {
    const output = handleErrorResult(result, jobId);
    expect(output.isError).toBe(expectedError);
    expectedContains.forEach((expected) => {
      expect(output.content[0].text).toContain(expected);
    });
  });
});

describe('initiateCrawl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  const testCases: Array<{ name: string; accountId: string; apiToken: string; options: CrawlOptions; mockResponse: any; mockStatus?: number; expectedJobId?: string; expectedError?: string }> = [
    {
      name: 'initiates crawl successfully',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      options: { url: 'https://example.com', formats: ['markdown'] },
      mockResponse: { success: true, result: { id: 'job-123' } },
      expectedJobId: 'job-123',
    },
    {
      name: 'throws on HTTP error',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      options: { url: 'https://example.com' },
      mockResponse: null,
      mockStatus: 401,
      expectedError: 'Failed to initiate crawl: 401',
    },
    {
      name: 'throws on API failure',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      options: { url: 'https://example.com' },
      mockResponse: { success: false, errors: [{ message: 'Invalid URL' }] },
      expectedError: 'Crawl initiation failed',
    },
  ];

  it.each(testCases)('$name', async ({ accountId, apiToken, options, mockResponse, mockStatus, expectedJobId, expectedError }: { accountId: string; apiToken: string; options: CrawlOptions; mockResponse: any; mockStatus?: number; expectedJobId?: string; expectedError?: string }) => {
    const fetchMock = vi.mocked(fetch);
    
    if (expectedError) {
      if (mockStatus) {
        fetchMock.mockResolvedValueOnce(new Response('', { status: mockStatus }));
      } else {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      await expect(initiateCrawl(accountId, apiToken, options)).rejects.toThrow(expectedError);
    } else {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
      
      const result = await initiateCrawl(accountId, apiToken, options);
      expect(result).toBe(expectedJobId);
    }
  });
});

describe('waitForCrawl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  const testCases: Array<{
    name: string;
    accountId: string;
    apiToken: string;
    jobId: string;
    mockResponse: any;
    expectedStatus: string;
  }> = [
    {
      name: 'returns completed result immediately',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      jobId: 'job-123',
      mockResponse: { result: { status: 'completed', total: 5, records: [] } },
      expectedStatus: 'completed',
    },
    {
      name: 'returns errored result',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      jobId: 'job-123',
      mockResponse: { result: { status: 'errored', error: 'Something went wrong' } },
      expectedStatus: 'errored',
    },
    {
      name: 'returns cancelled_due_to_limits result',
      accountId: 'acc-123',
      apiToken: 'token-abc',
      jobId: 'job-123',
      mockResponse: { result: { status: 'cancelled_due_to_limits' } },
      expectedStatus: 'cancelled_due_to_limits',
    },
  ];

  it.each(testCases)('$name', async ({ accountId, apiToken, jobId, mockResponse, expectedStatus }: { accountId: string; apiToken: string; jobId: string; mockResponse: any; expectedStatus: string }) => {
    const fetchMock = vi.mocked(fetch);
    
    fetchMock.mockResolvedValue(new Response(JSON.stringify(mockResponse), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const result = await waitForCrawl(accountId, apiToken, jobId, 1, 1);
    expect(result.status).toBe(expectedStatus);
  });
});
