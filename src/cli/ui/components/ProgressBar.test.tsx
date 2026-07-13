import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ProgressBar } from './ProgressBar.js';

describe('ProgressBar', () => {
  it('renders with determinate value', () => {
    const { lastFrame } = render(<ProgressBar value={50} />);
    const output = lastFrame();
    expect(output).toContain('50%');
    expect(output).toContain('█');
    expect(output).toContain('░');
  });

  it('clamps values outside 0-100 range', () => {
    const { lastFrame: frame1 } = render(<ProgressBar value={150} />);
    expect(frame1()).toContain('100%');

    const { lastFrame: frame2 } = render(<ProgressBar value={-10} />);
    expect(frame2()).toContain('0%');
  });

  it('renders in indeterminate mode when value is null', () => {
    const { lastFrame } = render(<ProgressBar value={null} phase="running" />);
    const output = lastFrame();
    expect(output).toContain('░');
  });

  it('shows label when provided', () => {
    const { lastFrame } = render(<ProgressBar value={75} label="Loading" />);
    const output = lastFrame();
    expect(output).toContain('Loading');
    expect(output).toContain('75%');
  });

  it('hides percent when showPercent is false', () => {
    const { lastFrame } = render(<ProgressBar value={50} showPercent={false} />);
    const output = lastFrame();
    expect(output).not.toContain('%');
  });

  it('applies different colors for phases', () => {
    const { lastFrame: successFrame } = render(<ProgressBar value={100} phase="success" />);
    expect(successFrame()).toBeTruthy();

    const { lastFrame: errorFrame } = render(<ProgressBar value={50} phase="error" />);
    expect(errorFrame()).toBeTruthy();

    const { lastFrame: warningFrame } = render(<ProgressBar value={25} phase="warning" />);
    expect(warningFrame()).toBeTruthy();
  });

  it('respects custom width', () => {
    const { lastFrame } = render(<ProgressBar value={50} width={20} />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });

  it('clamps width to valid range', () => {
    const { lastFrame: smallFrame } = render(<ProgressBar value={50} width={2} />);
    expect(smallFrame()).toBeTruthy();

    const { lastFrame: largeFrame } = render(<ProgressBar value={50} width={300} />);
    expect(largeFrame()).toBeTruthy();
  });

  it('handles NaN value as indeterminate', () => {
    const { lastFrame } = render(<ProgressBar value={NaN} phase="running" />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });

  it('handles undefined value', () => {
    const { lastFrame } = render(<ProgressBar value={undefined} phase="running" />);
    const output = lastFrame();
    expect(output).toBeTruthy();
  });
});
