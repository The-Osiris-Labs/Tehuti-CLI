import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AutocompleteEntry {
	name: string;
	description?: string;
	aliases?: string[];
}

export interface AutocompleteSuggestion {
	value: string;
	description?: string;
	score: number;
}

const SHELL_COMPLETION_SCRIPTS: Record<string, string> = {
	bash: `# Tehuti CLI Bash Completion
_tehuti_completions() {
  local cur prev commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init update config mcp doctor session skills trace tools plugins completions"
  
  case "\${prev}" in
    tehuti)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      ;;
    -p|--provider)
      COMPREPLY=( $(compgen -W "openrouter openai anthropic ollama custom" -- "\${cur}") )
      ;;
    -m|--model)
      COMPREPLY=( $(compgen -W "gpt-4o claude-3.5-sonnet deepseek-v4-flash gemini-pro" -- "\${cur}") )
      ;;
    --verbose-level)
      COMPREPLY=( $(compgen -W "silent normal verbose debug trace" -- "\${cur}") )
      ;;
    mcp)
      COMPREPLY=( $(compgen -W "status tools connect disconnect refresh" -- "\${cur}") )
      ;;
    plugins)
      COMPREPLY=( $(compgen -W "list install remove enable disable info" -- "\${cur}") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      ;;
  esac
  return 0
}
complete -F _tehuti_completions tehuti
complete -F _tehuti_completions npx`,

	zsh: `# Tehuti CLI Zsh Completion
#compdef tehuti

_tehuti() {
  local -a commands
  commands=(
    'init:Configure Tehuti CLI settings'
    'update:Update Tehuti CLI to the latest version'
    'config:Show current configuration'
    'mcp:MCP server management'
    'doctor:Run diagnostics'
    'session:Session management'
    'skills:Skills management'
    'trace:Trace analysis'
    'tools:Tool management'
    'plugins:Plugin management'
    'completions:Generate shell completions'
  )
  
  local -a providers
  providers=('openrouter' 'openai' 'anthropic' 'ollama' 'custom')
  
  local -a verbose_levels
  verbose_levels=('silent' 'normal' 'verbose' 'debug' 'trace')
  
  _arguments -C \\
    '(-m --model)'{-m,--model}'[Override model]:model:' \\
    '(-p --provider)'{-p,--provider}'[Override provider]:provider:(openrouter openai anthropic ollama custom)' \\
    '(-d --debug)'{-d,--debug}'[Debug mode]' \\
    '(-j --json)'{-j,--json}'[Output in JSON format]' \\
    '(-q --quiet)'{-q,--quiet}'[Suppress tool output]' \\
    '--diff[Show diff preview before file edits]' \\
    '--diff-auto[Show diff and auto-approve]' \\
    '--no-mcp[Disable MCP]' \\
    '--reset-key[Reset API key]' \\
    '(-c --continue)'{-c,--continue}'[Continue previous session]' \\
    '--verbose[Enable verbose output]' \\
    '--verbose-level[Verbose level]:level:(silent normal verbose debug trace)' \\
    '--dry-run[Show what would be done without changes]' \\
    '1:command:->command' \\
    '*::arg:->args'
  
  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "$words[1]" in
        mcp)
          _values 'mcp action' status tools connect disconnect refresh
          ;;
        plugins)
          _values 'plugin action' list install remove enable disable info
          ;;
      esac
      ;;
  esac
}

_tehuti "$@"`,

	fish: `# Tehuti CLI Fish Completion
complete -c tehuti -n "__fish_use_subcommand" -a init -d "Configure Tehuti CLI settings"
complete -c tehuti -n "__fish_use_subcommand" -a update -d "Update Tehuti CLI"
complete -c tehuti -n "__fish_use_subcommand" -a config -d "Show current configuration"
complete -c tehuti -n "__fish_use_subcommand" -a mcp -d "MCP server management"
complete -c tehuti -n "__fish_use_subcommand" -a doctor -d "Run diagnostics"
complete -c tehuti -n "__fish_use_subcommand" -a session -d "Session management"
complete -c tehuti -n "__fish_use_subcommand" -a skills -d "Skills management"
complete -c tehuti -n "__fish_use_subcommand" -a trace -d "Trace analysis"
complete -c tehuti -n "__fish_use_subcommand" -a tools -d "Tool management"
complete -c tehuti -n "__fish_use_subcommand" -a plugins -d "Plugin management"
complete -c tehuti -n "__fish_use_subcommand" -a completions -d "Generate shell completions"

# Global options
complete -c tehuti -s m -l model -d "Override model"
complete -c tehuti -s p -l provider -d "Override provider" -xa "openrouter openai anthropic ollama custom"
complete -c tehuti -s d -l debug -d "Debug mode"
complete -c tehuti -s j -l json -d "Output in JSON format"
complete -c tehuti -s q -l quiet -d "Suppress tool output"
complete -c tehuti -l diff -d "Show diff preview"
complete -c tehuti -l diff-auto -d "Auto-approve diffs"
complete -c tehuti -l no-mcp -d "Disable MCP"
complete -c tehuti -l reset-key -d "Reset API key"
complete -c tehuti -s c -l continue -d "Continue previous session"
complete -c tehuti -l verbose -d "Enable verbose output"
complete -c tehuti -l verbose-level -d "Verbose level" -xa "silent normal verbose debug trace"
complete -c tehuti -l dry-run -d "Show what would be done"

# Subcommand completions
complete -c tehuti -n "__fish_seen_subcommand_from mcp" -a "status tools connect disconnect refresh"
complete -c tehuti -n "__fish_seen_subcommand_from plugins" -a "list install remove enable disable info"`,
};

