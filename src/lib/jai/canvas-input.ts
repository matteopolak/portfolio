/*
 * Keyboard, mouse and focus events of the Render tab's canvas, as the
 * Canvas_Event records stdlib/Input/wasm.jai reads (via the bundle's
 * webgpu_host.mjs): type 1 key or button, 2 text, 3 pointer move, 4 wheel,
 * 5 resize, 6 focus, 7 quit; modifiers 1 shift, 2 ctrl, 4 alt, 8 meta. Key
 * codes are stdlib/Input's Key_Code values, which the page maps itself.
 */
import type { CanvasInputEvent } from './lsp-types.ts';

/** Key_Code values of stdlib/Input/module.jai. */
export const KEY = {
  ESCAPE: 0,
  MOUSE_BUTTON_LEFT: 1,
  ARROW_UP: 2,
  ARROW_DOWN: 3,
  ARROW_LEFT: 4,
  ARROW_RIGHT: 5,
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  SPACEBAR: 32,
  DELETE: 127,
  PAGE_UP: 132,
  PAGE_DOWN: 133,
  HOME: 134,
  END: 135,
  INSERT: 136,
  PAUSE: 137,
  SCROLL_LOCK: 138,
  ALT: 139,
  CTRL: 140,
  SHIFT: 141,
  CMD: 142,
  /** F1 .. F24 follow CMD: F<n> is F1 + n - 1. */
  F1: 143,
  PRINT_SCREEN: 167,
  MOUSE_BUTTON_MIDDLE: 169,
  MOUSE_BUTTON_RIGHT: 170,
  UNKNOWN: 306,
} as const;

/** `KeyboardEvent.key` names with a Key_Code of their own. */
const NAMED_KEYS: Readonly<Record<string, number>> = {
  Escape: KEY.ESCAPE,
  ArrowUp: KEY.ARROW_UP,
  ArrowDown: KEY.ARROW_DOWN,
  ArrowLeft: KEY.ARROW_LEFT,
  ArrowRight: KEY.ARROW_RIGHT,
  Backspace: KEY.BACKSPACE,
  Tab: KEY.TAB,
  Enter: KEY.ENTER,
  ' ': KEY.SPACEBAR,
  Delete: KEY.DELETE,
  PageUp: KEY.PAGE_UP,
  PageDown: KEY.PAGE_DOWN,
  Home: KEY.HOME,
  End: KEY.END,
  Insert: KEY.INSERT,
  Pause: KEY.PAUSE,
  ScrollLock: KEY.SCROLL_LOCK,
  Alt: KEY.ALT,
  AltGraph: KEY.ALT,
  Control: KEY.CTRL,
  Shift: KEY.SHIFT,
  Meta: KEY.CMD,
  OS: KEY.CMD,
  PrintScreen: KEY.PRINT_SCREEN,
};

/**
 * The Key_Code of a key event. Like the native adapters, printable keys are
 * their character (letters upper-case); a character the layout composed
 * with Alt (`å` for Alt+A on a Mac) falls back to the physical key.
 */
export function jaiKeyCode({
  key,
  code,
}: Pick<KeyboardEvent, 'key' | 'code'>): number {
  const named = NAMED_KEYS[key];
  if (named !== undefined) return named;
  const fn = /^F([1-9]|1\d|2[0-4])$/u.exec(key);
  if (fn) return KEY.F1 + Number(fn[1]) - 1;
  const chars = [...key];
  if (chars.length === 1) {
    const point = chars[0].codePointAt(0)!;
    if (point >= 0x61 && point <= 0x7a) return point - 32;
    if (point >= 0x20 && point < 0x7f) return point;
  }
  const physical = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d))$/u.exec(code);
  if (physical)
    return (physical[1] ?? physical[2] ?? physical[3]).codePointAt(0)!;
  return KEY.UNKNOWN;
}

