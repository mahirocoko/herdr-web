# Commit Guide

Only create a commit after the maintainer explicitly asks.

Before committing:

1. Inspect every staged and unstaged path.
2. Keep `.letta/`, build output, coverage, logs, and secrets out of Git.
3. Run the checks appropriate to the changed boundary.
4. Stage specific files rather than the whole repository blindly.
5. Use the repository's existing commit-message style once history exists.

Do not amend or push unless the maintainer separately requests it.
