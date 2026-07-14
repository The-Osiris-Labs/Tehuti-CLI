export const BRANDING = {
	name: "Tehuti",
	version: "1.2.1",
	colors: {
		// High contrast palette for accessibility
		primary: "#F5C518", // Bright gold (WCAG AA compliant on dark backgrounds)
		secondary: "#D4AF37", // Classic gold
		accent: "#FF6B35", // Vibrant coral (high contrast)
		orange: "#E67D22",
		coral: "#FF6B35", // Updated coral for better contrast
		gold: "#F5C518", // Bright gold
		papyrus: "#F5E6C8",
		obsidian: "#1A1A2E",
		nile: "#3B82F6", // WCAG AA (4.57:1) against #1A1A2E
		sand: "#A08860", // WCAG AA (4.50:1) against #1A1A2E
		green: "#22C55E",
		gray: "#9CA3AF",
		red: "#F05050", // WCAG AA (4.70:1) against #1A1A2E
		cyan: "#06B6D4",
		blue: "#3B82F6",
		purple: "#C084FC", // WCAG AA (5.65:1) against #1A1A2E
		codeBg: "#1e293b",
		promptSand: "#C2B280",
		bgWorking: "#332200",
		bgSuccess: "#001500",
		bgError: "#220000",
		bgKilled: "#222222",
		// High contrast mode colors
		highContrast: {
			primary: "#FFD700", // Bright yellow/gold (WCAG AAA compliant)
			secondary: "#FFA500", // Orange (high contrast)
			accent: "#FF4500", // Red-orange (high contrast)
			background: "#000000",
			foreground: "#FFFFFF",
			border: "#FFFFFF",
		},
	},
} as const;

export const ASCII_ART = `
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

        ████████╗███████╗██╗  ██╗██╗   ██╗████████╗██╗
        ╚══██╔══╝██╔════╝██║  ██║██║   ██║╚══██╔══╝██║
           ██║   █████╗  ███████║██║   ██║   ██║   ██║
           ██║   ██╔══╝  ██╔══██║██║   ██║   ██║   ██║
           ██║   ███████╗██║  ██║╚██████╔╝   ██║   ██║
           ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝

           ━━━━━━━━━━━━━━━━━ 𓅞 ━━━━━━━━━━━━━━━━━

                T H O T H,  T O N G U E  O F  R A

       Halls of Records • Balance of Ma'at • Architect

▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
`;

export const GRADIENT_STOPS = {
	tehu: ["#F5C518", "#FF6B35", "#D4AF37"] as const,
	splash: ["#F5C518", "#E67D22", "#A08860"] as const,
	header: ["#F5C518", "#D4AF37"] as const,
	welcome: ["#D4AF37", "#FF6B35"] as const,
} as const;

export const ROLE_COLORS = {
	user: BRANDING.colors.coral,
	assistant: BRANDING.colors.gold,
	system: BRANDING.colors.sand,
	error: BRANDING.colors.red,
	success: BRANDING.colors.green,
	warning: BRANDING.colors.gold,
	info: BRANDING.colors.cyan,
} as const;

export const SPLASH_ASCII = `
    ╔══════════════════════════════════════╗
    ║                                      ║
    ║     𓆣  T E H U T I                  ║
    ║     Scribe of Code Transformations   ║
    ║                                      ║
    ╚══════════════════════════════════════╝
`;

export const WELCOME_MESSAGE = `
  𓁹 Write • Edit • Transform
  
  /help • /clear • /exit
`;

export const FAREWELL_MESSAGE = "𓆣 Until we meet again.";

export const PERMISSION_PROMPT = "Permission required:";

export const ERROR_PREFIX = "Error:";

export const SUCCESS_SYMBOL = "𓋹";
export const ERROR_SYMBOL = "𓂀";
export const WARNING_SYMBOL = "𓁹";
export const INFO_SYMBOL = "𓆣";
export const PROGRESS_SYMBOL = "𓆗";

export const DECORATIVE = {
	horizontal: "─",
	horizontalDouble: "═",
	vertical: "│",
	cornerTL: "╭",
	cornerTR: "╮",
	cornerBL: "╰",
	cornerBR: "╯",
	bullet: "𓊖",
	arrow: "𓂝",
	subbullet: "𓍋",
	separator: "•",
	ibis: "𓆣",
	eye: "𓁹",
	eyeOfHorus: "𓂀",
	feather: "𓆄",
	scroll: "𓏛",
	ankh: "𓋹",
	was: "𓌀",
	djed: "𓊽",
	lotus: "𓆸",
	carrot: "𓇯",
	star: "𓇼",
	sun: "𓇳",
	ibisBird: "𓅞",
};

