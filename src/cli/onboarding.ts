import { input } from "@inquirer/prompts";
import ora from "ora";
import pc from "picocolors";
import { getGlobalConfig, saveGlobalConfig } from "../config/loader.js";

const coral = pc.red;
const orange = pc.yellow;

function formatWelcome(): string {
	return `
${coral("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}
${orange("   Welcome to Tehuti CLI")}
${coral("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

   ${pc.dim("Tehuti needs an OpenRouter API key to connect")}
   ${pc.dim("to AI models. Get your key at:")}
   ${pc.cyan("   https://openrouter.ai/keys")}

`;
}

function formatSuccess(): string {
	return `
${coral("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}
${pc.green("   ✓ API key validated successfully!")}
${coral("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

   ${pc.dim("You're all set. Run 'tehuti' to start.")}
`;
}

async function validateApiKey(
	apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
	const spinner = ora({
		text: coral("Validating API key..."),
		color: "yellow",
	}).start();

	try {
		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		if (response.status === 401) {
			spinner.fail(pc.red("Invalid API key"));
			return {
				valid: false,
				error:
					"API key appears to be invalid or expired.\n" +
					"  • Check your key at https://openrouter.ai/keys\n" +
					"  • Verify OPENROUTER_API_KEY environment variable\n" +
					"  • Check ~/.tehuti.json config file",
			};
		}

		if (response.status === 403) {
			spinner.fail(pc.red("API key forbidden"));
			return {
				valid: false,
				error: "API key is forbidden. Please check your account.",
			};
		}

		if (!response.ok) {
			spinner.fail(pc.red("Validation failed"));
			return {
				valid: false,
				error: `Validation failed (${response.status}). Please try again.`,
			};
		}

		spinner.succeed(pc.green("API key validated"));
		return { valid: true };
	} catch (_error) {
		spinner.fail(pc.red("Connection failed"));
		return {
			valid: false,
			error: "Could not connect to OpenRouter. Please check your connection.",
		};
	}
}

export function hasApiKey(): boolean {
	const config = getGlobalConfig();
	return !!(
		config.apiKey ||
		process.env.OPENROUTER_API_KEY ||
		process.env.TEHUTI_API_KEY
	);
}

export async function runOnboarding(): Promise<string | null> {
	const existingKey =
		getGlobalConfig().apiKey ||
		process.env.OPENROUTER_API_KEY ||
		process.env.TEHUTI_API_KEY;

	if (existingKey) {
		return existingKey;
	}

	console.log(formatWelcome());

	while (true) {
		const apiKey = await input({
			message: coral("Enter your OpenRouter API key (or press Enter to skip)"),
			default: "",
		});

		if (!apiKey || apiKey.trim() === "") {
			console.log(
				pc.dim(
					"\n  Skipped. Set OPENROUTER_API_KEY env var or run 'tehuti init' later.\n",
				),
			);
			return null;
		}

		const trimmedKey = apiKey.trim();
		const validation = await validateApiKey(trimmedKey);

		if (validation.valid) {
			saveGlobalConfig({ apiKey: trimmedKey });
			console.log(formatSuccess());
			return trimmedKey;
		}

		console.log();
		console.log(pc.red(`  ${validation.error}`));
		console.log();
	}
}

export async function ensureApiKey(): Promise<string> {
	const existingKey =
		getGlobalConfig().apiKey ||
		process.env.OPENROUTER_API_KEY ||
		process.env.TEHUTI_API_KEY;

	if (existingKey) {
		return existingKey;
	}

	const key = await runOnboarding();

	if (!key) {
		console.log(pc.red("\n  API key is required to use Tehuti."));
		console.log(pc.dim("  Get your key at: https://openrouter.ai/keys\n"));
		process.exit(1);
	}

	return key;
}
