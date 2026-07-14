import { describe, it, expect } from 'vitest';
import { networkTools } from './network.js';

describe('network_check', () => {
  it('should have correct tool definition', () => {
    const tool = networkTools[0];
    expect(tool.name).toBe('network_check');
    expect(tool.category).toBe('system');
  });
});
