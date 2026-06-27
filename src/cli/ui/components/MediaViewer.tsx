import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { renderMediaToTerminal } from "../../../utils/media.js";
import Spinner from "ink-spinner";
import fs from "fs";

export interface MediaViewerProps {
	src: string;
	alt?: string;
}

export function MediaViewer({ src, alt }: MediaViewerProps): React.ReactNode {
	const [ansi, setAnsi] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		
		// Basic check: is it a local absolute file or relative file that exists?
		const resolvePath = () => {
			if (src.startsWith("file://")) {
				return src.replace("file://", "");
			}
			return src;
		};

		const resolvedSrc = resolvePath();
		
		if (!fs.existsSync(resolvedSrc)) {
			if (isMounted) setError("File not found or is a remote URL (not yet supported)");
			return;
		}

		renderMediaToTerminal(resolvedSrc, { width: '50%' })
			.then((rendered) => {
				if (!isMounted) return;
				if (rendered) {
					setAnsi(rendered);
				} else {
					setError("Unsupported media format");
				}
			})
			.catch((err) => {
				if (isMounted) setError(`Failed to render: ${err.message}`);
			});

		return () => {
			isMounted = false;
		};
	}, [src]);

	if (error) {
		return React.createElement(
			Box,
			{ marginY: 1, paddingX: 1, borderStyle: "round", borderColor: "red" },
			React.createElement(Text, { color: "red" }, `❌ Media Error: ${error} (${src})`)
		);
	}

	if (!ansi) {
		return React.createElement(
			Box,
			{ marginY: 1 },
			React.createElement(Text, { color: "cyan" }, React.createElement(Spinner, { type: "dots" }), ` Loading media: ${alt || src}`)
		);
	}

	return React.createElement(
		Box,
		{ marginY: 1, flexDirection: "column" },
		React.createElement(Text, { dimColor: true }, `🖼️  ${alt || src}`),
		React.createElement(Text, null, ansi)
	);
}