/** The Key_Code of `MouseEvent.button`; undefined for back/forward buttons. */
export function jaiMouseButton(button: number): number | undefined {
  return [
    KEY.MOUSE_BUTTON_LEFT,
    KEY.MOUSE_BUTTON_MIDDLE,
    KEY.MOUSE_BUTTON_RIGHT,
  ][button];
}

export const jaiModifiers = (
  event: Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>
) =>
  (event.shiftKey ? 1 : 0) |
  (event.ctrlKey ? 2 : 0) |
  (event.altKey ? 4 : 0) |
  (event.metaKey ? 8 : 0);

/** Input's WHEEL_DELTA: wheel units per notch. */
const WHEEL_DELTA = 120;

/**
 * A wheel event in WHEEL_DELTA units, positive away from the user (up), as
 * on Windows. Browsers scroll about 100 px or 3 lines per notch.
 */
export function jaiWheelDelta({
  deltaY,
  deltaMode,
}: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const notches =
    deltaMode === 0 ? deltaY / 100 : deltaMode === 1 ? deltaY / 3 : deltaY;
  return Math.round(-notches * WHEEL_DELTA) || 0;
}

/**
 * Whether a key pressed on the focused canvas keeps its browser default.
 * Shortcuts with Ctrl or Cmd (reload, close tab, Run) and function keys stay
 * the browser's, and Tab still moves focus out of the canvas; every other
 * key (arrows, Space, letters) belongs to the program, so the page does not
 * scroll or type.
 */
export function keepsBrowserDefault(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>
): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  if (event.key === 'Tab') return true;
  return /^F\d{1,2}$/u.test(event.key);
}

/** Text a key press types: one printable character without Ctrl or Cmd. */
export function typedText(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>
): number | undefined {
  const chars = [...event.key];
  if (chars.length !== 1 || event.ctrlKey || event.metaKey) return undefined;
  const point = chars[0].codePointAt(0)!;
  return point >= 0x20 && point !== 0x7f ? point : undefined;
}

/**
 * Forwards `canvas`'s input to a program through `send` until `signal`
 * aborts. Pointer coordinates are in canvas pixels (CSS pixels times
 * `devicePixelRatio`), the drawing surface's units.
 */
export function forwardCanvasInput(
  canvas: HTMLCanvasElement,
  send: (event: CanvasInputEvent) => void,
  signal: AbortSignal
) {
  const listen = { signal };
  const key = (pressed: boolean) => (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (!keepsBrowserDefault(event)) event.preventDefault();
    send({
      type: 1,
      key: jaiKeyCode(event),
      pressed,
      modifiers: jaiModifiers(event),
      repeat: event.repeat,
    });
    const text = pressed ? typedText(event) : undefined;
    if (text !== undefined) send({ type: 2, utf32: text });
  };
  canvas.addEventListener('keydown', key(true), listen);
  canvas.addEventListener('keyup', key(false), listen);
  const scale = () => globalThis.devicePixelRatio || 1;
  const move = (event: PointerEvent) =>
    send({
      type: 3,
      x: Math.round(event.offsetX * scale()),
      y: Math.round(event.offsetY * scale()),
    });
  const button = (pressed: boolean) => (event: PointerEvent) => {
    const code = jaiMouseButton(event.button);
    if (code === undefined) return;
    if (pressed) {
      canvas.focus({ preventScroll: true });
      // A drag that leaves the canvas still reports its release.
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    move(event);
    send({ type: 1, key: code, pressed, modifiers: jaiModifiers(event) });
  };
  canvas.addEventListener('pointerdown', button(true), listen);
  canvas.addEventListener('pointerup', button(false), listen);
  canvas.addEventListener('pointermove', move, listen);
  canvas.addEventListener(
    'contextmenu',
    (event) => event.preventDefault(),
    listen
  );
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const y = jaiWheelDelta(event);
      if (y) send({ type: 4, y });
    },
    { signal, passive: false }
  );
  canvas.addEventListener(
    'focus',
    () => send({ type: 6, pressed: true }),
    listen
  );
  canvas.addEventListener(
    'blur',
    () => send({ type: 6, pressed: false }),
    listen
  );
}
