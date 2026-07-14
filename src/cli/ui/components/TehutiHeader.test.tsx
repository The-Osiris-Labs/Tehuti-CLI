import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { MouseProvider } from '@ink-tools/ink-mouse';
import { TehutiHeader, type TehutiHeaderProps } from './TehutiHeader.js';

function TestHeader(props: TehutiHeaderProps) {
  return (
    <MouseProvider>
      <TehutiHeader {...props} />
    </MouseProvider>
  );
}

describe('TehutiHeader', () => {
  it('renders in full mode with enhanced splash', () => {
    const { lastFrame } = render(<TestHeader />);
    const output = lastFrame();
    expect(output).toContain('Scribe of Code Transformations');
  });

  it('renders in compact mode', () => {
    const { lastFrame } = render(<TestHeader compact={true} />);
    const output = lastFrame();
    expect(output).toContain('Unknown');
  });

  it('displays model name when provided', () => {
    const { lastFrame } = render(<TestHeader model="gpt-4" />);
    const output = lastFrame();
    expect(output).toContain('Model: gpt-4');
  });

  it('displays provider when provided', () => {
    const { lastFrame } = render(<TestHeader provider="openai" />);
    const output = lastFrame();
    expect(output).toContain('Provider: openai');
  });

  it('shows "Unknown" for model when not provided', () => {
    const { lastFrame } = render(<TestHeader />);
    const output = lastFrame();
    expect(output).toContain('Model: Unknown');
  });

  it('shows "Unknown" for provider when not provided', () => {
    const { lastFrame } = render(<TestHeader />);
    const output = lastFrame();
    expect(output).toContain('Provider: Unknown');
  });

  it('displays streaming status', () => {
    const { lastFrame } = render(<TestHeader isStreaming={true} />);
    const output = lastFrame();
    expect(output).toContain('Thinking');
  });

  it('displays companion mode status', () => {
    const { lastFrame } = render(<TestHeader companionMode={true} />);
    const output = lastFrame();
    expect(output).toContain('Companion');
  });

  it('displays daemon connected status', () => {
    const { lastFrame } = render(<TestHeader daemonStatus="connected" />);
    const output = lastFrame();
    expect(output).toContain('Daemon Connected');
  });

  it('displays idle status when not streaming', () => {
    const { lastFrame } = render(<TestHeader isStreaming={false} />);
    const output = lastFrame();
    expect(output).toContain('Idle');
  });

  it('handles all props together', () => {
    const { lastFrame } = render(
      <TestHeader
        compact={false}
        model="claude-3"
        provider="anthropic"
        daemonStatus="connected"
        isStreaming={true}
        hasUpdate={true}
      />
    );
    const output = lastFrame();
    expect(output).toContain('claude-3');
    expect(output).toContain('anthropic');
  });

});
