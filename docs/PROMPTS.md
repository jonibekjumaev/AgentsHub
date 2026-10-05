# Reusable Prompt Patterns

> Prompt patterns that worked during a codebase migration with an AI coding assistant.
> They are written generically, so they can be reused on any project that converts or refactors an existing codebase.
> Replace `<placeholders>` with your own values.

## Contents

1. [Audit before changing anything](#1-audit-before-changing-anything)
2. [Record a decision with options](#2-record-a-decision-with-options)
3. [One item: fix, verify, stop](#3-one-item-fix-verify-stop)
4. [Split a big step into parts](#4-split-a-big-step-into-parts)
5. [Expand, then contract](#5-expand-then-contract)
6. [Docs-only change](#6-docs-only-change)

[General tips](#general-tips) are at the end.

---

## 1. Audit before changing anything

### Template

```text
Read <source-of-truth doc> and the code under <paths>.
Do not change any code.

Create <audit file> with a checklist of everything that must change to reach
the target described in <source-of-truth doc>. Group it by step:
<step 1>, <step 2>, ...

For each item give:
- the file and line (or symbol)
- what it is now
- what it must become
- the decision ID it depends on, or "needs decision" if there is none

Add a separate section for security issues and bugs in code that will survive
the migration. Give each one an ID (S1, S2, ... / B1, B2, ...).
List anything you are unsure about as an open question instead of guessing.
```

### When to use

- At the start of a migration, rename or large refactor.
- When you inherit a codebase and need a map before you touch it.
- Again before each big step, to refresh the part of the checklist for that step.

### Why it works

- "Do not change any code" keeps the assistant in reading mode. It will not start fixing the first thing it finds.
- A file-and-line checklist turns a vague goal ("convert X to Y") into small items you can tick off one by one.
- Item IDs (S1, B3, ...) let later prompts and commit messages point at one exact item.
- "Needs decision" and open questions bring up the gaps in your design early, before they turn into code.
- The audit becomes the definition of done: the step is finished when its checklist is empty.

---

## 2. Record a decision with options

### Template

```text
I need to decide <question>.

Give me 2–4 options. For each option:
- what it means in practice
- pros and cons
- what it changes in <schema / API / code areas>

Recommend one and say why.

Do not write any code yet. After I choose, add it to <decisions file> as the
next ID (D-XX) using the existing format: Status, Context, Decision, Reason,
Consequence. Set Status to **Proposed** unless I say it is accepted.
If it replaces an older decision, mark the old one "Superseded by D-XX".
Do not delete or rewrite old decisions.
```

### When to use

- Any choice that changes a schema, an API contract, permissions or a business rule.
- When the audit marks an item "needs decision".
- When you notice yourself (or the assistant) about to make a silent assumption.

### Why it works

- Asking for options stops the assistant from choosing alone and hiding the choice inside code.
- A recommendation with reasons makes the choice faster, and you can still overrule it.
- "Proposed" vs "Accepted" keeps the line clear between what the assistant drafted and what you decided.
- Superseding instead of deleting keeps the history. Later you can see why something changed, not only that it changed.
- Code and commits can cite the decision ID, so the reason for strange-looking code is one lookup away.

---

## 3. One item: fix, verify, stop

### Template

```text
Fix only <item ID> from <audit file>: <one-line description>.

Rules:
- Touch only the files needed for this item. No unrelated cleanups, renames
  or formatting changes.
- Follow <decision ID> if one applies.

After the fix:
1. Run <build command> (and <lint / test command>) and show the result.
2. Explain in 2–3 lines how the fix closes the issue, and how you checked it.
3. Tick the item in <audit file>.
4. Suggest a commit message in the format <type>: <summary> (<item ID>).

Then stop. Do not start the next item.
```

### When to use

- Security fixes and bug fixes from the audit.
- Any change you want to review on its own, as its own commit.
- When earlier attempts mixed several fixes and the diff was hard to review.

### Why it works

- One item per prompt gives one small diff, which is easy to review and easy to revert.
- "No unrelated changes" prevents scope creep. Without it, assistants like to "improve" nearby code.
- Requiring a build/test run means "done" is backed by evidence, not by the assistant saying so.
- The short explanation lets you check the reasoning, not only the code.
- "Then stop" gives control back to you. You review, commit, and choose what comes next.
- One commit per item keeps the history readable: each commit message points at one audit ID.

---

## 4. Split a big step into parts

### Template

```text
<Step N> is too big for one change. Read its section in <audit file> and
propose how to split it into parts. Each part must:
- leave every app building and running
- be small enough to review as one commit
- have a clear goal and a list of files it touches

Show the plan only. Do not change code.
```

Then, for each part:

```text
Do <Step N> part <k> from the plan: <goal>.
Only the files listed for this part. Build <apps> and show the result.
Suggest a commit message ending with (<Step N> part <k>). Then stop.
```

### When to use

- A step that touches many layers at once (schema, DTOs, service, API, background jobs).
- When the assistant's first try at a big step produced a diff too large to review.
- When a change has a breaking part (API rename) and a non-breaking part (schema field added).

### Why it works

- Planning first and coding second lets you fix the order before any code exists.
- "Every app still builds" after each part means you can stop, commit or roll back at any point.
- Smaller parts give the assistant a narrower context, so it makes fewer mistakes.
- Breaking changes end up in their own commits, where they are easy to spot (for example with `feat!:`).

---

## 5. Expand, then contract

### Template

```text
Change <old thing> to <new thing> in two phases.

Phase 1 — expand:
- Add <new thing> next to <old thing>.
- Make all readers work with the new thing, and keep the old one working.
- Build and show the result. Stop.

Phase 2 — contract (only after I confirm phase 1):
- Move every remaining use of <old thing> to <new thing>.
- Remove <old thing> completely.
- Search the whole repo for <old names / patterns> and show that nothing is
  left (code, config, background jobs, tests, docs).
- Build all apps and show the result.
```

### When to use

- Renaming a field, enum value, API operation or collection that many places depend on.
- Replacing one module with another (an old entity becoming a new one).
- Any change where a half-done rename would break the build or a running client.

### Why it works

- Between the two phases the system always works. Nothing is in a broken in-between state.
- The contract phase has a clear, checkable finish line: the search for old names comes back empty.
- The repo-wide search catches leftovers in places people forget: config helpers, background jobs, lookups, docs.
- If you skip the expand phase (for example in a project with no live clients), keep the contract rule anyway: rename every layer in one step, then search for leftovers.

---

## 6. Docs-only change

### Template

```text
Docs-only change. Do not modify any code, config or tests.

Update <doc file(s)> to <goal>:
- <what to add / change>

Keep the existing format and tone of the file.
If the docs and the code disagree, do not fix the code. List each mismatch
at the end of your reply so I can decide which side is right.
Only touch <doc file(s)>.
```

### When to use

- Adding an audit section for the next step before starting it.
- Accepting or superseding decisions.
- Updating the source-of-truth doc after a decision changed.
- Writing guides like this file.

### Why it works

- The scope is clear: the diff can only contain doc files, so review is quick.
- Docs and code are changed in separate commits (`docs: ...`), which keeps history easy to search.
- Reporting mismatches instead of fixing them keeps "which side is right" as your call. It does not become a silent code change.
- "Keep the existing format" keeps docs consistent, so they stay easy to read and to parse by later prompts.

---

## General tips

- **Name the source of truth in every prompt.** "Follow `<doc>`" stops the assistant from inventing its own schema.
- **Use IDs everywhere.** Audit items, decisions and steps all get IDs. Prompts, code comments and commits cite them.
- **Always ask for evidence.** Build output, test output or a search result, not just "done".
- **End with "then stop".** You decide what happens next.
- **Keep project rules in a standing instructions file** (for example `CLAUDE.md`), so you do not repeat conventions in every prompt.
- **Combine patterns.** A typical cycle: audit (1) → decide open questions (2) → split the step (4) → do each part with expand/contract (5) and one-item fixes (3) → update docs (6).
