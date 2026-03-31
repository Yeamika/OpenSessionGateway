# Local Server Plugins

This directory is the local override plugin root for the server process.

The canonical plugin source in this repo now lives in `../../plugins`. Keep this directory for local overrides or ad-hoc packages.

- Local override root: `server/local-plugins`
- Override with: `OSG_PLUGIN_DIRS`

Recommended form: one package directory per plugin.

```text
server/local-plugins/
  runtime-control/
    package.json
    index.ts
  session-bridge/
    package.json
    index.ts
  _examples/
    echo-surface/
      package.json
      index.ts
```

If you prefer another root, for example `D:\ai\OPENCODE_AUTO\OpenSessionGateway\plugins`, set `OSG_PLUGIN_DIRS` to that absolute path.