export const HIEROGLYPHS = {
	thinking: ["𓂝", "𓃀", "𓆣", "𓁹", "𓊖"],
	loading: ["𓆗", "𓆘", "𓆙", "𓆚", "𓆛"],
	success: "𓋹",
	wisdom: "𓂝",
	tool: "𓏛",
	error: "𓂀",
};

// ── ASCII fallbacks for terminals without hieroglyph font support ───────────
export function isAsciiMode(config?: { branding?: { glyphMode?: string } }): boolean {
	return (
		process.env.TEHUTI_ASCII_MODE === "1" ||
		config?.branding?.glyphMode === "ascii" ||
		process.env.NO_EMOJI === "1" ||
		process.env.TERM === "dumb" ||
		false
	);
}

export const ASCII_DECORATIVE = {
	horizontal: "─",
	horizontalDouble: "═",
	vertical: "│",
	cornerTL: "╭",
	cornerTR: "╮",
	cornerBL: "╰",
	cornerBR: "╯",
	bullet: "•",
	arrow: "→",
	subbullet: "·",
	separator: "•",
	ibis: "[T]",
	eye: "[+]",
	eyeOfHorus: "[!]",
	feather: "~>",
	scroll: "->",
	ankh: "[OK]",
	was: "[*]",
	djed: "[#]",
	lotus: "( )",
	carrot: "^",
	star: "*",
	sun: "O",
	ibisBird: "(T)",
};

export const ASCII_HIEROGLYPHS = {
	thinking: [".", "..", "...", "....", "....."],
	loading: ["|", "/", "-", "\\", "|"],
	success: "[OK]",
	wisdom: "->",
	tool: "->",
	error: "[!]",
};

export const ASCII_TOOL_ICONS: Record<string, string> = {
	// ── File operations ──
	read: "[R]",
	read_file: "[R]",
	write: "[W]",
	write_file: "[W]",
	edit: "[E]",
	edit_file: "[E]",
	apply_diff: "[DIFF]",
	apply_patch: "[DIFF]",
	create_dir: "[MKDIR]",
	delete_dir: "[DEL]",
	delete_file: "[DEL]",
	move_file: "[MV]",
	copy_file: "[CP]",
	copy: "[CP]",
	move: "[MV]",
	list_dir: "[LS]",
	list_directory: "[LS]",
	list_files: "[LS]",
	file_info: "[I]",
	read_image: "[IMG]",
	read_pdf: "[PDF]",
	// ── Search ──
	glob: "[GLOB]",
	grep: "[GREP]",
	grepai: "[GR]",
	search: "[SEARCH]",
	ast_grep: "[AST]",
	find_references: "[REF]",
	go_to_definition: "[GOTO]",
	// ── Shell ──
	bash: "[SH]",
	bash_background: "[BG]",
	// ── Services ──
	service: "[SVC]",
	service_status: "[STAT]",
	// ── Environment ──
	env: "[ENV]",
	env_inspect: "[ENV]",
	// ── Web ──
	webfetch: "[WEB]",
	web_fetch: "[WEB]",
	web_search: "[SEARCH]",
	code_search: "[CODE]",
	// ── Memory / knowledge ──
	store_insight: "[SAVE]",
	query_memory: "[MEM]",
	configure_memory_bank: "[MEM]",
	clear_memory: "[CLR]",
	// ── Configuration ──
	config: "[CFG]",
	configure_streaming: "[STRM]",
	configure_custom_provider: "[PROV]",
	set_custom_header: "[HDR]",
	remove_custom_header: "[HDR]",
	get_custom_provider_info: "[PROV]",
	custom_provider: "[PROV]",
	// ── Planning / tasks ──
	question: "[?]",
	todowrite: "[TODO]",
	todo_write: "[TODO]",
	task: "[TASK]",
	task_done: "[DONE]",
	plan_mode: "[PLAN]",
	create_plan: "[PLAN]",
	write_plan: "[PLAN]",
	list_plans: "[PLANS]",
	read_plan: "[PLAN]",
	exit_plan_mode: "[EXIT]",
	// ── Sessions ──
	list_sessions: "[SESS]",
	// ── Subagents / swarm ──
	spawn_subagent: "[SPAWN]",
	swarm: "[SWARM]",
	delegate_task: "[DELEG]",
	check_subagent: "[CHECK]",
	check_subagent_status: "[CHECK]",
	kill_subagent: "[KILL]",
	abort_subagent: "[ABORT]",
	send_message_to_subagent: "[MSG]",
	await_subagents: "[WAIT]",
	list_subagents: "[AGENTS]",
	// ── Background processes ──
	start_background: "[START]",
	list_background: "[BGLIST]",
	list_processes: "[PROCS]",
	check_background: "[BGBG]",
	read_output: "[OUT]",
	stop_background: "[STOP]",
	kill_process: "[KILL]",
	// ── Git ──
	git_status: "[GIT]",
	git_diff: "[DIFF]",
	git_log: "[LOG]",
	git_add: "[ADD]",
	git_commit: "[COMMIT]",
	git_branch: "[BRANCH]",
	git_remote: "[REMOTE]",
	git_pull: "[PULL]",
	git_push: "[PUSH]",
	// ── Collaboration ──
	configure_collaboration: "[COLLAB]",
	invite_collaborator: "[INVITE]",
	leave_collaboration: "[LEAVE]",
	acp_message: "[MSG]",
	aci: "[ACI]",
	// ── Skills ──
	list_skills: "[SKILLS]",
	activate_skill: "[SKILL]",
	deactivate_skill: "[SKILL]",
	get_skill: "[SKILL]",
	find_skills: "[SKILLS]",
	create_reusable_skill: "[SKILL]",
	// ── Semantic / code analysis ──
	semantic: "[SEM]",
	semantic_init: "[INIT]",
	semantic_status: "[SEM]",
	semantic_trace: "[TRACE]",
	parse_ast: "[PARSE]",
	review_code: "[REVIEW]",
	summarize_context: "[SUM]",
	// ── Network ──
	network: "[NET]",
	http: "[HTTP]",
	network_check: "[NET]",
	// ── MCP ──
	mcp_get_prompt: "[MCP]",
	mcp_list_prompts: "[MCP]",
	// ── Repo map ──
	repo_map: "[MAP]",
	// ── Misc ──
	think: "[THINK]",
	self_heal: "[HEAL]",
	compact_context: "[COMPACT]",
	exit: "[EXIT]",
	help: "[HELP]",
	debug: "[DBG]",
	test_speculatively: "[TEST]",
	headers: "[HDRS]",
	pricing: "[$]",
	commit: "[COMMIT]",
	wait_for_event: "[WAIT]",
	// Fallback
	default: "[TOOL]",
};
// ── Configurable theme system ───────────────────────────────────────────────

