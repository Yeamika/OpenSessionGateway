# Multiprocess Demo Stages

Each child directory represents one bounded verification stage. Keep stage
scripts small and explicit; shared helpers belong in `../scripts/`.

Stage output should go to `.tmp/`, not into these folders.

## Stage 00: Build Sanity

```bash
bash demos/multiprocess/stages/00-build/run.sh
bash demos/multiprocess/stages/00-build/run.sh --skip-build  # verify only
```

Builds and verifies all required packages: router, osgp, core, osgp-client,
bash-clientdummy, demos, surface, and all Rust endpoints. Endpoint behaviour
verification belongs to Stage 03.

## Stage 01: Router Boot

```bash
bash demos/multiprocess/stages/01-router-boot/run.sh
bash demos/multiprocess/stages/01-router-boot/run.sh --keep-alive 30
```

Starts root/east/west/nested routers with state-file templates, verifies all
ports, then auto-cleans up. No long-running processes.
