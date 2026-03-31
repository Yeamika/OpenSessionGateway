export function renderPluginAdminPage(input: { defaultLoadPath: string }): string {
  const defaultLoadPath = JSON.stringify(input.defaultLoadPath);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OSG Plugin Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: rgba(255, 251, 244, 0.88);
        --panel-strong: #fff8ef;
        --line: rgba(60, 45, 28, 0.14);
        --text: #24180e;
        --muted: #695845;
        --accent: #0f6d62;
        --accent-2: #ca5b2e;
        --danger: #9f2f21;
        --shadow: 0 24px 70px rgba(84, 51, 24, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 109, 98, 0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(202, 91, 46, 0.16), transparent 26%),
          linear-gradient(180deg, #fbf7f0 0%, var(--bg) 100%);
      }

      main {
        width: min(1100px, calc(100vw - 32px));
        margin: 32px auto;
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }

      h1, h2, h3, p { margin: 0; }

      .hero {
        display: grid;
        gap: 14px;
        margin-bottom: 28px;
      }

      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 109, 98, 0.1);
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .hero h1 {
        font-family: "Alegreya Sans", "Trebuchet MS", sans-serif;
        font-size: clamp(34px, 6vw, 54px);
        line-height: 0.95;
        letter-spacing: -0.04em;
      }

      .hero p {
        max-width: 760px;
        color: var(--muted);
        line-height: 1.6;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 18px;
      }

      .panel {
        grid-column: span 12;
        padding: 18px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: var(--panel-strong);
      }

      .panel h2 {
        margin-bottom: 14px;
        font-size: 18px;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .meta-card {
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.6);
      }

      .meta-card .label,
      .roots .label,
      .plugin-meta .label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .mono,
      code,
      input,
      button {
        font-family: "IBM Plex Mono", "Cascadia Code", monospace;
      }

      .roots {
        display: grid;
        gap: 10px;
      }

      .root-row,
      .surface-chip,
      .path-chip {
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        overflow-wrap: anywhere;
      }

      .load-form {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
      }

      input {
        width: 100%;
        min-height: 46px;
        padding: 12px 14px;
        border: 1px solid rgba(36, 24, 14, 0.16);
        border-radius: 14px;
        background: white;
        color: var(--text);
      }

      input:focus {
        outline: 2px solid rgba(15, 109, 98, 0.2);
        border-color: rgba(15, 109, 98, 0.4);
      }

      button {
        min-height: 46px;
        padding: 12px 16px;
        border: 0;
        border-radius: 14px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
      }

      button.secondary { background: #d9d4c8; color: var(--text); }
      button.danger { background: var(--danger); }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
      button:not(:disabled):hover { transform: translateY(-1px); }

      .status {
        margin-top: 12px;
        min-height: 24px;
        color: var(--muted);
      }

      .status.error { color: var(--danger); }
      .status.success { color: var(--accent); }

      .plugins {
        display: grid;
        gap: 14px;
      }

      .autoload-roots {
        display: grid;
        gap: 14px;
      }

      .autoload-root {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.74);
        display: grid;
        gap: 14px;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
        margin-bottom: 14px;
      }

      .panel-copy {
        color: var(--muted);
        line-height: 1.6;
      }

      .autoload-packages {
        display: grid;
        gap: 12px;
      }

      .autoload-package {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.78);
        display: grid;
        gap: 10px;
      }

      .autoload-package-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
      }

      .plugin-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.74);
        display: grid;
        gap: 14px;
      }

      .plugin-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
      }

      .plugin-title {
        display: grid;
        gap: 6px;
      }

      .plugin-title h3 {
        font-size: 18px;
      }

      .plugin-title p {
        color: var(--muted);
        line-height: 1.5;
      }

      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: white;
        font-size: 12px;
      }

      .badge.locked {
        background: rgba(15, 109, 98, 0.1);
        color: var(--accent);
      }

      .badge.disabled {
        background: rgba(159, 47, 33, 0.1);
        color: var(--danger);
      }

      .plugin-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }

      .plugin-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .empty {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed var(--line);
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 760px) {
        main {
          width: min(100vw, calc(100vw - 16px));
          margin: 8px;
          padding: 16px;
          border-radius: 20px;
        }

        .load-form {
          grid-template-columns: 1fr;
        }

        .plugin-head {
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">127.0.0.1 only</span>
        <h1>OSG Plugin Admin</h1>
        <p>
          This port manages package-style server plugins. Load a plugin package from an allowed root, then unload or reload it without restarting the main OSG server.
        </p>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Host Snapshot</h2>
          <div id="meta" class="meta-grid"></div>
        </div>

        <div class="panel">
          <h2>Allowed Roots</h2>
          <div id="roots" class="roots"></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Autoload Config</h2>
              <p class="panel-copy">Toggle startup state below, then use Apply And Reload to resync loaded plugins with the saved autoload config.</p>
            </div>
            <div class="plugin-actions">
              <button id="apply-autoload-button" class="secondary" type="button">Apply And Reload</button>
            </div>
          </div>
          <div id="autoload-roots" class="autoload-roots"></div>
        </div>

        <div class="panel">
          <h2>Load Plugin Package</h2>
          <form id="load-form" class="load-form">
            <input id="plugin-path" type="text" spellcheck="false" />
            <button id="load-button" type="submit">Load Package</button>
          </form>
          <div id="status" class="status"></div>
        </div>

        <div class="panel">
          <h2>Loaded Plugins</h2>
          <div id="plugins" class="plugins"></div>
        </div>
      </section>
    </main>

    <script>
      const defaultLoadPath = ${defaultLoadPath};
      const statusNode = document.getElementById('status');
      const pathInput = document.getElementById('plugin-path');
      const loadForm = document.getElementById('load-form');
      const loadButton = document.getElementById('load-button');
      const applyAutoloadButton = document.getElementById('apply-autoload-button');
      const rootsNode = document.getElementById('roots');
      const autoloadRootsNode = document.getElementById('autoload-roots');
      const pluginsNode = document.getElementById('plugins');
      const metaNode = document.getElementById('meta');

      pathInput.value = defaultLoadPath;

      function setStatus(message, tone) {
        statusNode.textContent = message || '';
        statusNode.className = tone ? 'status ' + tone : 'status';
      }

      function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
      }

      async function readJson(response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          const message = typeof data.error === 'string' ? data.error : 'Request failed';
          throw new Error(message);
        }
        return data;
      }

      async function callApi(path, body) {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        return readJson(response);
      }

      function renderMeta(data) {
        const cards = [
          ['Admin endpoint', window.location.origin],
          ['Admin port', String(data.adminPort || '-')],
          ['Allowed roots', String((data.allowedRoots || []).length)],
          ['Loaded plugins', String((data.plugins || []).length)],
        ];
        metaNode.innerHTML = cards
          .map(([label, value]) => '<div class="meta-card"><span class="label">' + label + '</span><div class="mono">' + value + '</div></div>')
          .join('');
      }

      function renderRoots(roots) {
        if (!roots.length) {
          rootsNode.innerHTML = '<div class="empty">No plugin roots configured.</div>';
          return;
        }
        rootsNode.innerHTML = roots
          .map((root) => '<div class="root-row mono">' + root + '</div>')
          .join('');
      }

      function renderAutoloadRoots(roots, plugins) {
        if (!roots.length) {
          autoloadRootsNode.innerHTML = '<div class="empty">No autoload configuration available.</div>';
          return;
        }

        autoloadRootsNode.innerHTML = roots.map((root) => {
          const packages = (root.packages || []).map((pkg) => {
            const loaded = (plugins || []).find((plugin) => plugin.sourcePath && plugin.sourcePath.indexOf(pkg.packagePath) === 0);
            const badges = [
              '<span class="badge mono">' + pkg.packageName + '</span>',
              '<span class="badge' + (pkg.enabled ? '' : ' disabled') + '">' + (pkg.enabled ? 'enabled' : 'disabled') + '</span>',
              loaded ? '<span class="badge locked">loaded</span>' : '<span class="badge">not loaded</span>',
            ];

            if (pkg.hidden) {
              badges.push('<span class="badge">hidden</span>');
            }
            if (!pkg.packageAutoload) {
              badges.push('<span class="badge disabled">package opt-out</span>');
            }
            if (pkg.envControlled) {
              badges.push('<span class="badge">env override</span>');
            }

            const toggleDisabled = pkg.hidden || !pkg.packageAutoload || pkg.envControlled;
            const note = pkg.envControlled
              ? 'Environment variables are currently overriding file-based autoload settings.'
              : (!pkg.packageAutoload ? 'This package opted out of autoload in its own package.json.' : '');

            return [
              '<article class="autoload-package">',
              '<div class="autoload-package-head">',
              '<div class="plugin-title">',
              '<h3>' + pkg.packageName + '</h3>',
              '<div class="badge-row">' + badges.join('') + '</div>',
              '</div>',
              '<div class="plugin-actions">',
              '<button data-action="autoload-toggle" data-root-path="' + root.rootPath + '" data-package-name="' + pkg.packageName + '" data-enabled="' + (pkg.enabled ? 'true' : 'false') + '"' + (toggleDisabled ? ' disabled' : '') + '>' + (pkg.enabled ? 'Disable' : 'Enable') + '</button>',
              '</div>',
              '</div>',
              '<div class="plugin-meta">',
              '<div><span class="label">Package path</span><div class="path-chip mono">' + pkg.packagePath + '</div></div>',
              '<div><span class="label">Config file</span><div class="path-chip mono">' + root.configPath + '</div></div>',
              '</div>',
              note ? '<p class="plugin-title" style="color: var(--muted);">' + note + '</p>' : '',
              '</article>',
            ].join('');
          }).join('');

          const mode = root.hasAllowList ? 'allowlist mode' : 'denylist mode';
          const summaryBadges = [
            '<span class="badge">' + mode + '</span>',
            '<span class="badge mono">allow: ' + (root.allow || []).length + '</span>',
            '<span class="badge mono">deny: ' + (root.deny || []).length + '</span>',
          ].join('');

          return [
            '<section class="autoload-root">',
            '<div class="plugin-title">',
            '<h3>' + root.rootPath + '</h3>',
            '<div class="badge-row">' + summaryBadges + '</div>',
            '</div>',
            '<div class="autoload-packages">' + (packages || '<div class="empty">No plugin packages found in this root.</div>') + '</div>',
            '</section>',
          ].join('');
        }).join('');
      }

      function renderPlugins(plugins) {
        if (!plugins.length) {
          pluginsNode.innerHTML = '<div class="empty">No plugins are currently loaded.</div>';
          return;
        }

        pluginsNode.innerHTML = plugins.map((plugin) => {
          const routeSegments = (plugin.routeSegments || []).length
            ? plugin.routeSegments.map((item) => '<span class="surface-chip mono">' + item + '</span>').join('')
            : '<span class="surface-chip">No MCP surfaces</span>';
          const sourcePath = plugin.sourcePath
            ? '<div class="path-chip mono">' + plugin.sourcePath + '</div>'
            : '<div class="path-chip mono">Unknown source</div>';
          const description = plugin.description || 'No description provided.';
          return [
            '<article class="plugin-card">',
            '<div class="plugin-head">',
            '<div class="plugin-title">',
            '<h3>' + plugin.name + '</h3>',
            '<p>' + description + '</p>',
            '<div class="badge-row">',
            '<span class="badge mono">' + plugin.id + '</span>',
            '<span class="badge mono">v' + plugin.version + '</span>',
            '<span class="badge mono">' + plugin.sourceKind + '</span>',
            '<span class="badge">worker</span>',
            '</div>',
            '</div>',
            '<div class="plugin-actions">',
            '<button class="secondary" data-action="reload" data-plugin-id="' + plugin.id + '">Reload</button>',
            '<button class="danger" data-action="unload" data-plugin-id="' + plugin.id + '">Unload</button>',
            '</div>',
            '</div>',
            '<div class="plugin-meta">',
            '<div><span class="label">Loaded at</span><div class="mono">' + formatDate(plugin.loadedAt) + '</div></div>',
            '<div><span class="label">Surfaces</span><div>' + routeSegments + '</div></div>',
            '<div><span class="label">Source</span>' + sourcePath + '</div>',
            '</div>',
            '</article>',
          ].join('');
        }).join('');
      }

      async function refresh() {
        const data = await readJson(await fetch('/api/plugins'));
        renderMeta(data);
        renderRoots(data.allowedRoots || []);
        renderAutoloadRoots(data.roots || [], data.plugins || []);
        renderPlugins(data.plugins || []);
      }

      loadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const pluginPath = pathInput.value.trim();
        if (!pluginPath) {
          setStatus('Enter a plugin package path first.', 'error');
          return;
        }

        loadButton.disabled = true;
        setStatus('Loading plugin...', '');
        try {
          await callApi('/api/plugins/load', { path: pluginPath });
          setStatus('Plugin loaded.', 'success');
          await refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          loadButton.disabled = false;
        }
      });

      pluginsNode.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const action = target.getAttribute('data-action');
        const pluginID = target.getAttribute('data-plugin-id');
        if (!action || !pluginID) return;

        target.disabled = true;
        setStatus(action === 'reload' ? 'Reloading plugin...' : 'Unloading plugin...', '');
        try {
          if (action === 'reload') {
            await callApi('/api/plugins/reload', { pluginID });
            setStatus('Plugin reloaded.', 'success');
          } else {
            await callApi('/api/plugins/unload', { pluginID });
            setStatus('Plugin unloaded.', 'success');
          }
          await refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          target.disabled = false;
        }
      });

      autoloadRootsNode.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const action = target.getAttribute('data-action');
        if (action !== 'autoload-toggle') return;

        const rootPath = target.getAttribute('data-root-path');
        const packageName = target.getAttribute('data-package-name');
        const enabled = target.getAttribute('data-enabled') === 'true';
        if (!rootPath || !packageName) return;

        target.disabled = true;
        setStatus((enabled ? 'Disabling ' : 'Enabling ') + packageName + '...', '');
        try {
          await callApi('/api/plugins/autoload', { rootPath, packageName, enabled: !enabled });
          setStatus('Autoload config updated for ' + packageName + '.', 'success');
          await refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          target.disabled = false;
        }
      });

      applyAutoloadButton.addEventListener('click', async () => {
        applyAutoloadButton.disabled = true;
        setStatus('Applying autoload config and reloading managed plugins...', '');
        try {
          const data = await callApi('/api/plugins/autoload/apply', {});
          const loaded = Array.isArray(data.result && data.result.loaded) ? data.result.loaded.length : 0;
          const unloaded = Array.isArray(data.result && data.result.unloaded) ? data.result.unloaded.length : 0;
          setStatus('Applied autoload config. Reloaded ' + loaded + ' plugin(s), unloaded ' + unloaded + '.', 'success');
          await refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          applyAutoloadButton.disabled = false;
        }
      });

      refresh().catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      });

      window.setInterval(() => {
        refresh().catch(() => {});
      }, 5000);
    </script>
  </body>
</html>`;
}
