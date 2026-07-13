import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusIndicator } from './StatusIndicator.js';

describe('StatusIndicator', () => {
  it('renders success status', () => {
    const { lastFrame } = render(<StatusIndicator status="success" />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });

  it('renders error status', () => {
    const { lastFrame } = render(<StatusIndicator status="error" />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });

  it('renders loading status', () => {
    const { lastFrame } = render(<StatusIndicator status="loading" />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });

  it('handles all valid status types', () => {
    const statuses = ['success', 'error', 'loading'] as const;
    
    statuses.forEach(status => {
      const { lastFrame } = render(<StatusIndicator status={status} />);
      expect(lastFrame()).toBeTruthy();
    });
  });
});
