export const BASH_COMPLETION = `#!/bin/bash
_tehuti_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init chat daemon companion doctor skills tools trace --help --version --model --provider --resume --json --quiet --debug"

  if [[ \${cur} == -* ]]; then
    COMPREPLY=( $(compgen -W "--help --version --model --provider --resume --json --quiet --debug" -- \${cur}) )
  else
    COMPREPLY=( $(compgen -W "\${commands}" -- \${cur}) )
  fi
  return 0
}
complete -F _tehuti_completions tehuti
`;

export const ZSH_COMPLETION = `#compdef tehuti

_tehuti() {
  _arguments \\
    '1:command:(init chat daemon companion doctor skills tools trace)' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '--model[Model to use]:model:' \\
    '--provider[Provider to use]:provider:' \\
    '--resume[Resume a session]' \\
    '--json[JSON output]' \\
    '--quiet[Suppress output]' \\
    '--debug[Debug mode]'
}

_tehuti "$@"
`;

export const FISH_COMPLETION = `complete -c tehuti -f
complete -c tehuti -n '__fish_use_subcommand' -a init -d 'Initialize configuration'
complete -c tehuti -n '__fish_use_subcommand' -a chat -d 'Start interactive chat'
complete -c tehuti -n '__fish_use_subcommand' -a daemon -d 'Manage daemon'
complete -c tehuti -n '__fish_use_subcommand' -a companion -d 'Start companion mode'
complete -c tehuti -n '__fish_use_subcommand' -a doctor -d 'Check system health'
complete -c tehuti -n '__fish_use_subcommand' -a skills -d 'List skills'
complete -c tehuti -n '__fish_use_subcommand' -a tools -d 'List tools'
complete -c tehuti -n '__fish_use_subcommand' -a trace -d 'View trace logs'
complete -c tehuti -l model -d 'Model to use'
complete -c tehuti -l provider -d 'Provider to use'
complete -c tehuti -l resume -d 'Resume a session'
complete -c tehuti -l json -d 'JSON output'
complete -c tehuti -l quiet -d 'Suppress output'
complete -c tehuti -l debug -d 'Debug mode'
`;

export function installCompletions(shell: 'bash' | 'zsh' | 'fish'): string {
  switch (shell) {
    case 'bash': return BASH_COMPLETION;
    case 'zsh': return ZSH_COMPLETION;
    case 'fish': return FISH_COMPLETION;
  }
}
