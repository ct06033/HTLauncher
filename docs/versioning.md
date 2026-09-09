# TVShell Versioning Policy

- `package.json` "version" is the single source of truth; git tags mirror it as `v<version>`.
- Semver: 0.2.x patches | 0.x.0 features | 1.0.0 reserved for the appliance-grade release.
- Milestone tags so far:
  - v0.1.0 — web UI validated, user-approved revision 1 (P4 gate).
- Every release: bump version -> commit -> `git tag -a` -> `npm run dist` -> installer from dist/.
- The installer name and Windows file/product version come from package.json automatically.
