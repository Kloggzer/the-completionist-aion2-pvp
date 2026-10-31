// Extension points for optional local modules in src/private/ (not part of the public repository; loaded by
// main.tsx if present). Without them the app runs with the public feature set.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const ext = {
  /** Feature names provided by local modules (e.g. to show their settings). */
  features: new Set<string>(),
  /** Extra canvas layers, painted after the built-in ones. Return true to request another frame (animation). */
  paint: [] as ((ctx: CanvasRenderingContext2D, api: any) => boolean | void)[],
}
