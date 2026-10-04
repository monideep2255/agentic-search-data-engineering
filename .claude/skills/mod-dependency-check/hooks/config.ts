// Per-repository settings for mod-dependency-check.
export const config = {
  // A release uploaded fewer days ago than this is flagged as new.
  minAgeDays: 14,
  // Packages checked per call; the rest are listed as not checked.
  maxPackages: 10,
  pypiBase: 'https://pypi.org/pypi',
  // Files whose added lines count as new dependencies.
  requirementFiles: ['requirements*.txt'],
  projectFile: 'pyproject.toml',
}
