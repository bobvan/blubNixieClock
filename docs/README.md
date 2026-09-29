# docs/ — the durable record

The committed, public-facing record of what this project decides, builds, and measures. Written to
be read by someone who was not present when the work happened.

## docs/ vs NOTES/

`NOTES/` is kept **out of** the repository (`.git/info/exclude`). The boundary is the same one that
matters for this repo going public:

| | `docs/` | `NOTES/` |
|---|---|---|
| In git | yes | no |
| Audience | a stranger reading it on GitHub | this project, this month |
| Contains | decisions, methods, results, rationale | scratch, raw captures, host-specific procedure, hunches |
| Test | *"still makes sense, and still safe, published tomorrow?"* | everything else |

A document belongs in `NOTES/`, not here, if it needs a secret, a credential, a GPS coordinate, a
tailnet/`*.ts.net` identifier, or is still an unchecked hunch.

## Conventions

- **Decisions with reasoning** (`docs/design/`) — so a choice can be revisited, not just seen.
- **Results with conditions** (`docs/measurements/` or `docs/build/`) — a number/result without the
  conditions that produced it is not a result.
- **Durable reference/how-to** (`docs/reference/`) — specs, driver notes, procedures.
- **Cite primary sources** (datasheets, standards) with URLs; cache large PDFs in the fleet
  `~/doclib`, not the repo.
- **Relationship to memory:** distilled agent-facing facts live in the memory store; human-facing
  prose lives here. The two should agree; write findings here first, and give a memory a
  `MEMORY.md` line only if it must load every session.
