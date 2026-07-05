import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";

export function HieroglyphSpinner() {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => {
			setFrame(f => (f + 1) % HIEROGLYPHS.thinking.length);
		}, 150);
		return () => clearInterval(interval);
	}, []);
	return React.createElement(Text, { color: BRANDING.colors.gold }, HIEROGLYPHS.thinking[frame]);
}
