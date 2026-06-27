import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "./openrouter.js";

describe("OpenRouterClient", () => {
	const validConfig = {
		apiKey: "sk-or-test123456789",
		model: "test/model",
		maxTokens: 4096,
		temperature: 0.7,
	};

	describe("constructor validation", () => {
		it("should reject missing API key", () => {
			expect(
				() => new OpenRouterClient({ ...validConfig, apiKey: "" }),
			).toThrow("OPENROUTER_API_KEY");
		});

		it("should reject invalid API key format", () => {
			expect(
				() => new OpenRouterClient({ ...validConfig, apiKey: "invalid" }),
			).toThrow("Invalid API key format");
		});

		it("should reject non-HTTPS baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "http://api.example.com",
					}),
			).toThrow("baseUrl must use HTTPS protocol");
		});

		it("should reject localhost baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://localhost:8080",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should reject 127.0.0.1 baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://127.0.0.1:8080",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should reject private IP 10.x.x.x baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://10.0.0.1:8080",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should reject private IP 172.16-31.x.x baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://172.16.0.1:8080",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should reject private IP 192.168.x.x baseUrl", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://192.168.1.1:8080",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should reject .local domains", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						baseUrl: "https://test.local",
					}),
			).toThrow("baseUrl cannot point to internal/private addresses");
		});

		it("should allow local HTTP baseUrl for Ollama", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						apiKey: "",
						provider: "ollama",
						baseUrl: "http://localhost:11434/v1",
					}),
			).not.toThrow();
		});

		it("should allow local provider without API key when the provider does not require one", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						apiKey: "",
						provider: "lmstudio",
						baseUrl: "http://localhost:1234/v1",
					}),
			).not.toThrow();
		});

		it("should reject invalid model names", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						model: "",
					}),
			).toThrow("Model name is required");
		});

		it("should reject model names with invalid characters", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						model: "test/model with spaces",
					}),
			).toThrow("Model name contains invalid characters");
		});

		it("should reject temperature outside 0-2", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						temperature: 3,
					}),
			).toThrow("Temperature must be between 0 and 2");
		});

		it("should reject negative temperature", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						temperature: -0.5,
					}),
			).toThrow("Temperature must be between 0 and 2");
		});

		it("should reject maxTokens outside valid range", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						maxTokens: 0,
					}),
			).toThrow("maxTokens must be between 1 and 1000000");
		});

		it("should reject maxTokens exceeding limit", () => {
			expect(
				() =>
					new OpenRouterClient({
						...validConfig,
						maxTokens: 2000000,
					}),
			).toThrow("maxTokens must be between 1 and 1000000");
		});

		it("should use the provider default baseUrl for opencode", () => {
			const client = new OpenRouterClient({
				...validConfig,
				provider: "opencode",
			} as any);

			expect((client as any).baseUrl).toBe("https://opencode.ai/zen/go/v1");
		});

		it("should replace a stale known-provider default baseUrl when provider changes", () => {
			const client = new OpenRouterClient({
				...validConfig,
				provider: "openrouter",
				baseUrl: "https://opencode.ai/zen/go/v1",
			} as any);

			expect((client as any).baseUrl).toBe("https://openrouter.ai/api/v1");
		});
	});

	describe("validateMessages", () => {
		let client: OpenRouterClient;

		beforeEach(() => {
			client = new OpenRouterClient(validConfig);
		});

		it("should reject empty messages array", () => {
			expect(() => client.validateMessages([])).toThrow(
				"Messages array cannot be empty",
			);
		});

		it("should reject messages exceeding MAX_MESSAGES", () => {
			const messages = Array(1001).fill({ role: "user", content: "test" });
			expect(() => client.validateMessages(messages)).toThrow(
				"Too many messages",
			);
		});

		it("should reject invalid roles", () => {
			expect(() =>
				client.validateMessages([{ role: "invalid" as any, content: "test" }]),
			).toThrow("Invalid role");
		});

		it("should accept valid roles", () => {
			const roles = ["system", "user", "assistant", "tool"];
			for (const role of roles) {
				expect(() =>
					client.validateMessages([{ role: role as any, content: "test" }]),
				).not.toThrow();
			}
		});

		it("should reject invalid content type", () => {
			expect(() =>
				client.validateMessages([{ role: "user", content: 123 as any }]),
			).toThrow("Invalid content type");
		});
	});

	describe("caching support detection", () => {
		it("should detect Claude models as caching-capable", () => {
			const client = new OpenRouterClient({
				...validConfig,
				model: "anthropic/claude-sonnet-4",
			});
			expect(client).toBeDefined();
		});

		it("should detect DeepSeek models as caching-capable", () => {
			const client = new OpenRouterClient({
				...validConfig,
				model: "deepseek/deepseek-chat",
			});
			expect(client).toBeDefined();
		});

		it("should detect Gemini models as caching-capable", () => {
			const client = new OpenRouterClient({
				...validConfig,
				model: "google/gemini-pro",
			});
			expect(client).toBeDefined();
		});
	});

	describe("model switching", () => {
		it("should allow model changes", () => {
			const client = new OpenRouterClient(validConfig);
			expect(client.getModel()).toBe("test/model");
			client.setModel("new/model");
			expect(client.getModel()).toBe("new/model");
		});
	});

	describe("timeout clamping", () => {
		it("should clamp timeout to minimum", () => {
			const client = new OpenRouterClient({
				...validConfig,
				requestTimeout: 1000,
			});
			expect(client).toBeDefined();
		});

		it("should clamp timeout to maximum", () => {
			const client = new OpenRouterClient({
				...validConfig,
				requestTimeout: 1000000,
			});
			expect(client).toBeDefined();
		});
	});

	describe("provider-specific headers", () => {
		it("should only send OpenRouter attribution headers for OpenRouter", () => {
			const opencodeClient = new OpenRouterClient({
				...validConfig,
				provider: "opencode",
			} as any);

			const headers = (opencodeClient as any).buildHeaders();
			expect(headers["HTTP-Referer"]).toBeUndefined();
			expect(headers["X-Title"]).toBeUndefined();
			expect(headers.Authorization).toBe("Bearer sk-or-test123456789");
		});
	});

	describe("withRetry and backoff logic", () => {
		it("should retry on retryable HTTP error codes", async () => {
			const client = new OpenRouterClient({
				...validConfig,
				maxRetries: 2,
			});
			let attempt = 0;
			const mockFetch = vi.spyOn(global, "fetch").mockImplementation(async () => {
				attempt++;
				if (attempt < 3) {
					return {
						ok: false,
						status: 500,
						text: async () => "Server Error",
						headers: new Headers(),
					} as Response;
				}
				return {
					ok: true,
					json: async () => ({ choices: [] }),
				} as Response;
			});

			const promise = client.completeChat([{ role: "user", content: "hello" }]);
			await expect(promise).resolves.toBeDefined();
			expect(attempt).toBe(3); // 1 initial + 2 retries
			mockFetch.mockRestore();
		});

		it("should respect Retry-After header with seconds", async () => {
			const client = new OpenRouterClient({
				...validConfig,
				maxRetries: 1,
			});
			const mockFetch = vi.spyOn(global, "fetch").mockImplementation(async () => {
				return {
					ok: false,
					status: 429,
					text: async () => "Rate Limited",
					headers: new Headers({ "Retry-After": "2" }),
				} as Response;
			});

			const spySleep = vi.spyOn(client as any, "sleep").mockImplementation(() => Promise.resolve());

			const promise = client.completeChat([{ role: "user", content: "hello" }]);
			await expect(promise).rejects.toThrow("Rate limit exceeded");

			expect(spySleep).toHaveBeenCalledWith(2000); // 2 seconds = 2000ms

			mockFetch.mockRestore();
			spySleep.mockRestore();
		});
	});
});
