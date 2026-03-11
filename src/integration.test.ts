import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = "https://api.cloudflare.com/client/v4";

interface CrawlOptions {
  url: string;
  limit?: number;
  depth?: number;
  formats?: string[];
  render?: boolean;
  options?: {
    includeExternalLinks?: boolean;
    includeSubdomains?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
  };
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
  maxAttempts: number = 60,
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

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

describe('Integration: Cloudflare Crawl API', () => {
  const apiToken = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;

  const hasCredentials = apiToken && accountId;

  beforeAll(() => {
    if (!hasCredentials) {
      console.log('\n⚠️  Skipping integration tests - CF_API_TOKEN or CF_ACCOUNT_ID not set\n');
    }
  });

  it.skipIf(!hasCredentials)('should crawl raczylo.com with multiple pages in markdown format', async () => {
    const accountId = getEnv("CF_ACCOUNT_ID");
    const apiToken = getEnv("CF_API_TOKEN");

    try {
      const jobId = await initiateCrawl(accountId, apiToken, {
        url: "https://raczylo.com",
        limit: 5,
        depth: 2,
        formats: ["markdown"],
      });

      console.log(`  Started crawl job: ${jobId}`);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const result = await waitForCrawl(accountId, apiToken, jobId, 60, 5000);

      console.log(`  Crawl status: ${result.status}`);
      console.log(`  Total pages discovered: ${result.total}`);
      console.log(`  Pages finished: ${result.finished}`);

      expect(result.status).toBe("completed");
      expect(result.total).toBeGreaterThan(0);
      expect(result.records).toBeDefined();
      expect(Array.isArray(result.records)).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);

      const completedRecords = result.records.filter((r: any) => r.status === "completed");
      console.log(`  Completed pages: ${completedRecords.length}`);

      completedRecords.forEach((record: any, index: number) => {
        expect(record.url).toBeDefined();
        expect(record.markdown).toBeDefined();
        expect(record.markdown.length).toBeGreaterThan(0);
        console.log(`  Page ${index + 1}: ${record.url} (${record.markdown.length} chars)`);
      });

      const firstRecord = result.records[0];
      expect(firstRecord.markdown).toContain("#");

    } catch (error: any) {
      if (error.message.includes("Rate limit")) {
        console.log("  ⚠️  Skipped - Rate limit exceeded");
        return;
      }
      throw error;
    }
  }, 360000);
});

describe('Environment Variable Validation', () => {
  const testCases = [
    {
      name: 'CF_API_TOKEN is required',
      envKey: 'CF_API_TOKEN',
      expectedError: 'Missing required environment variable: CF_API_TOKEN',
    },
    {
      name: 'CF_ACCOUNT_ID is required', 
      envKey: 'CF_ACCOUNT_ID',
      expectedError: 'Missing required environment variable: CF_ACCOUNT_ID',
    },
  ];

  it.each(testCases)('$name', ({ envKey, expectedError }) => {
    delete process.env[envKey];
    expect(() => getEnv(envKey)).toThrow(expectedError);
  });

  it('should return value when CF_API_TOKEN is set', () => {
    process.env.CF_API_TOKEN = 'test-token';
    expect(getEnv('CF_API_TOKEN')).toBe('test-token');
    delete process.env.CF_API_TOKEN;
  });

  it('should return value when CF_ACCOUNT_ID is set', () => {
    process.env.CF_ACCOUNT_ID = 'test-account';
    expect(getEnv('CF_ACCOUNT_ID')).toBe('test-account');
    delete process.env.CF_ACCOUNT_ID;
  });
});
