interface TerminalInput {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode(value: boolean): void;
  resume(): unknown;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  once(event: 'end' | 'close', listener: () => void): unknown;
  off(event: 'data', listener: ((chunk: Buffer) => void) | undefined): unknown;
  off(event: 'end' | 'close', listener: (() => void) | undefined): unknown;
}

interface TerminalOutput {
  write(chunk: string): unknown;
}

interface SignalEvents {
  once(event: 'SIGINT', listener: () => void): unknown;
  off(event: 'SIGINT', listener: (() => void) | undefined): unknown;
}

export function secret(
  input: TerminalInput,
  output: TerminalOutput,
  signals?: SignalEvents,
): Promise<string>;
export function publicInput(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<{ username: string; name: string }>;
