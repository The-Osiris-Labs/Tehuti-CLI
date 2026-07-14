import { describe, it, expect } from 'vitest';
import { installCompletions, BASH_COMPLETION, ZSH_COMPLETION, FISH_COMPLETION } from './completions.js';

describe('Shell completions', () => {
  it('should return bash completion script', () => {
    const result = installCompletions('bash');
    expect(result).toBe(BASH_COMPLETION);
    expect(result).toContain('complete -F _tehuti_completions tehuti');
  });

  it('should return zsh completion script', () => {
    const result = installCompletions('zsh');
    expect(result).toBe(ZSH_COMPLETION);
    expect(result).toContain('#compdef tehuti');
  });

  it('should return fish completion script', () => {
    const result = installCompletions('fish');
    expect(result).toBe(FISH_COMPLETION);
    expect(result).toContain('complete -c tehuti');
  });
});
