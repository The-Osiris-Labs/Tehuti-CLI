import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { TehutiHeader } from './TehutiHeader.js';

describe('TehutiHeader', () => {
  it('renders in full mode by default', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('TEHUTI');
    expect(output).toContain('THOTH');
  });

  it('renders in compact mode', () => {
    const { lastFrame } = render(<TehutiHeader compact={true} />);
    const output = lastFrame();
    expect(output).toContain('TEHUTI');
  });

  it('displays model name when provided', () => {
    const { lastFrame } = render(<TehutiHeader model="gpt-4" />);
    const output = lastFrame();
    expect(output).toContain('Model: gpt-4');
  });

  it('displays provider when provided', () => {
    const { lastFrame } = render(<TehutiHeader provider="openai" />);
    const output = lastFrame();
    expect(output).toContain('API: openai');
  });

  it('shows "Unknown" for model when not provided', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('Model: Unknown');
  });

  it('shows "Unknown" for provider when not provided', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('API: Unknown');
  });

  it('displays streaming status', () => {
    const { lastFrame } = render(<TehutiHeader isStreaming={true} />);
    const output = lastFrame();
    expect(output).toContain('Thinking');
  });

  it('displays companion mode status', () => {
    const { lastFrame } = render(<TehutiHeader companionMode={true} />);
    const output = lastFrame();
    expect(output).toContain('Companion');
  });

  it('displays daemon connected status', () => {
    const { lastFrame } = render(<TehutiHeader daemonStatus="connected" />);
    const output = lastFrame();
    expect(output).toContain('Daemon Connected');
  });

  it('displays idle status when not streaming', () => {
    const { lastFrame } = render(<TehutiHeader isStreaming={false} />);
    const output = lastFrame();
    expect(output).toContain('Idle');
  });

  it('displays session name when provided', () => {
    const { lastFrame } = render(
      <TehutiHeader compact={true} sessionName="Test Session" />
    );
    const output = lastFrame();
    expect(output).toContain('Test Session');
  });

  it('displays update badge when hasUpdate is true', () => {
    const { lastFrame } = render(<TehutiHeader hasUpdate={true} />);
    const output = lastFrame();
    expect(output).toContain('UPDATE');
  });

  it('does not display update badge when hasUpdate is false', () => {
    const { lastFrame } = render(<TehutiHeader hasUpdate={false} />);
    const output = lastFrame();
    expect(output).not.toContain('UPDATE');
  });

  it('displays command shortcuts in full mode', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('/help');
    expect(output).toContain('/clear');
    expect(output).toContain('/exit');
  });

  it('displays tagline in full mode', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('T H O T H, T O N G U E O F R A');
  });

  it('displays subtitle in full mode', () => {
    const { lastFrame } = render(<TehutiHeader />);
    const output = lastFrame();
    expect(output).toContain('Write • Edit • Transform');
  });

  it('handles all props together', () => {
    const { lastFrame } = render(
      <TehutiHeader
        compact={false}
        model="claude-3"
        provider="anthropic"
        daemonStatus="connected"
        isStreaming={true}
        sessionName="My Session"
        hasUpdate={true}
      />
    );
    const output = lastFrame();
    expect(output).toContain('TEHUTI');
    expect(output).toContain('claude-3');
    expect(output).toContain('anthropic');
  });
});
