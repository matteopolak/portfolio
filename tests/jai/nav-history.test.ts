import test from 'node:test';
import assert from 'node:assert/strict';
import { NavHistory, type NavLocation } from '../../src/lib/jai/nav-history.ts';

const at = (file: string, line = 1, readonly = false): NavLocation => ({
  file,
  line,
  ...(readonly ? { readonly } : {}),
});
const places = (history: NavHistory<NavLocation>) =>
  history.locations.map(({ file, line }) => `${file}:${line}`);

/** A history with the session's start at `main.jai:1`; steps are 1 s apart. */
function started() {
  const history = new NavHistory<NavLocation>();
  let clock = 10_000;
  history.reset(at('main.jai'), clock);
  const step = (from: NavLocation | undefined, to: NavLocation) =>
    history.navigate(from, to, (clock += 1000));
  return { history, step, tick: (ms: number) => (clock += ms) };
}

test('navigating records where the editor was and where it went', () => {
  const { history, step } = started();
  const ops = step(at('main.jai', 40), at('lib.jai', 3));
  assert.deepEqual(places(history), ['main.jai:40', 'lib.jai:3']);
  // The starting entry was updated in place; only the target is new.
  assert.deepEqual(
    ops.map(({ op }) => op),
    ['push']
  );
  assert.equal(history.canBack, true);
  assert.equal(history.canForward, false);
});

test('back and forward walk the entries and save the place being left', () => {
  const { history, step } = started();
  step(at('main.jai', 1), at('lib.jai', 3));
  step(at('lib.jai', 9), at('math.jai', 20));
  assert.deepEqual(history.back(at('math.jai', 25)), at('lib.jai', 9));
  assert.deepEqual(history.back(at('lib.jai', 9)), at('main.jai', 1));
  assert.equal(history.back(at('main.jai', 1)), undefined);
  assert.deepEqual(history.forward(at('main.jai', 2)), at('lib.jai', 9));
  assert.deepEqual(history.forward(), at('math.jai', 25));
  assert.equal(history.forward(), undefined);
  assert.deepEqual(places(history), ['main.jai:2', 'lib.jai:9', 'math.jai:25']);
});

test('a same-file jump records both positions', () => {
  const { history, step } = started();
  step(at('main.jai', 120), at('main.jai', 4));
  assert.deepEqual(places(history), ['main.jai:120', 'main.jai:4']);
  assert.deepEqual(history.back(at('main.jai', 4)), at('main.jai', 120));
});

test('navigating to the same line adds nothing', () => {
  const { history, step } = started();
  const ops = step(at('main.jai', 1), at('main.jai', 1));
  assert.deepEqual(ops, []);
  assert.deepEqual(places(history), ['main.jai:1']);
});

test('navigating after going back drops the forward entries', () => {
  const { history, step } = started();
  step(at('main.jai'), at('a.jai'));
  step(at('a.jai'), at('b.jai'));
  history.back(at('b.jai'));
  const ops = step(at('a.jai', 5), at('c.jai'));
  assert.deepEqual(places(history), ['main.jai:1', 'a.jai:5', 'c.jai:1']);
  assert.equal(history.canForward, false);
  assert.deepEqual(
    ops.map(({ op }) => op),
    ['push']
  );
});

test('rapid navigations replace the entry they passed through', () => {
  const { history, step, tick } = started();
  step(at('main.jai'), at('a.jai'));
  const id = history.currentId;
  tick(-900); // the next step lands 100 ms after this one
  const ops = step(at('a.jai'), at('b.jai'));
  assert.deepEqual(places(history), ['main.jai:1', 'b.jai:1']);
  // The browser entry that showed a.jai is reused for b.jai.
  assert.deepEqual(
    ops.map(({ op }) => op),
    ['replace']
  );
  assert.notEqual(history.currentId, id);
  assert.equal(history.find(id!), undefined);
});

test('the starting entry is never coalesced away', () => {
  const history = new NavHistory<NavLocation>();
  history.reset(at('main.jai'), 0);
  history.navigate(at('main.jai'), at('a.jai'), 1);
  assert.deepEqual(places(history), ['main.jai:1', 'a.jai:1']);
});

test('leaving a file the history does not know records it first', () => {
  const { history, step } = started();
  step(at('main.jai'), at('a.jai'));
  // a.jai's tab was closed and main.jai shown without a navigation.
  step(at('main.jai', 7), at('b.jai'));
  assert.deepEqual(places(history), [
    'main.jai:1',
    'a.jai:1',
    'main.jai:7',
    'b.jai:1',
  ]);
});

test('the history keeps at most `limit` entries', () => {
  const history = new NavHistory<NavLocation>({ limit: 3 });
  history.reset(at('f0'), 0);
  for (let index = 1; index <= 5; index++)
    history.navigate(at(`f${index - 1}`), at(`f${index}`), index * 1000);
  assert.deepEqual(places(history), ['f3:1', 'f4:1', 'f5:1']);
  assert.equal(history.index, 2);
  assert.deepEqual(history.back(), at('f4'));
});

test('ids only grow and find their entries', () => {
  const { history, step } = started();
  const first = history.currentId!;
  step(at('main.jai'), at('a.jai'));
  const second = history.currentId!;
  assert.ok(second > first);
  assert.deepEqual(history.go(first, at('a.jai', 3)), at('main.jai'));
  assert.deepEqual(history.find(second), at('a.jai', 3));
  assert.equal(history.go(999), undefined);
});

test('renames remap workspace entries but not previews', () => {
  const { history, step } = started();
  step(at('main.jai'), at('lib/math.jai', 4));
  step(at('lib/math.jai', 4), at('lib/math.jai', 1, true));
  history.move(
    new Map([
      ['lib/math.jai', 'util/math.jai'],
      ['main.jai', 'app.jai'],
    ])
  );
  assert.deepEqual(places(history), [
    'app.jai:1',
    'util/math.jai:4',
    'lib/math.jai:1',
  ]);
  assert.equal(history.locations[2].readonly, true);
});

test('deleting a file prunes its entries and merges the neighbours', () => {
  const { history, step } = started();
  step(at('main.jai'), at('gone.jai'));
  step(at('gone.jai'), at('main.jai'));
  step(at('main.jai'), at('a.jai'));
  history.retain(new Set(['main.jai', 'a.jai']));
  assert.deepEqual(places(history), ['main.jai:1', 'a.jai:1']);
  assert.equal(history.index, 1);
  assert.deepEqual(history.back(), at('main.jai'));
});

test('deleting the current file leaves Back returning to the entry before it', () => {
  const { history, step } = started();
  step(at('main.jai'), at('a.jai'));
  step(at('a.jai'), at('gone.jai'));
  history.retain(new Set(['main.jai', 'a.jai']));
  assert.deepEqual(places(history), ['main.jai:1', 'a.jai:1']);
  assert.equal(history.canBack, true);
  assert.deepEqual(history.back(at('main.jai', 3)), at('a.jai'));
  assert.deepEqual(history.back(), at('main.jai'));
});

test('a navigation after the current file was deleted keeps the history', () => {
  const { history, step } = started();
  step(at('main.jai'), at('gone.jai'));
  history.retain(new Set(['main.jai']));
  step(at('main.jai', 2), at('b.jai'));
  assert.deepEqual(places(history), ['main.jai:2', 'b.jai:1']);
});

test('deleting everything before the current entry leaves no Back', () => {
  const { history, step } = started();
  step(at('main.jai'), at('a.jai'));
  history.retain(new Set(['a.jai']));
  assert.deepEqual(places(history), ['a.jai:1']);
  assert.equal(history.canBack, false);
});
