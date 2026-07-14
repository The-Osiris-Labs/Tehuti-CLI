/**
 * Shared type definitions to break circular dependencies.
 *
 * Both `context.ts` and `tools/registry.ts` need these interfaces, so they
 * live here to avoid a mutual import cycle.
 */
import type {
	StandardMessage,
} from "../api/base-client.js";
import type { TehutiConfig } from "../config/schema.js";
import type { CompactionDigest } from "./context-compressor.js";
import type { InjectionQueue } from "./events.js";

export interface DiffPreviewOptions {
	showPreview: boolean;
	autoConfirm?: boolean;
	maxDiffLines?: number;
}

export interface AgentContext {
	cwd: string;
	workingDir: string;
	messages: StandardMessage[];
	appendOnlyLog: StandardMessage[];
	/** Deterministic summaries of ranges removed from the model-facing context. */
	compactionHistory: CompactionDigest[];
	config: TehutiConfig;
	projectInstructions?: string;
	systemMemoryPromise?: Promise<string>;
	diffPreview?: DiffPreviewOptions;
	companionMode?: boolean;
	sessionId?: string;
	personalityBlockPromise?: Promise<string>;
	readFilesThisSession: Set<string>;
	isSleeping?: boolean;
	injectionQueue: InjectionQueue;
	/** Live model context length resolved from provider API (overrides config fallback) */
	modelContextLength?: number;
	metadata: {
		startTime: Date;
		sessionCost?: number;
		toolCalls: number;
		tokensUsed: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		filesRead: string[];
		filesWritten: string[];
		commandsRun: string[];
	};
}