export interface ThemeConfig {
	colors: {
		primary: string;
		secondary: string;
		user: string;
		assistant: string;
		accent: string;
		background: string;
		success: string;
		error: string;
		warning: string;
	};
	symbols: {
		success: string;
		error: string;
		warning: string;
		info: string;
		progress: string;
	};
}

const DEFAULT_THEME: ThemeConfig = {
	colors: {
		primary: BRANDING.colors.primary,
		secondary: BRANDING.colors.secondary,
		user: BRANDING.colors.coral,
		assistant: BRANDING.colors.gold,
		accent: BRANDING.colors.accent,
		background: BRANDING.colors.obsidian,
		success: BRANDING.colors.green,
		error: BRANDING.colors.red,
		warning: BRANDING.colors.gold,
	},
	symbols: {
		success: SUCCESS_SYMBOL,
		error: ERROR_SYMBOL,
		warning: WARNING_SYMBOL,
		info: INFO_SYMBOL,
		progress: PROGRESS_SYMBOL,
	},
};

const MINIMAL_THEME: ThemeConfig = {
	colors: {
		primary: "#FFFFFF",
		secondary: "#CCCCCC",
		user: "#AAAAAA",
		assistant: "#FFFFFF",
		accent: "#888888",
		background: "#000000",
		success: "#00FF00",
		error: "#FF0000",
		warning: "#FFFF00",
	},
	symbols: {
		success: "[OK]",
		error: "[!]",
		warning: "[W]",
		info: "[i]",
		progress: "[...]",
	},
};

const COLORFUL_THEME: ThemeConfig = {
	colors: {
		primary: "#FF00FF",
		secondary: "#00FFFF",
		user: "#FF69B4",
		assistant: "#7CFC00",
		accent: "#FF4500",
		background: "#1A0A2E",
		success: "#00FF7F",
		error: "#FF1493",
		warning: "#FFD700",
	},
	symbols: {
		success: "\u2714",
		error: "\u2718",
		warning: "\u26A0",
		info: "\u2139",
		progress: "\u25CB",
	},
};

const THEMES: Record<string, ThemeConfig> = {
	default: DEFAULT_THEME,
	minimal: MINIMAL_THEME,
	colorful: COLORFUL_THEME,
};

/**
 * Resolve the active theme from config or environment.
 * Priority: TEHUTI_THEME env > config.branding.theme > 'default'.
 * Pass a custom ThemeConfig via config.branding.customTheme to override entirely.
 */
export function getTheme(
	config?: { branding?: { theme?: string; customTheme?: ThemeConfig } },
): ThemeConfig {
	const custom = config?.branding?.customTheme;
	if (custom) return custom;

	const name =
		process.env.TEHUTI_THEME || config?.branding?.theme || "default";

	return THEMES[name] ?? DEFAULT_THEME;
}

