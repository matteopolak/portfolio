/** Apple platforms use Cmd where others use Ctrl, and name keys with symbols. */
export const isApple = () => /Mac|iPhone|iPad/u.test(navigator.platform);

/** Cmd (Apple) or Ctrl (elsewhere): the modifier for go to definition and link clicks. */
export const linkModifier = (event: MouseEvent | KeyboardEvent) =>
  isApple() ? event.metaKey : event.ctrlKey;
