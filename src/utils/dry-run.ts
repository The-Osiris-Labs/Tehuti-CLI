import { Command } from "commander";
import { logger } from "./logger.js";

export interface DryRunOptions {
	enabled: boolean;
	logActions?: boolean;
}

class DryRunManager {
	private enabled = false;
	private actions: Array<{ type: string; args: unknown[]; timestamp: number }> = [];

	enable(): void {
		this.enabled = true;
		logger.info("🏃 Dry-run mode enabled - no changes will be made");
	}

	disable(): void {
		this.enabled = false;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Record an action that would have been executed
	 */
	recordAction(type: string, ...args: unknown[]): void {
		if (!this.enabled) return;

		this.actions.push({
			type,
			args,
			timestamp: Date.now(),
		});

		logger.info(`[DRY-RUN] ${type}:`, ...args);
	}

	/**
	 * Check if a file write would be executed
	 */
	wouldWriteFile(path: string, content: string): boolean {
		if (!this.enabled) return false;
		this.recordAction("writeFile", path, `<${content.length} chars>`);
		return true;
	}

	/**
	 * Check if a command would be executed
	 */
	wouldExecuteCommand(command: string, args: string[] = []): boolean {
		if (!this.enabled) return false;
		this.recordAction("executeCommand", command, ...args);
		return true;
	}

	/**
	 * Check if a directory would be created
	 */
	wouldCreateDirectory(path: string): boolean {
		if (!this.enabled) return false;
		this.recordAction("createDirectory", path);
		return true;
	}

	/**
	 * Check if a file would be deleted
	 */
	wouldDeleteFile(path: string): boolean {
		if (!this.enabled) return false;
		this.recordAction("deleteFile", path);
		return true;
	}

	/**
	 * Get all recorded actions
	 */
	getActions(): Array<{ type: string; args: unknown[]; timestamp: number }> {
		return [...this.actions];
	}

	/**
	 * Clear recorded actions
	 */
	clearActions(): void {
		this.actions = [];
	}

	/**
	 * Get summary of dry-run actions
	 */
	getSummary(): string {
		if (!this.enabled || this.actions.length === 0) {
			return "No actions recorded";
		}

		const summary = [
			`\n🏃 Dry-Run Summary: ${this.actions.length} action(s) would be executed:`,
			"─".repeat(60),
		];

		const grouped = new Map<string, number>();
		for (const action of this.actions) {
			grouped.set(action.type, (grouped.get(action.type) || 0) + 1);
		}

		for (const [type, count] of grouped) {
			summary.push(`  • ${type}: ${count}`);
		}

		summary.push("─".repeat(60));
		summary.push("No changes were made (dry-run mode)\n");

		return summary.join("\n");
	}
}

let globalDryRunManager: DryRunManager | null = null;

export function getDryRunManager(): DryRunManager {
	if (!globalDryRunManager) {
		globalDryRunManager = new DryRunManager();
	}
	return globalDryRunManager;
}

export function resetDryRun(): void {
	if (globalDryRunManager) {
		globalDryRunManager.disable();
		globalDryRunManager.clearActions();
	}
}

/**
 * Add dry-run options to a Commander command
 */
export function addDryRunOptions(command: Command): Command {
	return command.option(
		"--dry-run",
		"Show what would be done without making changes",
		false,
	);
}

/**
 * Initialize dry-run from CLI options
 */
export function initializeDryRun(options: { dryRun?: boolean }): void {
	if (options.dryRun) {
		getDryRunManager().enable();
	}
}

export { DryRunManager };
