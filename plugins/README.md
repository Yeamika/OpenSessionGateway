# OSG Server Plugins

This directory stores package-style OSG server plugins.

It is the canonical repo plugin source tree. When `OSG_PLUGIN_DIRS` is unset, the loader checks this root plus local override roots such as `server/local-plugins/`.

## Recommended form

Each plugin should live in its own folder:

```text
plugins/
  my-plugin/
    package.json
    index.ts
```

## `package.json`

```json
{
  "name": "@opensessiongateway/osg-plugin-my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "osgServerPlugin": {
    "entry": "./index.ts",
    "autoload": true
  }
}
```

## Runtime model

- plugin packages are discovered from configured plugin roots
- startup autoload uses root allow and deny rules plus package-level `osgServerPlugin.autoload`
- file-loaded plugin packages run in `worker_threads`
- load, unload, and reload do not require restarting the main OSG server

Builtin in-process plugins are also supported by the host API, but this `plugins/` tree is for file-loaded package plugins.

## Shared SDK

- source package: `packages/server-plugin-sdk/`
- import name: `@opensessiongateway/server-plugin-sdk`

## Autoload behavior

- root config file `osg.plugins.json` can define the default autoload allow and deny list
- `OSG_PLUGIN_AUTOLOAD_ALLOW` takes precedence over file allow lists
- env and file deny lists are both applied
- `osgServerPlugin.autoload: false` keeps a package opt-in
- folders starting with `_` are ignored by autoload
- `/api/plugins/autoload` can update saved autoload state and immediately load or unload a package when possible

Example root config:

```json
{
  "autoload": {
    "allow": ["runtime-control", "session-bridge", "timer-scheduler"]
  }
}
```

Example env override:

```bash
OSG_PLUGIN_DIRS=D:\ai\OPENCODE_AUTO\OpenSessionGateway\plugins
OSG_PLUGIN_AUTOLOAD_ALLOW=runtime-control,session-bridge,timer-scheduler
```

`IM-gateway` is still loadable, but it ships with `osgServerPlugin.autoload: false`, so it stays opt-in unless that flag changes.

## Current loadable packages

- `IM-gateway/`
- `runtime-control/`
- `session-bridge/`
- `timer-scheduler/`
- `_examples/echo-surface/`
