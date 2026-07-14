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
export function isAsciiMode(): boolean {
	return (
		process.env.TEHUTI_ASCII_MODE === "1" ||
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
