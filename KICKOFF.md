# Kickoff — build Shufflerr in Claude Code

## 1. Fork and seed the repo

```bash
git clone https://github.com/seerr-team/seerr.git shufflerr
cd shufflerr
git checkout 2cfbcf8940225f1597d44f507fd78040887c5597 -b main
git remote rename origin upstream          # keep Seerr as upstream for later cherry-picks
# (optional) create your own remote: git remote add origin git@github.com:<you>/shufflerr.git

# copy this pack into the repo root (adjust the path)
cp -r /path/to/shufflerr-handoff/{HANDOFF.md,CLAUDE.md,NOTICE.md,LICENSES,docs,design,starter} .
git add -A && git commit -m "chore: Shufflerr handoff pack (brief, docs, mockup, attribution)"

pnpm install
pnpm dev     # sanity check that the untouched fork runs before changing anything
```

Prereqs: Node and pnpm versions from the fork's `package.json`/`.nvmrc`; Docker for later
phases; optional real services for manual testing (Plex or Jellyfin with a music library,
Lidarr, Navidrome).

## 2. Launch

```bash
claude --effort ultracode
```

(Or type `/effort ultracode` in an existing session. Turn it off with `/effort ultracode off`
for small follow-ups.)

## 3. First prompt (paste as-is)

```
Read HANDOFF.md, CLAUDE.md and docs/BUILD_PLAN.md. Open design/shufflerr-mockup.html in a
browser (sign in as admin@shufflerr.local with any password) and look through design/screens/.

Build Shufflerr by converting this Seerr fork into a music request manager, following
docs/BUILD_PLAN.md phase by phase, starting with Phase 0.

Rules:
- Use the docs/ file for each phase as the spec. The mockup is the UI source of truth.
- Reuse Seerr code wherever docs/REUSE_MAP.md says Keep or Adapt. Add the attribution header
  from CLAUDE.md to every copied or adapted file and keep NOTICE.md and REUSE_MAP.md in sync.
- Use starter/server/lib/permissions.ts and starter/server/constants/media.ts as the new
  versions of those files.
- After each phase: lint, typecheck, tests and build must pass; commit "phase N: <summary>";
  update CHANGES.md (kept / adapted / rewritten / dropped, deviations from the mockup, TODOs,
  owner configuration needed).
- No live third-party calls in tests; record fixtures.
- When you hit an open question from HANDOFF.md §6, take the conservative option, leave a
  TODO(decision) comment and list it in CHANGES.md. Don't stop the run for it.
- Stop after Phase 6 (MVP) and run the Definition of Done in CLAUDE.md end to end. Report
  the result and the list of open decisions before continuing to Phase 7.
```

## 4. Later prompts

- Continue: `Continue with Phase 7 per docs/BUILD_PLAN.md. Same rules.`
- Backlog: `Implement BACKLOG.md items 1–6 (P1). Same rules; add each to docs/ as a short spec
  first, then build.`

## 5. After each run

- Read `CHANGES.md` and the diff against `upstream`.
- Check attribution: `grep -rL "Adapted from Seerr" $(git diff --name-only upstream -- server src | grep -E '\.(ts|tsx)$')`
  lists changed files missing the header (new Shufflerr-only files are fine).
- Check branding: `grep -ri "seerr" src server --include=*.ts* | grep -vi "adapted from"`.
- Pull a Seerr fix later: `git fetch upstream && git cherry-pick <sha>`.
