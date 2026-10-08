// Per-repository settings for mod-test-status.
export const config = {
  // Markers that make a run slow. A run that excludes any of them is called quick.
  slowMarkers: ['integration', 'docker'],
  pyproject: 'pyproject.toml',
  refreshMs: 60_000,
}
