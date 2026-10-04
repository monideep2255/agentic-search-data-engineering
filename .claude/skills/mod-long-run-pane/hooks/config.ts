// Per-repository settings for mod-long-run-pane.
export const config = {
  /** Output lines kept and shown in the pane. */
  maxLines: 20,
  /** Words placed before the entry point, for example ['uv', 'run'] when entry points are not on the path. */
  launcher: [] as string[],
}
