# Contributing

## Workflow
1. Fork or branch from `main`.
2. Create a focused branch name: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
3. Keep commits atomic; prefer multiple small commits over a large mixed one.
4. Open a PR early; draft mode is fine for discussion.

## Pull Requests
- Fill out the PR template sections (Summary, Motivation, Approach, Testing).
- Ensure CI (Node 18.x & 20.x) and CodeQL checks are green.
- Add or update tests for new endpoints, metrics, or persistence mutations.
- Avoid introducing high-cardinality metrics without justification.

## Testing
- Run the full suite: `npm test`.
- Target a single test file: `npm test -- tests/<file>.test.js`.
- Prefer deterministic fixtures; avoid depending on external network calls.

## Code Style
- Use expressive variable names; avoid single letters.
- Keep endpoint handlers lean; extract reusable logic when complexity grows.
- Log structured objects (pino) for operational events; avoid sensitive data in logs.

## Security & Dependencies
- Do not commit secrets (.env stays local).
- Review Dependabot updates for breaking changes before merging.
- Treat new CodeQL alerts as blockers; address or suppress with justification.

## Release Process
- Tag baseline versions (e.g., `v0.1.0`) after merging significant sets of changes.
- Draft release notes highlighting changes, tests, and any migration steps.

## Questions
Open a Feature request issue or start a draft PR for design discussion.
