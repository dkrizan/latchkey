# Agent instructions

## Commit messages

Follow [Conventional Commits 1.0.0-beta.2](https://www.conventionalcommits.org/en/v1.0.0-beta.2/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

- **Types:** `feat` (new feature), `fix` (bug fix), `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `improvement`.
- **Scope** is optional and names the area in parentheses, for example `feat(editor):` or `fix(content):`.
- **Description:** imperative, lowercase start, no trailing period. For example `fix(popup): show paused state in dark mode`.
- **Breaking changes** go in a footer that starts with `BREAKING CHANGE:`. This version of the spec has no `!` shorthand.
- **Pull request titles** use the same format, because squash merges use the title as the commit message.

The `.githooks/commit-msg` hook rejects messages that don't match. `npm install` enables it through the `prepare` script.
