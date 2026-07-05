

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
	try {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tehuti-media-"));
		const thumbName = "thumbnail.jpg";
		const thumbPath = path.join(tempDir, thumbName);

		await new Promise<void>((resolve, reject) => {
			ffmpeg(filePath)
				.on("end", () => resolve())
				.on("error", (err: Error) => reject(err))
				.screenshots({
					timestamps: ["10%"], // Grab a frame at 10% into the video
					filename: thumbName,
					folder: tempDir,
					size: "100%", // Keep original resolution before terminal-image scales it
				});
		});

		const result = await terminalImage.file(thumbPath, options);

		// Cleanup
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (_cleanupErr) {
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
