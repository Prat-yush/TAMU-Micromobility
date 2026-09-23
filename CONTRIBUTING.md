# Contributing

Anyone can work on any part of the repo. The folders are areas of work, not
team assignments.

## Workflow

1. Pick up an issue, or open one for what you're about to do, and assign
   yourself.
2. Branch off `main`:
   ```bash
   git switch main && git pull
   git switch -c <area>/<short-description>
   ```
   Examples: `scrapers/veo-gbfs`, `backend/shared-grid`, `frontend/hexbin-map`,
   `docs/proposal-draft`.
3. Commit in small pieces with clear messages ("Add Veo snapshot collector",
   not "updates").
4. Push and open a pull request into `main`. Fill in the template and link the
   issue (`Closes #12`).
5. Get **one approval** from any teammate. CI must pass.
6. **Squash and merge.** The branch is deleted automatically.

Don't push directly to `main`.

## Reviews

- Any teammate can review any PR. Try to review within a day or so.
- Keep reviews light. Look for things that are broken or confusing, not for
  style. Formatting is handled by tools.
- For an automated first pass, request **Copilot** as a reviewer on the PR. It
  needs GitHub Education, which is free with your TAMU email.

## Labels

Put area labels on issues and PRs: `scrapers`, `backend`, `frontend`, `data`,
`docs`.

## The data handoff

The backend writes JSON into `frontend/data/`, and the frontend reads only from
there. If your PR changes the structure of one of those files (renames a
field, changes a type, adds or removes a file), tick the box in the PR
template and tell whoever is working on the sections that read it.

## Checks

CI runs on every PR, and it only fails on real errors:

- Python syntax errors and undefined names (`ruff check`)
- Invalid JSON anywhere in the repo
- Failing tests (`pytest`, once there are tests)

Formatting is never a CI failure. If you install the pre-commit hooks
(`pre-commit install`), your Python and frontend code gets formatted
automatically on commit.

## Large files

Don't commit files over ~5 MB (the pre-commit hook warns you). Talk to the team
first about where large raw data such as Veo snapshots should go.
