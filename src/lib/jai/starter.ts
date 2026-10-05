import { FORMAT_CONFIG_PATH, formatConfigStarter } from './format.ts';

/** Files a new Jai workspace opens with. */
export const starterFiles: Record<string, string> = {
  'main.jai': `#import "Basic";
#load "lib/math.jai";

main :: () {
    total := 0;
    for i: 1..10 {
        total += square(i);
        print("% squared is %\\n", i, square(i));
    }
    print("Sum of squares: %\\n", total);
}
`,
  'lib/math.jai': `square :: (x: int) -> int {
    return x * x;
}
`,
  [FORMAT_CONFIG_PATH]: formatConfigStarter,
};
