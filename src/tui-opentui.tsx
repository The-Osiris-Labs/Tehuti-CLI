#!/usr/bin/env node
import * as readline from "node:readline";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCliRenderer, SyntaxStyle } from "@opentui/core";
import {
	createRoot,
	useKeyboard,
	useRenderer,
	useTimeline,
} from "@opentui/react";
import { generateText, streamText } from "ai";
import { Command } from "commander";
import Conf from "conf";
/** @jsxImportSource @opentui/react */
import { useEffect, useState } from "react";

const config = new Conf<{ apiKey?: string; model?: string }>({
	projectName: "tehuti",
	defaults: { model: "giga-potato" },
});

const ORANGE = "#E67D22";
const CORAL = "#D97757";
const GREEN = "#10B981";
const GRAY = "#6B7280";
const RED = "#EF4444";
const YELLOW = "#F59E0B";
const BG = "#1A1A2E";

interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	status?: "success" | "error" | "loading";
}

function Spinner() {
	const [frame, setFrame] = useState(0);
	const timeline = useTimeline({
		duration: 400,
		loop: true,
		autoplay: true,
	});

	useEffect(() => {
		timeline.add(
			{ frame: 0 },
			{
				frame: 4,
				duration: 400,
				ease: "linear",
				onUpdate: (animation) => {
					setFrame(Math.floor(animation.targets[0].frame) % 4);
				},
			},
		);
	}, [timeline]);

	const frames = ["|", "/", "-", "\\"];
	return <text content={frames[frame]} fg={ORANGE} />;
}

function ProgressBar({ value, label }: { value: number; label?: string }) {
	return (
		<box flexDirection="column" marginY={0.5}>
			{label && (
				<box
					flexDirection="row"
					justifyContent="space-between"
					marginBottom={0.25}
				>
					<text content={label} fg={GRAY} />
					<text content={`${Math.round(value)}%`} fg={ORANGE} />
				</box>
			)}
			<box style={{ backgroundColor: "#333333", height: 1 }}>
				<box
					style={{ width: `${value}%`, height: 1, backgroundColor: ORANGE }}
				/>
			</box>
		</box>
	);
}

function StatusIndicator({
	status,
}: {
	status: "success" | "error" | "loading";
}) {
	if (status === "success") {
		return <text content="✅" fg={GREEN} />;
	}
	if (status === "error") {
		return <text content="❌" fg={RED} />;
	}
	return <Spinner />;
}

