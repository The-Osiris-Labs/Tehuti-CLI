import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('renders success status', () => {
    const { lastFrame } = render(<StatusBadge kind="success" />);
    const output = lastFrame();
    expect(output).toContain('Success');
  });

  it('renders error status', () => {
    const { lastFrame } = render(<StatusBadge kind="error" />);
    const output = lastFrame();
    expect(output).toContain('Failed');
  });

  it('renders warning status', () => {
    const { lastFrame } = render(<StatusBadge kind="warning" />);
    const output = lastFrame();
    expect(output).toContain('Warning');
  });

  it('renders info status', () => {
    const { lastFrame } = render(<StatusBadge kind="info" />);
    const output = lastFrame();
    expect(output).toContain('Info');
  });

  it('renders pending status', () => {
    const { lastFrame } = render(<StatusBadge kind="pending" />);
    const output = lastFrame();
    expect(output).toContain('Pending');
  });

  it('renders running status', () => {
    const { lastFrame } = render(<StatusBadge kind="running" />);
    const output = lastFrame();
    expect(output).toContain('Running');
  });

  it('renders idle status', () => {
    const { lastFrame } = render(<StatusBadge kind="idle" />);
    const output = lastFrame();
    expect(output).toContain('Idle');
  });

  it('renders killed status', () => {
    const { lastFrame } = render(<StatusBadge kind="killed" />);
    const output = lastFrame();
    expect(output).toContain('Killed');
  });

  it('renders cached status', () => {
    const { lastFrame } = render(<StatusBadge kind="cached" />);
    const output = lastFrame();
    expect(output).toContain('Cached');
  });

  it('renders readonly status', () => {
    const { lastFrame } = render(<StatusBadge kind="readonly" />);
    const output = lastFrame();
    expect(output).toContain('Read');
  });

  it('renders mutating status', () => {
    const { lastFrame } = render(<StatusBadge kind="mutating" />);
    const output = lastFrame();
    expect(output).toContain('Mutate');
  });

  it('renders verified status', () => {
    const { lastFrame } = render(<StatusBadge kind="verified" />);
    const output = lastFrame();
    expect(output).toContain('Verified');
  });

  it('renders speculative status', () => {
    const { lastFrame } = render(<StatusBadge kind="speculative" />);
    const output = lastFrame();
    expect(output).toContain('Speculative');
  });

  it('renders thinking status', () => {
    const { lastFrame } = render(<StatusBadge kind="thinking" />);
    const output = lastFrame();
    expect(output).toContain('Thinking');
  });

  it('uses custom label when provided', () => {
    const { lastFrame } = render(<StatusBadge kind="success" label="Complete" />);
    const output = lastFrame();
    expect(output).toContain('Complete');
    expect(output).not.toContain('Success');
  });

  it('renders in compact mode', () => {
    const { lastFrame } = render(<StatusBadge kind="success" compact={true} />);
    const output = lastFrame();
    expect(output).not.toContain('Success');
  });

  it('renders with emphasis', () => {
    const { lastFrame } = render(<StatusBadge kind="error" emphasize={true} />);
    const output = lastFrame();
    expect(output).toContain('Failed');
  });

  it('handles all status kinds without crashing', () => {
    const kinds = [
      'success', 'error', 'warning', 'info', 'pending',
      'running', 'idle', 'killed', 'cached', 'readonly',
      'mutating', 'verified', 'speculative', 'thinking'
    ];

    kinds.forEach(kind => {
      const { lastFrame } = render(<StatusBadge kind={kind as any} />);
      expect(lastFrame()).toBeTruthy();
    });
  });
});