export class AutocompleteManager {
	private entries: Map<string, AutocompleteEntry> = new Map();

	constructor() {
		// Register built-in commands
		this.registerCommand("init", "Configure Tehuti CLI settings");
		this.registerCommand("update", "Update Tehuti CLI to the latest version");
		this.registerCommand("config", "Show current configuration");
		this.registerCommand("mcp", "MCP server management");
		this.registerCommand("doctor", "Run diagnostics");
		this.registerCommand("session", "Session management");
		this.registerCommand("skills", "Skills management");
		this.registerCommand("trace", "Trace analysis");
		this.registerCommand("tools", "Tool management");
		this.registerCommand("plugins", "Plugin management");
		this.registerCommand("completions", "Generate shell completions");
	}

	registerCommand(
		name: string,
		description?: string,
		aliases?: string[],
	): void {
		this.entries.set(name, { name, description, aliases });
	}

	unregisterCommand(name: string): void {
		this.entries.delete(name);
	}

	getCommands(): AutocompleteEntry[] {
		return Array.from(this.entries.values());
	}

	getCommandNames(): string[] {
		return Array.from(this.entries.keys());
	}

	/**
	 * Get suggestions for a partial input
	 */
	suggest(input: string): AutocompleteSuggestion[] {
		const suggestions: AutocompleteSuggestion[] = [];
		const lowerInput = input.toLowerCase();

		for (const [name, entry] of this.entries) {
			if (name.toLowerCase().startsWith(lowerInput)) {
				suggestions.push({
					value: name,
					description: entry.description,
					score: 1.0,
				});
			} else if (name.toLowerCase().includes(lowerInput)) {
				suggestions.push({
					value: name,
					description: entry.description,
					score: 0.5,
				});
			}

			// Check aliases
			if (entry.aliases) {
				for (const alias of entry.aliases) {
					if (alias.toLowerCase().startsWith(lowerInput)) {
						suggestions.push({
							value: name,
							description: entry.description,
							score: 0.8,
						});
					}
				}
			}
		}

		return suggestions.sort((a, b) => b.score - a.score);
	}

	/**
	 * Generate completion script for a specific shell
	 */
	generateCompletionScript(shell: string): string {
		const script = SHELL_COMPLETION_SCRIPTS[shell];
		if (!script) {
			throw new Error(
				`Unsupported shell: ${shell}. Supported: ${Object.keys(SHELL_COMPLETION_SCRIPTS).join(", ")}`,
			);
		}
		return script;
	}

	/**
	 * Install completion script for the current shell
	 */
	installCompletion(shell?: string): string {
		const detectedShell = shell || this.detectShell();
		if (!detectedShell) {
			throw new Error("Could not detect shell. Please specify --shell <shell>");
		}

		const script = this.generateCompletionScript(detectedShell);
		const configPath = this.getCompletionPath(detectedShell);

		if (configPath) {
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, script, "utf-8");
			return configPath;
		}

		return script;
	}

	/**
	 * Detect the user's current shell
	 */
	detectShell(): string | null {
		const shellEnv = process.env.SHELL || "";
		if (shellEnv.includes("zsh")) return "zsh";
		if (shellEnv.includes("bash")) return "bash";
		if (shellEnv.includes("fish")) return "fish";
		return null;
	}

	/**
	 * Get the path where completion scripts should be installed
	 */
	private getCompletionPath(shell: string): string | null {
		const home = os.homedir();

		switch (shell) {
			case "bash":
				return path.join(home, ".local", "share", "bash-completion", "completions", "tehuti");
			case "zsh":
				return path.join(home, ".zsh", "completions", "_tehuti");
			case "fish":
				return path.join(home, ".config", "fish", "completions", "tehuti.fish");
			default:
				return null;
		}
	}
}

let globalAutocomplete: AutocompleteManager | null = null;

export function getAutocompleteManager(): AutocompleteManager {
	if (!globalAutocomplete) {
		globalAutocomplete = new AutocompleteManager();
	}
	return globalAutocomplete;
}

export { SHELL_COMPLETION_SCRIPTS };
