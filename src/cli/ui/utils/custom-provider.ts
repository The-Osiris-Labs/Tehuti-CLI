export type RuntimeCustomProvider = {
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
};

export function normalizeCustomProvider(
	value: unknown,
): RuntimeCustomProvider | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const baseUrl =
		typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
	if (!name || !baseUrl) return undefined;
	const apiKey =
		typeof record.apiKey === "string" && record.apiKey.trim().length > 0
			? record.apiKey.trim()
			: undefined;
	const rawHeaders =
		typeof record.headers === "object" && record.headers !== null
			? (record.headers as Record<string, unknown>)
			: undefined;
	const headers =
		rawHeaders &&
		Object.entries(rawHeaders).every(([, val]) => typeof val === "string")
			? (Object.fromEntries(
					Object.entries(rawHeaders).map(([key, val]) => [key, String(val)]),
				) as Record<string, string>)
			: undefined;
	return {
		name,
		baseUrl,
		...(apiKey ? { apiKey } : {}),
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
	};
}
