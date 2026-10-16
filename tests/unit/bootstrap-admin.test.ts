import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { secret } from '../../scripts/bootstrap-admin-input.mjs';

interface MemoryOutput {
  readonly value: string;
  write(chunk: string): void;
}

class FakeTerminal extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = false;
  pauseCalls = 0;

  setRawMode(value: boolean) {
    this.isRaw = value;
  }

  resume() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }
}

function output(): MemoryOutput {
  let value = '';
  return {
    get value() {
      return value;
    },
    write(chunk: string) {
      value += chunk;
    },
  };
}

describe('bootstrap administrator input', () => {
  it('publishes the prompt only after input is raw and observed, then releases input after completion', async () => {
    const input = new FakeTerminal();
    const writes: string[] = [];
    const terminalOutput: MemoryOutput = {
      get value() {
        return writes.join('');
      },
      write(chunk: string) {
        expect(input.isRaw).toBe(true);
        expect(input.listenerCount('data')).toBe(1);
        writes.push(chunk);
      },
    };
    const value = secret(input, terminalOutput, new EventEmitter());
    input.emit('data', Buffer.from('fictional-password\u007fx\nignored'));
    await expect(value).resolves.toBe('fictional-passworx');
    expect(terminalOutput.value).toBe('Password: \n');
    expect(input.isRaw).toBe(false);
    expect(input.paused).toBe(true);
    expect(input.pauseCalls).toBe(1);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('releases input and restores terminal mode when input ends or Ctrl-C cancels', async () => {
    const eofInput = new FakeTerminal();
    const eof = secret(eofInput, output(), new EventEmitter());
    eofInput.emit('end');
    await expect(eof).rejects.toThrow('BOOTSTRAP_INPUT_EOF');
    expect(eofInput.isRaw).toBe(false);
    expect(eofInput.paused).toBe(true);
    expect(eofInput.pauseCalls).toBe(1);
    expect(eofInput.listenerCount('data')).toBe(0);

    const cancelInput = new FakeTerminal();
    const cancelled = secret(cancelInput, output(), new EventEmitter());
    cancelInput.emit('data', Buffer.from('\u0003'));
    await expect(cancelled).rejects.toThrow('BOOTSTRAP_CANCELLED');
    expect(cancelInput.isRaw).toBe(false);
    expect(cancelInput.paused).toBe(true);
    expect(cancelInput.pauseCalls).toBe(1);
    expect(cancelInput.listenerCount('data')).toBe(0);
  });
});
