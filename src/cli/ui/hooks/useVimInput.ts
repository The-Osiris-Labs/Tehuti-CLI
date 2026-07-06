import { useInput } from "ink";

export interface UseVimInputProps {
	isActive?: boolean;
	onUp?: () => void;
	onDown?: () => void;
	onSelect?: () => void;
	onDelete?: () => void;
	onRename?: () => void;
	onSearch?: () => void;
}

export function useVimInput({
	isActive = true,
	onUp,
	onDown,
	onSelect,
	onDelete,
	onRename,
	onSearch,
}: UseVimInputProps) {
	useInput(
		(input, key) => {
			if (key.upArrow || (!key.ctrl && !key.meta && input === "k")) {
				onUp?.();
				return;
			}

			if (key.downArrow || (!key.ctrl && !key.meta && input === "j")) {
				onDown?.();
				return;
			}

			if (key.return) {
				onSelect?.();
				return;
			}

			if (
				key.delete ||
				key.backspace ||
				(!key.ctrl && !key.meta && input === "d")
			) {
				onDelete?.();
				return;
			}

			if (!key.ctrl && !key.meta && input === "r") {
				onRename?.();
				return;
			}

			if (!key.ctrl && !key.meta && input === "/") {
				onSearch?.();
				return;
			}
		},
		{ isActive },
	);
}
