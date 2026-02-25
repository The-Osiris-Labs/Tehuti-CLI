import { Agent, setGlobalDispatcher, Pool } from "undici";

let globalAgent: Agent | null = null;
let connectionPool: Map<string, Pool> = new Map();

export interface HttpAgentConfig {
	keepAliveTimeout?: number;
	keepAliveMaxTimeout?: number;
	connections?: number;
	pipelining?: number;
}

const DEFAULT_CONFIG: Required<HttpAgentConfig> = {
	keepAliveTimeout: 60000,
	keepAliveMaxTimeout: 600000,
	connections: 50,
	pipelining: 1,
};

export function initializeHttpAgent(config: HttpAgentConfig = {}): void {
	if (globalAgent) {
		return;
	}

	const finalConfig = { ...DEFAULT_CONFIG, ...config };

	globalAgent = new Agent({
		keepAliveTimeout: finalConfig.keepAliveTimeout,
		keepAliveMaxTimeout: finalConfig.keepAliveMaxTimeout,
		connections: finalConfig.connections,
		pipelining: finalConfig.pipelining,
	});

	setGlobalDispatcher(globalAgent);
}

export function getAgent(): Agent | null {
	return globalAgent;
}

export function getPool(origin: string): Pool {
	if (!connectionPool.has(origin)) {
		const pool = new Pool(origin, {
			connections: 10,
			pipelining: 1,
		});
		connectionPool.set(origin, pool);
	}
	return connectionPool.get(origin)!;
}

export function resetAgent(): void {
	if (globalAgent) {
		globalAgent.close();
		globalAgent = null;
	}

	for (const pool of connectionPool.values()) {
		pool.close();
	}
	connectionPool.clear();
}

export function getAgentStats(): {
	initialized: boolean;
	pools: number;
} {
	return {
		initialized: globalAgent !== null,
		pools: connectionPool.size,
	};
}
