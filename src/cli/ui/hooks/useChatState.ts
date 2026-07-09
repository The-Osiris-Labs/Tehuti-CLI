import { useRef, useState } from "react";
import type { QuestionData } from "../../../agent/tools/system.js";
import type { PermissionRequest } from "../../../permissions/prompts.js";

import {
	normalizeCustomProvider,
	type RuntimeCustomProvider,
} from "../utils/custom-provider.js";
export type { RuntimeCustomProvider };

export function useChatState(model: string, apiKey: string, cfg: any) {
	const [messages, setMessages] = useState<
		Array<{
			id: number;
			role: string;
			content: string;
			status?: "success" | "error" | "loading";
			toolCalls?: Array<{
				id: string;
				name: string;
				description: string;
				result: unknown;
				isExpanded: boolean;
			}>;
			blocks?: Array<
				| { type: "text"; content: string }
				| { type: "reasoning"; content: string }
				| {
						type: "tool";
						id: string;
						name: string;
						description: string;
						result: unknown;
				  }
			>;
		}>
	>([]);
	const [input, setInput] = useState("");
	const [cursorPos, setCursorPos] = useState(0);
	const [selectionStart, setSelectionStart] = useState<number | null>(null);
	const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [ctxModel, setCtxModel] = useState(model);
	const [runtimeProvider, setRuntimeProvider] = useState(
		cfg.provider || "openrouter",
	);
	const [runtimeBaseUrl, setRuntimeBaseUrl] = useState(cfg.baseUrl);
	const [runtimeApiKey, setRuntimeApiKey] = useState(
		apiKey || cfg.apiKey || "",
	);
	const [runtimeCustomProvider, setRuntimeCustomProvider] = useState<
		RuntimeCustomProvider | undefined
	>(() => normalizeCustomProvider(cfg.customProvider));
	const [scrollOffset, setScrollOffset] = useState(0);
	const [history, setHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [showWelcome, setShowWelcome] = useState(true);
	const [sessionCost, setSessionCost] = useState(0);
	const [thinking, setThinking] = useState("");
	const [showThinking, setShowThinking] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showDashboard, setShowDashboard] = useState(false);
	const [showSessionList, setShowSessionList] = useState(false);
	const [savedSessions, setSavedSessions] = useState<any[]>([]);
	const [pendingQuestion, setPendingQuestion] = useState<{
		questions: QuestionData[];
		resolve: (answers: string[]) => void;
		reject: (error: Error) => void;
	} | null>(null);
	const [progress, setProgress] = useState(0);
	const [operationLabel, setOperationLabel] = useState("");
	const [showConfigEditor, setShowConfigEditor] = useState(false);
	const [pendingPermission, setPendingPermission] = useState<{
		request: PermissionRequest;
		isDangerous: boolean;
		resolve: (allowed: boolean) => void;
		reject: (error: Error) => void;
	} | null>(null);
	const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
	const questionResolverRef = useRef<
		((questions: QuestionData[]) => Promise<string[]>) | null
	>(null);
	const permissionResolverRef = useRef<
		| ((request: PermissionRequest, isDangerous: boolean) => Promise<boolean>)
		| null
	>(null);

	return {
		messages,
		setMessages,
		input,
		setInput,
		cursorPos,
		setCursorPos,
		selectionStart,
		setSelectionStart,
		selectionEnd,
		setSelectionEnd,
		loading,
		setLoading,
		error,
		setError,
		ctxModel,
		setCtxModel,
		runtimeProvider,
		setRuntimeProvider,
		runtimeBaseUrl,
		setRuntimeBaseUrl,
		runtimeApiKey,
		setRuntimeApiKey,
		runtimeCustomProvider,
		setRuntimeCustomProvider,
		scrollOffset,
		setScrollOffset,
		history,
		setHistory,
		historyIndex,
		setHistoryIndex,
		sessionId,
		setSessionId,
		showWelcome,
		setShowWelcome,
		sessionCost,
		setSessionCost,
		thinking,
		setThinking,
		showThinking,
		setShowThinking,
		showCommandPalette,
		setShowCommandPalette,
		showDashboard,
		setShowDashboard,
		showSessionList,
		setShowSessionList,
		savedSessions,
		setSavedSessions,
		pendingQuestion,
		setPendingQuestion,
		pendingPermission,
		setPendingPermission,
		progress,
		setProgress,
		operationLabel,
		setOperationLabel,
		showConfigEditor,
		setShowConfigEditor,
		questionResolverRef,
		permissionResolverRef,
		queuedMessages,
		setQueuedMessages,
	};
}
