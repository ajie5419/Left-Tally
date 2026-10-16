import readline from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';

/** This owns raw mode only after the public readline interface has been closed. */
export async function secret(input, output, signals = process) {
  if (!input.isTTY) throw new Error('BOOTSTRAP_TTY_REQUIRED');
  const wasRaw = input.isRaw === true;
  const decoder = new StringDecoder('utf8');
  let onData;
  let onEnd;
  let onSignal;
  try {
    return await new Promise((resolve, reject) => {
      let value = '';
      let finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        output.write('\n');
        if (error) reject(error);
        else resolve(value);
      };
      const append = (text) => {
        for (const character of text) {
          if (character === '\u0003') {
            finish(new Error('BOOTSTRAP_CANCELLED'));
            return;
          }
          if (character === '\r' || character === '\n') {
            finish();
            return;
          }
          if (character === '\b' || character === '\u007f')
            value = Array.from(value).slice(0, -1).join('');
          else if (character !== '\u0000') value += character;
        }
      };
      onData = (chunk) => append(decoder.write(chunk));
      onEnd = () => {
        append(decoder.end());
        if (!finished) finish(new Error('BOOTSTRAP_INPUT_EOF'));
      };
      onSignal = () => finish(new Error('BOOTSTRAP_CANCELLED'));
      input.on('data', onData);
      input.once('end', onEnd);
      input.once('close', onEnd);
      signals.once('SIGINT', onSignal);
      input.setRawMode(true);
      input.resume();
      // A visible prompt is the readiness boundary: typed data is already raw and observed.
      output.write('Password: ');
    });
  } finally {
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('close', onEnd);
    signals.off('SIGINT', onSignal);
    input.setRawMode(wasRaw);
    input.pause();
  }
}

export async function publicInput(input, output) {
  const interactive = readline.createInterface({ input, output });
  try {
    return {
      username: (await interactive.question('Username: ')).trim(),
      name: (await interactive.question('Display name: ')).trim(),
    };
  } finally {
    interactive.close();
  }
}
