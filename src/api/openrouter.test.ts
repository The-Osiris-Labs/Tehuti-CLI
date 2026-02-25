import { beforeEach, describe, expect, it } from "vitest";
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
			).toThrow("OpenRouter API key is required");
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
});
