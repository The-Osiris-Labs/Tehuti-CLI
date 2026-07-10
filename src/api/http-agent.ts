import { Agent, setGlobalDispatcher } from "undici";

let globalAgent: Agent | null = null;

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

export function updateHttpAgentConfig(config: HttpAgentConfig): void {
	resetAgent();
	initializeHttpAgent(config);
}

export function resetAgent(): void {
	if (globalAgent) {
		globalAgent.close();
		globalAgent = null;
	}

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
	return {
		initialized: globalAgent !== null,
		pools: 0,
		poolsCount: 0,
		poolsDetails: poolStats,
	};
}
