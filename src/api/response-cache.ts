import type { OpenRouterResponse, OpenRouterMessage } from "./openrouter.js";
import { join } from "node:path";
import { readFile, writeFile, unlink, stat, readdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

// Cache directory for API responses
const API_CACHE_DIR = join(process.cwd(), ".tehuti", "api-cache");

// Ensure cache directory exists
function ensureCacheDirectory(): void {
  if (!existsSync(API_CACHE_DIR)) {
    mkdirSync(API_CACHE_DIR, { recursive: true });
  }
}

// Generate cache key from messages and options
function generateCacheKey(messages: OpenRouterMessage[], options?: { model?: string; temperature?: number; maxTokens?: number }): string {
  const hash = createHash("sha256");
  const serialized = JSON.stringify({
    messages,
    options: {
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    },
  });
  hash.update(serialized);
  return hash.digest("hex").slice(0, 16);
}

// Cache entry interface
interface APIResponseCacheEntry {
  messages: OpenRouterMessage[];
  options?: { model?: string; temperature?: number; maxTokens?: number };
  response: OpenRouterResponse;
  timestamp: number;
  ttl: number;
}

// Default TTL: 15 minutes (900 seconds)
const DEFAULT_TTL = 900000;

export class APIResponseCache {
  private static instance: APIResponseCache | null = null;
  private cacheDirectory: string;

  private constructor() {
    this.cacheDirectory = API_CACHE_DIR;
    ensureCacheDirectory();
  }

  static getInstance(): APIResponseCache {
    if (!APIResponseCache.instance) {
      APIResponseCache.instance = new APIResponseCache();
    }
    return APIResponseCache.instance;
  }

  // Get cached response
  async get(messages: OpenRouterMessage[], options?: { model?: string; temperature?: number; maxTokens?: number; ttl?: number }): Promise<OpenRouterResponse | null> {
    const cacheKey = generateCacheKey(messages, options);
    const cachePath = join(this.cacheDirectory, `${cacheKey}.json`);

    if (existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(await readFile(cachePath, "utf8")) as APIResponseCacheEntry;
        const now = Date.now();
        const ttl = options?.ttl ?? DEFAULT_TTL;

        if (now - cacheData.timestamp < ttl) {
          return cacheData.response;
        }
      } catch (error) {
        console.error("Cache read error:", error);
      }
    }

    return null;
  }

  // Set cached response
  async set(
    messages: OpenRouterMessage[],
    response: OpenRouterResponse,
    options?: { model?: string; temperature?: number; maxTokens?: number; ttl?: number },
  ): Promise<void> {
    const cacheKey = generateCacheKey(messages, options);
    const cachePath = join(this.cacheDirectory, `${cacheKey}.json`);

    const cacheEntry: APIResponseCacheEntry = {
      messages,
      options: {
        model: options?.model,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      },
      response,
      timestamp: Date.now(),
      ttl: options?.ttl ?? DEFAULT_TTL,
    };

    try {
      await writeFile(cachePath, JSON.stringify(cacheEntry));
    } catch (error) {
      console.error("Cache write error:", error);
    }
  }

  // Clear cache
  async clear(options?: { olderThan?: number }): Promise<number> {
    if (!existsSync(this.cacheDirectory)) {
      return 0;
    }

    const files = await readdir(this.cacheDirectory);
    let clearedCount = 0;

    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = join(this.cacheDirectory, file);
        const fileStat = await stat(filePath);
        
        if (!options?.olderThan || Date.now() - fileStat.mtimeMs > options.olderThan) {
          await unlink(filePath);
          clearedCount++;
        }
      }
    }

    return clearedCount;
  }

  // Get cache status
  async getStatus(): Promise<{ exists: boolean; entries: number; size: number }> {
    if (!existsSync(this.cacheDirectory)) {
      return {
        exists: false,
        entries: 0,
        size: 0,
      };
    }

    const files = await readdir(this.cacheDirectory);
    const cacheFiles = files.filter(file => file.endsWith(".json"));

    let totalSize = 0;
    for (const file of cacheFiles) {
      const fileStat = await stat(join(this.cacheDirectory, file));
      totalSize += fileStat.size;
    }

    return {
      exists: true,
      entries: cacheFiles.length,
      size: totalSize,
    };
  }
}