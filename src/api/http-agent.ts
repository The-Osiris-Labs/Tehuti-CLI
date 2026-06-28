import { Agent, Pool, setGlobalDispatcher } from "undici";

let globalAgent: Agent | null = null;
const connectionPool: Map<string, Pool> = new Map();

export interface HttpAgentConfig {
	keepAliveTimeout?: number;
	keepAliveMaxTimeout?: number;
	keepAliveTimeoutThreshold?: number;
	connections?: number;
	pipelining?: number;
	connectTimeout?: number;
	tcpKeepAlive?: boolean;
	tcpKeepAliveInitialDelay?: number;
}

const DEFAULT_CONFIG: Required<HttpAgentConfig> = {
	keepAliveTimeout: 60000,
	keepAliveMaxTimeout: 600000,
	keepAliveTimeoutThreshold: 1000,
	connections: 50,
	pipelining: 1,
	connectTimeout: 10000,
	tcpKeepAlive: true,
	tcpKeepAliveInitialDelay: 30000,
};

let activeConfig = { ...DEFAULT_CONFIG };

export function initializeHttpAgent(config: HttpAgentConfig = {}): void {
	if (globalAgent) {
		return;
	}

	activeConfig = { ...DEFAULT_CONFIG, ...config };

	globalAgent = new Agent({
		keepAliveTimeout: activeConfig.keepAliveTimeout,
		keepAliveMaxTimeout: activeConfig.keepAliveMaxTimeout,
		keepAliveTimeoutThreshold: activeConfig.keepAliveTimeoutThreshold,
		connections: activeConfig.connections,
		pipelining: activeConfig.pipelining,
		connect: {
			timeout: activeConfig.connectTimeout,
			keepAlive: activeConfig.tcpKeepAlive,
			keepAliveInitialDelay: activeConfig.tcpKeepAliveInitialDelay,
		},
	});

	setGlobalDispatcher(globalAgent);
}

export function getAgent(): Agent | null {
	return globalAgent;
}

const MAX_POOL_SIZE = 100;

export function getPool(origin: string): Pool {
	if (connectionPool.has(origin)) {
		const pool = connectionPool.get(origin)!;
		connectionPool.delete(origin);
		connectionPool.set(origin, pool);
		return pool;
	}

	const pool = new Pool(origin, {
		connections: activeConfig.connections,
		pipelining: activeConfig.pipelining,
		keepAliveTimeout: activeConfig.keepAliveTimeout,
		keepAliveMaxTimeout: activeConfig.keepAliveMaxTimeout,
		keepAliveTimeoutThreshold: activeConfig.keepAliveTimeoutThreshold,
		connect: {
			timeout: activeConfig.connectTimeout,
			keepAlive: activeConfig.tcpKeepAlive,
			keepAliveInitialDelay: activeConfig.tcpKeepAliveInitialDelay,
		},
	});

	if (connectionPool.size >= MAX_POOL_SIZE) {
		const oldestKey = connectionPool.keys().next().value;
		if (oldestKey) {
			const oldestPool = connectionPool.get(oldestKey);
			oldestPool?.close();
			connectionPool.delete(oldestKey);
		}
	}

	connectionPool.set(origin, pool);
	return pool;
}

export function updateHttpAgentConfig(config: HttpAgentConfig): void {
	resetAgent();
	initializeHttpAgent(config);
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
	activeConfig = { ...DEFAULT_CONFIG };
}

export function getAgentStats(): {
	initialized: boolean;
	pools: number;
	poolsCount: number;
	poolsDetails: Record<
		string,
		{
			connected: number;
			free: number;
			pending: number;
			queued: number;
			running: number;
			size: number;
		}
	>;
} {
	const poolStats: Record<string, any> = {};
	for (const [origin, pool] of connectionPool.entries()) {
		poolStats[origin] = {
			connected: pool.stats?.connected ?? 0,
			free: pool.stats?.free ?? 0,
			pending: pool.stats?.pending ?? 0,
			queued: pool.stats?.queued ?? 0,
			running: pool.stats?.running ?? 0,
			size: pool.stats?.size ?? 0,
		};
	}
	return {
		initialized: globalAgent !== null,
		pools: connectionPool.size,
		poolsCount: connectionPool.size,
		poolsDetails: poolStats,
	};
}
