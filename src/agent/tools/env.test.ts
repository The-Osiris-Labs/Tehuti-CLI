import { describe, it, expect } from 'vitest';
import { envTools } from './env.js';

describe('env_inspect', () => {
  it('should have correct tool definition', () => {
    const tool = envTools[0];
    expect(tool.name).toBe('env_inspect');
    expect(tool.category).toBe('system');
  });
});