function App({
	apiKey,
	syntaxStyle,
}: {
	apiKey: string;
	syntaxStyle: SyntaxStyle;
}) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [model, setModel] = useState(config.get("model") || "giga-potato");
	const [progress, setProgress] = useState(0);
	const [operationLabel, setOperationLabel] = useState("");
	const renderer = useRenderer();

	useKeyboard((e) => {
		if (e.ctrl && e.name === "c") {
			renderer.destroy();
			process.exit(0);
		}
		if (e.name === "return" && input.trim() && !loading) {
			send(input.trim());
		} else if (e.name === "backspace" || e.name === "delete") {
			setInput((s) => s.slice(0, -1));
		} else if (e.name === "escape") {
			setInput("");
		} else if (e.sequence && e.sequence.length === 1 && !e.ctrl) {
			setInput((s) => s + e.sequence);
		}
	});

	async function send(text: string) {
		setInput("");

		if (text.startsWith("/")) {
			handleCommand(text);
			return;
		}

		setMessages((m) => [
			...m,
			{ id: Date.now().toString(), role: "user", content: text },
		]);
		setLoading(true);
		setOperationLabel("Tehuti is thinking...");
		setProgress(0);

		// Simulate progress for better UX
		const progressInterval = setInterval(() => {
			setProgress((prev) => {
				if (prev >= 90) return prev;
				return prev + Math.random() * 10;
			});
		}, 200);

		try {
			const openrouter = createOpenRouter({ apiKey });
			const history = messages.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			}));

			const { textStream } = streamText({
				model: openrouter(model),
				messages: [...history, { role: "user" as const, content: text }],
			});

			let response = "";
			const id = (Date.now() + 1).toString();
			setMessages((m) => [
				...m,
				{ id, role: "assistant", content: "", status: "loading" },
			]);

			for await (const chunk of textStream) {
				response += chunk;
				setMessages((m) =>
					m.map((msg) =>
						msg.id === id
							? { ...msg, content: response, status: "loading" }
							: msg,
					),
				);
			}

			setMessages((m) =>
				m.map((msg) => (msg.id === id ? { ...msg, status: "success" } : msg)),
			);
		} catch (e: any) {
			setMessages((m) => [
				...m,
				{
					id: Date.now().toString(),
					role: "system",
					content: `Error: ${e.message}`,
					status: "error",
				},
			]);
		}

		clearInterval(progressInterval);
		setProgress(100);
		setLoading(false);
		setOperationLabel("");
	}

	async function handleCommand(cmd: string) {
		const parts = cmd.toLowerCase().trim().split(" ");
		const command = parts[0];

		switch (command) {
			case "/exit":
			case "/quit":
				renderer.destroy();
				process.exit(0);
				break;

			case "/clear":
				setMessages([]);
				break;

			case "/help":
				setMessages((m) => [
					...m,
					{
						id: Date.now().toString(),
						role: "system",
						content:
							"Commands:\n- /help - Show this help\n- /clear - Clear chat\n- /models - List free models\n- /model <id> - Switch model\n- /exit - Exit",
					},
				]);
				break;

			case "/models":
				setMessages((m) => [
					...m,
					{
						id: Date.now().toString(),
						role: "system",
						content: "Fetching...",
						status: "loading",
					},
				]);
				try {
					const res = await fetch("https://openrouter.ai/api/v1/models", {
						headers: { Authorization: `Bearer ${apiKey}` },
					});
					const data = (await res.json()) as any;
					const list = data.data
						.filter((m: any) => m.id.includes(":free"))
						.sort(
							(a: any, b: any) =>
								(b.context_length || 0) - (a.context_length || 0),
						)
						.slice(0, 10)
						.map(
							(m: any) => `${m.id} (${Math.round(m.context_length / 1000)}k)`,
						)
						.join("\n");
					setMessages((m) => [
						...m.slice(0, -1),
						{
							id: Date.now().toString(),
							role: "system",
							content: `Free models:\n${list}`,
							status: "success",
						},
					]);
				} catch {
					setMessages((m) => [
						...m.slice(0, -1),
						{
							id: Date.now().toString(),
							role: "system",
							content: "Failed to fetch models",
							status: "error",
						},
					]);
				}
				break;

			case "/model": {
				const newModel = parts.slice(1).join(" ");
				if (newModel) {
					setModel(newModel);
					config.set("model", newModel);
					setMessages((m) => [
						...m,
						{
							id: Date.now().toString(),
							role: "system",
							content: `Model: ${newModel}`,
							status: "success",
						},
					]);
				}
				break;
			}

			default:
				setMessages((m) => [
					...m,
					{
						id: Date.now().toString(),
						role: "system",
						content: `Unknown: ${cmd}`,
						status: "error",
					},
				]);
		}
	}

	const roleLabel = (role: string) => {
		if (role === "user") return "You:";
		if (role === "system") return "System:";
		return "Tehuti:";
	};

	const roleColor = (role: string) => {
		if (role === "user") return CORAL;
		if (role === "system") return GRAY;
		return GREEN;
	};

	const messageElements = messages.map((m) => (
		<box key={m.id} flexDirection="column" marginBottom={1}>
			<box flexDirection="row" alignItems="center" gap={1} marginBottom={0.5}>
				<text content={roleLabel(m.role)} fg={roleColor(m.role)} />
				{m.status && <StatusIndicator status={m.status} />}
			</box>
			<text content={m.content} />
		</box>
	));

	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor={BG}>
			<box paddingX={1} borderStyle="single" borderColor={ORANGE}>
				<text content="Tehuti" fg={ORANGE} />
				<text content=" | " fg={GRAY} />
				<text
					content={model.split("/")[1]?.split("-")[0] || model}
					fg={CORAL}
				/>
				<box flexGrow={1} />
				<text content="Ctrl+C exit" fg={GRAY} />
			</box>

			<scrollbox flexGrow={1} padding={1}>
				{messages.length === 0 ? (
					<box flexGrow={1} justifyContent="center" alignItems="center">
						<text content="Type a message or /help" fg={GRAY} />
					</box>
				) : (
					messageElements
				)}
				{loading && (
					<box flexDirection="column" marginY={1}>
						<box
							flexDirection="row"
							alignItems="center"
							gap={1}
							marginBottom={0.5}
						>
							<Spinner />
							<text content={operationLabel} fg={GRAY} />
						</box>
						<ProgressBar value={progress} />
					</box>
				)}
			</scrollbox>

			<box paddingX={1} borderStyle="single" borderColor={GRAY}>
				<text content={`> ${input}`} fg={CORAL} />
			</box>
		</box>
	);
}

async function main() {
	const program = new Command();
	program
		.name("tehuti")
		.description("Tehuti CLI - AI coding assistant")
		.version("0.1.0")
		.option("-m, --model <model>", "Model to use")
		.argument("[prompt]", "One-shot prompt")
		.action(async (prompt, opts) => {
			if (opts.model) config.set("model", opts.model);

			const key = config.get("apiKey") || process.env.OPENROUTER_API_KEY;

			if (prompt) {
				if (!key) {
					console.log("Set API key first: tehuti init");
					process.exit(1);
				}
				const openrouter = createOpenRouter({ apiKey: key });
				const result = await generateText({
					model: openrouter(config.get("model") || "giga-potato"),
					messages: [{ role: "user", content: prompt }],
				});
				console.log(result.text);
			} else {
				if (!key) {
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					});
					rl.question("OpenRouter API key: ", async (answer) => {
						config.set("apiKey", answer.trim());
						console.log("Saved. Run again to start.");
						rl.close();
					});
					return;
				}

				const renderer = await createCliRenderer({
					exitOnCtrlC: true,
					backgroundColor: BG,
				});

				const syntaxStyle = SyntaxStyle.create();
				createRoot(renderer).render(
					<App apiKey={key} syntaxStyle={syntaxStyle} />,
				);
			}
		});

	program.command("init").action(async () => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question("OpenRouter API key: ", (key) => {
			config.set("apiKey", key.trim());
			console.log("Saved to ~/.config/tehuti-nodejs/");
			rl.close();
		});
	});

	program.command("config").action(() => {
		console.log(JSON.stringify(config.store, null, 2));
	});

	program.parse();
}

main().catch(console.error);
