# Contributing

This repository follows [gitflow](https://nvie.com/posts/a-successful-git-branching-model/)
branching with GitHub pull requests.

## Branches

| Branch | Role |
| --- | --- |
| `master` | Production. Accepts merges from `release/*` only (plus rare hotfixes). Every release commit on `master` carries a semver tag (`vX.Y.Z`). |
| `develop` | Integration branch for the next release. Feature work lands here first. |
| `feature/<topic>` | Cut from `develop`, merged back into `develop` via pull request. Delete after merge. |
| `release/<version>` | Cut from `develop` when a release is imminent. Bug fixes only — no new features. Merged into `master` (and tagged) and back into `develop`, then deleted. |

## Workflow

1. **Start work** from `develop`:
   ```sh
   git checkout develop && git pull
   git checkout -b feature/my-change
   ```
2. **Keep the branch green**: `pnpm install && pnpm build && pnpm test`
   (Node ≥ 24; `tsc --noEmit` is the type gate).
3. **Open a pull request** into `develop`. Merges use a merge commit
   (gitflow history is not linear by design).
4. **Releasing**:
   ```sh
   git checkout develop && git checkout -b release/0.3.0
   # bump package.json version to 0.3.0, fix release blockers only
   git checkout master && git merge release/0.3.0
   git tag -a v0.3.0 -m "dsh-web-tools 0.3.0"
   git checkout develop && git merge release/0.3.0
   git branch -d release/0.3.0
   ```
   Push `master`, `develop`, and the tag. `master` is never pushed directly —
   only via a release merge.
5. **Consumers pin a SHA**: profile installs reference a commit on `master`
   (`dsh plugin --profile web add github:mrrodero/dsh-web-tools#<sha>`), so
   releases are the stable install points.

## Conventions

- Commit subjects: imperative, ≤ 72 chars; body explains *why*.
- The version in `package.json` always matches the latest `v*` tag on `master`.
- Branch protection (set in GitHub): no direct pushes to `master` or
  `develop` — everything goes through a pull request. `enforce_admins` is off
  so the owner can bypass in an emergency.

## License

MIT — see [LICENSE](LICENSE).
