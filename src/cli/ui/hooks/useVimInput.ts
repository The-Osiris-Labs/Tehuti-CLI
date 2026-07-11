import { useInput } from "ink";
import { isEnterKey } from "../../../utils/keyboard.js";

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
			if (key.ctrl || key.meta) {
				return;
			}

			if (key.upArrow || input === "k") {
				onUp?.();
				return;
			}

			if (key.downArrow || input === "j") {
				onDown?.();
				return;
			}

			if (isEnterKey(input, key)) {
				onSelect?.();
				return;
			}

			if (key.delete || key.backspace || input === "d") {
				onDelete?.();
				return;
			}

			if (input === "r") {
				onRename?.();
				return;
			}

			if (input === "/") {
				onSearch?.();
				return;
			}
		},
		{ isActive },
	);
}
