# OSG + OpenCode Container Suite

This lab topology provides:

- `DevelopersContain`: shared development shell with both repos prepared inside one container
- `Main-OSG`: main OSG container for developer use; it does not auto-sync code after first bootstrap
- `OSG-Test`: disposable OSG test container; it re-syncs source on each boot
- `opencode-test-A`: disposable OpenCode runtime container connected to `OSG-Test`
- `opencode-test-B`: disposable OpenCode runtime container connected to `OSG-Test`

## Files

- `docker-compose.yml`
- `Dockerfile`
- `.env.example`
- `scripts/*.sh`

## Quick start

1. Copy `.env.example` to `.env`
2. From this directory run:

```bash
docker compose up --build -d main-osg osg-test opencode-test-a opencode-test-b
```

3. Open a developer shell when needed:

```bash
docker compose run --rm developerscontain
```

## Notes

- `Main-OSG` uses `LAB_SYNC_ALWAYS=0`, so it keeps its prepared copy until you remove the volume.
- `OSG-Test` and the OpenCode test runtimes use `LAB_SYNC_ALWAYS=1`, so they re-sync source on each restart.
- The suite intentionally keeps config common through one shared image and one shared bootstrap path.
- The bootstrap step rewrites local package references inside the container so `@opensessiongateway/client-opencode-plugin-v2` can consume the local OpenCode plugin/sdk packages.
- The bootstrap step also ignores host lockfiles that point at host-only registries and installs from the registry specified by `LAB_NPM_REGISTRY` / `LAB_BUN_REGISTRY`.
