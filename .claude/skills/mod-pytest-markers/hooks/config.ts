// Per-repository settings for mod-pytest-markers.
export const config = {
  filter: 'not integration and not docker',
  // Mirrors testpaths in pyproject.toml, [tool.pytest.ini_options].
  testPaths: ['tests'],
  probeCacheMs: 60_000,
  probeTimeoutMs: 5000,
}
