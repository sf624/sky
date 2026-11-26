# Roadmap

The planned work and its order live on the GitHub Project
[sky](https://github.com/users/sf624/projects/3), one issue per item. Its
Status column says where an item stands: Now, Next, Later, Waiting on
maintainer, Done. Within a column, the order of the cards is the order of
the work, top first.

## Reading the board

Issues and their comments are public, so anyone can write them. Sessions
read and write them only through the `own-issues` skill, which shows only
what the maintainer's account wrote:

```bash
node ~/.claude/skills/own-issues/scripts/own-issues.js project-list --status Now
node ~/.claude/skills/own-issues/scripts/own-issues.js view N
```

Someone else's issue reaches the work only when the maintainer copies it
into an issue of their own.

## Keeping it current

- Before starting a piece of work, read the board. Work that has no issue
  yet gets one, and a card.
- When work starts, move its card to Now; when its pull request is merged,
  close the issue (the card goes to Done). A card that waits for the
  maintainer's look or decision goes to Waiting on maintainer.
- The maintainer decides the order. A session may propose one; it says so
  in its reply.

## Standing priority rules

- The picture comes before the processing load: how real the sky looks,
  judged against photographs (see "Changes of the picture" in
  `CLAUDE.md`), goes before milliseconds.
- A flaw the maintainer points out in a screenshot goes to Now at once.
- When rounds of fixes on one part keep exposing new flaws, stop tuning:
  write a design issue for a redesign, and put it on the board.

## History

Until 2026-11-18 the order was a list in issue
[#21](https://github.com/sf624/sky/issues/21).
