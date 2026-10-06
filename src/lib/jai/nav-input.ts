export type NavDirection = 'back' | 'forward';

/** The fields of a key event that pick a navigation shortcut. */
type Keys = Pick<
  KeyboardEvent,
  'code' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
>;

/**
 * Go Back / Go Forward shortcuts. Ctrl+- and Ctrl+Shift+- (by key position,
 * so Shift's `_` still counts) everywhere, as VS Code binds them on macOS.
 * Alt+Left / Alt+Right too, except on Apple platforms, where they move by
 * word in the editor.
 */
export function navigationKey(
  event: Keys,
  apple: boolean
): NavDirection | undefined {
  if (event.metaKey) return undefined;
  if (event.ctrlKey && !event.altKey && event.code === 'Minus')
    return event.shiftKey ? 'forward' : 'back';
  if (apple || !event.altKey || event.ctrlKey || event.shiftKey)
    return undefined;
  if (event.key === 'ArrowLeft') return 'back';
  if (event.key === 'ArrowRight') return 'forward';
  return undefined;
}

/** Mouse buttons 3 and 4: the side buttons browsers map to Back and Forward. */
export const navigationButton = (button: number): NavDirection | undefined =>
  button === 3 ? 'back' : button === 4 ? 'forward' : undefined;

/**
 * Sends the side mouse buttons and the navigation shortcuts inside `target`
 * to `go`, and keeps the browser from acting on them as well. Browsers go
 * back on the button's release, so the press, release and `auxclick` are
 * all cancelled and only the release navigates.
 */
export function watchNavigationInput(
  target: HTMLElement,
  go: (direction: NavDirection) => void,
  apple: boolean,
  signal: AbortSignal
) {
  for (const type of ['mousedown', 'auxclick'] as const)
    target.addEventListener(
      type,
      (event) => {
        if (navigationButton(event.button)) event.preventDefault();
      },
      { signal }
    );
  target.addEventListener(
    'mouseup',
    (event) => {
      const direction = navigationButton(event.button);
      if (!direction) return;
      event.preventDefault();
      go(direction);
    },
    { signal }
  );
  // Capture: ahead of CodeMirror, whose default keymap binds Alt+Left elsewhere.
  target.addEventListener(
    'keydown',
    (event) => {
      const direction = navigationKey(event, apple);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      go(direction);
    },
    { capture: true, signal }
  );
}
