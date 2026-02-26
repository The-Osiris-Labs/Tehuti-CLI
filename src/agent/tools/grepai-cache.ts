import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { z } from "zod";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

// Cache directory for grepai search results
const GREPAI_CACHE_DIR = join(process.cwd(), ".tehuti", "grepai-cache");

// Ensure cache directory exists
function ensureCacheDirectory(): void {
  if (!existsSync(GREPAI_CACHE_DIR)) {
    mkdirSync(GREPAI_CACHE_DIR, { recursive: true });
  }
}

// Generate cache key from query and options
function generateCacheKey(query: string, options?: { limit?: number; path?: string }): string {
  const hash = require("crypto").createHash("sha256");
  hash.update(query);
  if (options?.limit) hash.update(`limit:${options.limit}`);
  if (options?.path) hash.update(`path:${options.path}`);
  return hash.digest("hex").slice(0, 16);
}

// Cache entry interface
interface CacheEntry {
  query: string;
  options?: { limit?: number; path?: string };
  results: any;
  timestamp: number;
  ttl: number;
}

// Default TTL: 1 hour (3600 seconds)
const DEFAULT_TTL = 3600000;

export const grepaiSearchWithCacheTool = createTool({
  name: "grepai_search_with_cache",
  description: "Search codebase semantically using natural language with caching. Results are cached for 1 hour by default.",
  parameters: z.object({
    query: z.string().describe("Natural language query to search for"),
    limit: z.number().int().positive().optional().default(10).describe("Maximum number of results to return"),
    path: z.string().optional().describe("Path prefix to filter search results"),
    ttl: z.number().int().positive().optional().default(DEFAULT_TTL).describe("Time to live for cache entry in milliseconds"),
  }),
  category: "search",
  execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
    const { query, limit = 10, path, ttl = DEFAULT_TTL } = args as { query: string; limit?: number; path?: string; ttl?: number };
    
    // Ensure cache directory exists
    ensureCacheDirectory();
    
    // Generate cache key
    const cacheKey = generateCacheKey(query, { limit, path });
    const cachePath = join(GREPAI_CACHE_DIR, `${cacheKey}.json`);
    
    // Check if cache entry exists and is still valid
    if (existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(await readFile(cachePath, "utf8")) as CacheEntry;
        const now = Date.now();
        
        if (now - cacheData.timestamp < ttl) {
          return {
            success: true,
            output: JSON.stringify({
              results: cacheData.results,
              cached: true,
              cacheKey,
              timestamp: cacheData.timestamp,
              ttl: cacheData.ttl,
            }),
          };
        }
      } catch (error) {
        console.error("Cache read error:", error);
      }
    }
    
    // No valid cache entry, execute search
    const grepai = await import("./grepai.js");
    const searchTool = grepai.grepaiSearchTool;
    const result = await searchTool.execute({ query, limit, path }, ctx);
    
    // Cache the result
    if (result.success && result.output) {
      try {
        const results = JSON.parse(result.output);
        const cacheEntry: CacheEntry = {
          query,
          options: { limit, path },
          results,
          timestamp: Date.now(),
          ttl,
        };
        
        await writeFile(cachePath, JSON.stringify(cacheEntry));
      } catch (error) {
        console.error("Cache write error:", error);
      }
    }
    
    return {
      ...result,
      output: JSON.stringify({
        results: result.output ? JSON.parse(result.output) : null,
        cached: false,
        cacheKey,
      }),
    };
  },
});

export const grepaiClearCacheTool = createTool({
  name: "grepai_clear_cache",
  description: "Clear the grepai search results cache. This will force all subsequent searches to be performed from scratch.",
  parameters: z.object({
    olderThan: z.number().int().optional().describe("Only clear entries older than this number of milliseconds"),
  }),
  category: "system",
  execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
    const { olderThan } = args as { olderThan?: number };
    
    try {
      if (!existsSync(GREPAI_CACHE_DIR)) {
        return {
          success: true,
          output: JSON.stringify({ message: "Cache directory does not exist", cleared: 0 }),
        };
      }
      
      const files = await readdir(GREPAI_CACHE_DIR);
      let clearedCount = 0;
      
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = join(GREPAI_CACHE_DIR, file);
          const fileStat = await stat(filePath);
          
          if (!olderThan || Date.now() - fileStat.mtimeMs > olderThan) {
            await unlink(filePath);
            clearedCount++;
          }
        }
      }
      
      return {
        success: true,
        output: JSON.stringify({ message: `Cleared ${clearedCount} cache entries`, cleared: clearedCount }),
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to clear cache: ${error}`,
      };
    }
  },
});

export const grepaiCacheStatusTool = createTool({
  name: "grepai_cache_status",
  description: "Get information about the grepai search results cache.",
  parameters: z.object({}),
  category: "system",
  execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (!existsSync(GREPAI_CACHE_DIR)) {
        return {
          success: true,
          output: JSON.stringify({
            exists: false,
            entries: 0,
            size: 0,
            directory: GREPAI_CACHE_DIR,
          }),
        };
      }
      
      const files = await readdir(GREPAI_CACHE_DIR);
      const cacheFiles = files.filter(file => file.endsWith(".json"));
      
      let totalSize = 0;
      const entries: Array<{ filename: string; size: number; timestamp: number; ttl?: number }> = [];
      
      for (const file of cacheFiles) {
        const filePath = join(GREPAI_CACHE_DIR, file);
        const fileStat = await stat(filePath);
        totalSize += fileStat.size;
        
        try {
          const content = JSON.parse(await readFile(filePath, "utf8")) as CacheEntry;
          entries.push({
            filename: file,
            size: fileStat.size,
            timestamp: content.timestamp,
            ttl: content.ttl,
          });
        } catch (error) {
          entries.push({
            filename: file,
            size: fileStat.size,
            timestamp: fileStat.mtimeMs,
          });
        }
      }
      
      return {
        success: true,
        output: JSON.stringify({
          exists: true,
          directory: GREPAI_CACHE_DIR,
          entries: cacheFiles.length,
          totalSize,
          detailed: entries,
        }),
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to get cache status: ${error}`,
      };
    }
  },
});

export const grepaiToolsWithCache = [
  grepaiSearchWithCacheTool,
  grepaiClearCacheTool,
  grepaiCacheStatusTool,
];