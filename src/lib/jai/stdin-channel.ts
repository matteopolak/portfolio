/*
 * The worker's side of a program's standard input. The compiler module asks
 * the page for bytes through the `jai_stdin_read` host function and is
 * suspended (JSPI) until the promise settles; this queue turns that into
 * messages to the terminal on the main thread and back.
 */

export interface StdinChannelOptions {
  /** Tells the page the program waits for input. */
  request(): void;
}

const encoder = new TextEncoder();

export class StdinChannel {
  readonly #request: () => void;
  /** Bytes the program has not read yet. */
  #buffer = new Uint8Array(0);
  /** The end of input arrived and has not been read. */
  #ended = false;
  #waiting: ((bytes: Uint8Array) => void) | undefined;

  constructor({ request }: StdinChannelOptions) {
    this.#request = request;
  }

  /** Whether a read is suspended waiting for the page. */
  get waiting() {
    return this.#waiting !== undefined;
  }

  /**
   * At most `capacity` bytes for the program: now when some are buffered (or
   * the end of input is), otherwise once the page answers. An empty result is
   * the end of input.
   */
  read(capacity: number): Uint8Array | Promise<Uint8Array> {
    if (this.#waiting) throw new Error('stdin is already being read');
    const ready = this.#take(capacity);
    if (ready) return ready;
    return new Promise((resolve) => {
      this.#waiting = (bytes) => resolve(bytes);
      this.#capacity = capacity;
      this.#request();
    });
  }

  #capacity = 0;

  /** Input from the terminal: text typed (a line), or `null` for the end of input. */
  push(text: string | null) {
    if (text === null) this.#ended = true;
    else {
      const bytes = encoder.encode(text);
      const joined = new Uint8Array(this.#buffer.length + bytes.length);
      joined.set(this.#buffer);
      joined.set(bytes, this.#buffer.length);
      this.#buffer = joined;
    }
    const waiting = this.#waiting;
    if (!waiting) return;
    const ready = this.#take(this.#capacity);
    if (!ready) return;
    this.#waiting = undefined;
    waiting(ready);
  }

  /** Forgets buffered input and ends a read in progress (a run starts or ends). */
  reset() {
    this.#buffer = new Uint8Array(0);
    this.#ended = false;
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.(new Uint8Array(0));
  }

  #take(capacity: number): Uint8Array | undefined {
    if (this.#buffer.length) {
      const bytes = this.#buffer.slice(0, capacity);
      this.#buffer = this.#buffer.slice(bytes.length);
      return bytes;
    }
    if (this.#ended) {
      this.#ended = false;
      return new Uint8Array(0);
    }
    return undefined;
  }
}
