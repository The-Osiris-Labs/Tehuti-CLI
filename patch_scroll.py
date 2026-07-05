import re

with open("src/cli/commands/chat.ts", "r") as f:
    content = f.read()

target1 = """	const scrollLineUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + 1));
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - 1);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [setScrollOffset]);"""

replacement1 = """	const scrollLineUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + 3)); // Scroll by 3 for smoothness
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - 3); // Scroll by 3 for smoothness
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [setScrollOffset]);"""

content = content.replace(target1, replacement1)

with open("src/cli/commands/chat.ts", "w") as f:
    f.write(content)

