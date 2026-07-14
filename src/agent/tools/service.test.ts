import { describe, it, expect } from 'vitest';
import { serviceTools } from './service.js';

describe('service_status', () => {
  it('should have correct tool definition', () => {
    const tool = serviceTools[0];
    expect(tool.name).toBe('service_status');
    expect(tool.category).toBe('system');
  });
});
