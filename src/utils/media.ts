import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

import ffmpeg from "fluent-ffmpeg";

import terminalImage from "terminal-image";

// Configure ffmpeg to use the static binary
if (ffmpegStatic) {
	ffmpeg.setFfmpegPath(ffmpegStatic);
}


/**
 * Check whether the terminal supports a graphics protocol (Sixel, Kitty, or
 * iTerm2). Returns false for basic terminals like ghostty, alacritty, or
 * the system Terminal.app, so callers can provide a textual fallback.
 */
function hasGraphicsProtocol(): boolean {
	const term = process.env.TERM ?? "";
	const termProgram = process.env.TERM_PROGRAM ?? "";
	const colorterm = process.env.COLORTERM ?? "";

	if (term.includes("kitty")) return true;
	if (termProgram === "iTerm.app") return true;
	if (colorterm.includes("sixel") || colorterm.includes("6l")) return true;
	if (/sixel/i.test(term)) return true;

	return false;
}

export interface MediaRenderOptions {
	width?: string | number;
	height?: string | number;
	preserveAspectRatio?: boolean;
}

/**
 * Renders a local image file to an ANSI string (or Sixel/iTerm graphic)
 * using terminal-image.
 */
export async function renderImageToTerminal(
	filePath: string,
	options: MediaRenderOptions = {},
): Promise<string> {
	if (!hasGraphicsProtocol()) {
		return `[Image: ${filePath}]`;
	}
	try {
		return await terminalImage.file(filePath, options);
	} catch (error) {
		return `\x1b[31m[Error rendering image: ${(error as Error).message}]\x1b[0m`;
	}
}

/**
 * Extracts the first frame of a local video file, saves it to a temp dir,
 * and renders that thumbnail to an ANSI string.
 */
export async function renderVideoThumbnailToTerminal(
	filePath: string,
	options: MediaRenderOptions = {},
): Promise<string> {
	if (!hasGraphicsProtocol()) {
		return `[Video thumbnail: ${filePath}]`;
	}
	try {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tehuti-media-"));
		const thumbName = "thumbnail.jpg";
		const thumbPath = path.join(tempDir, thumbName);

		await new Promise<void>((resolve, reject) => {
			ffmpeg(filePath)
				.on("end", () => resolve())
				.on("error", (err: Error) => reject(err))
				.screenshots({
					timestamps: ["10%"],
					filename: thumbName,
					folder: tempDir,
					size: "100%",
				});
		});

		const result = await terminalImage.file(thumbPath, options);

		// Cleanup
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}

		return result;
	} catch (error) {
		return `\x1b[31m[Error rendering video thumbnail: ${(error as Error).message}]\x1b[0m`;
	}
}

/**
 * Unified helper to determine if a local path is an image or video,
 * and returns the rendered terminal string.
 */
export async function renderMediaToTerminal(
	filePath: string,
	options: MediaRenderOptions = {},
): Promise<string | null> {
	try {
		const ext = path.extname(filePath).toLowerCase();

		const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
		if (imageExts.includes(ext)) {
			return await renderImageToTerminal(filePath, options);
		}

		const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
		if (videoExts.includes(ext)) {
			return await renderVideoThumbnailToTerminal(filePath, options);
		}

		return null; // Not a supported media type
	} catch {
		return null;
	}
}
