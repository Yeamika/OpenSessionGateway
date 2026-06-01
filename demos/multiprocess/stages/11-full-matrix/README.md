# Stage 11: Full Matrix Summary

## Purpose

Aggregate evidence from all demo stages (00–10) into a single summary report.
This stage produces a `summary.md` template that can be filled in after a full
demo run.

## How it works

1. Run all stages 00–10 (or as many as are implemented)
2. Each stage writes evidence to `$LOG_DIR/<NN>-<name>.txt`
3. This stage's `build-summary.sh` collects all evidence files and produces
   `$LOG_DIR/summary.md`

## Output format

The summary is a Markdown file with:
- Header: date, topology, commit hash
- Per-stage table: stage name, PASS/FAIL/PENDING counts, key evidence lines
- Overall verdict: ALL PASS / MIXED / BLOCKED
- Notes section for known limitations

## Script

Run: `bash demos/multiprocess/stages/11-full-matrix/build-summary.sh [LOG_DIR]`
