#!/usr/bin/env bash
set -euo pipefail

SRC_OSG="/sources/OpenSessionGateway"
SRC_OPENCODE="/sources/opencode"
DST_ROOT="/workspace"
DST_OSG="${DST_ROOT}/OpenSessionGateway"
DST_OPENCODE="${DST_ROOT}/opencode"
VENDOR_OPENCODE_ROOT="${DST_ROOT}/.vendor-opencode"
SYNC_MARKER="${DST_ROOT}/.lab-synced"
LAB_BOOTSTRAP_ROLE="${LAB_BOOTSTRAP_ROLE:-dev}"

needs_opencode_source() {
  [[ "${LAB_BOOTSTRAP_ROLE}" != "osg" ]]
}

need_sync() {
  [[ "${LAB_SYNC_ALWAYS:-0}" == "1" ]] || [[ ! -f "${SYNC_MARKER}" ]]
}

sync_repo() {
  local src="$1"
  local dst="$2"
  mkdir -p "${dst}"
  rsync -a --delete \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude "dist" \
    --exclude ".next" \
    --exclude ".runtime" \
    --exclude "out" \
    --exclude "coverage" \
    "${src}/" "${dst}/"
}

patch_osg_package_refs() {
  export LAB_BOOTSTRAP_ROLE
  node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")

const root = "/workspace/OpenSessionGateway"
const role = process.env.LAB_BOOTSTRAP_ROLE || "dev"
const clientLibraryPkgPath = path.join(root, "packages", "client-library", "package.json")
const serverPkgPath = path.join(root, "server", "package.json")
const rootPkgPath = path.join(root, "package.json")

if (role !== "osg") {
  const pluginPkgPath = path.join(root, "packages", "client-opencode-plugin-v2", "package.json")
  const pluginPkg = JSON.parse(fs.readFileSync(pluginPkgPath, "utf8"))
  pluginPkg.dependencies ||= {}
  pluginPkg.dependencies["@opencode-ai/plugin"] = "file:../../../.vendor-opencode/plugin"
  pluginPkg.dependencies["@opencode-ai/sdk"] = "file:../../../.vendor-opencode/sdk"
  if (role === "dev") {
    pluginPkg.dependencies["@opensessiongateway/client-library"] = "file:../client-library"
    pluginPkg.dependencies["@opensessiongateway/protocol-library"] = "file:../protocol-library"
  }
  fs.writeFileSync(pluginPkgPath, JSON.stringify(pluginPkg, null, 2) + "\n")
}

const clientLibraryPkg = JSON.parse(fs.readFileSync(clientLibraryPkgPath, "utf8"))
clientLibraryPkg.dependencies ||= {}
if (role === "osg" || role === "dev") {
  clientLibraryPkg.dependencies["@opensessiongateway/protocol-library"] = "file:../protocol-library"
}
fs.writeFileSync(clientLibraryPkgPath, JSON.stringify(clientLibraryPkg, null, 2) + "\n")

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"))
rootPkg.dependencies ||= {}
rootPkg.dependencies["@opensessiongateway/server-plugin-sdk"] = "file:packages/server-plugin-sdk"
if (role === "osg" || role === "dev") {
  rootPkg.workspaces = [
    "packages/server-plugin-sdk",
    "packages/protocol-library",
    "packages/client-library",
    "server",
  ]
  const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, "utf8"))
  serverPkg.dependencies ||= {}
  serverPkg.dependencies["@opensessiongateway/protocol-library"] = "file:../packages/protocol-library"
  fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n")
}
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n")
EOF
}

prepare_vendor_opencode_packages() {
  if ! needs_opencode_source; then
    return
  fi

  rm -rf "${VENDOR_OPENCODE_ROOT}"
  mkdir -p "${VENDOR_OPENCODE_ROOT}/plugin" "${VENDOR_OPENCODE_ROOT}/sdk"
  rsync -a --delete --exclude "node_modules" --exclude "dist" "${DST_OPENCODE}/packages/plugin/" "${VENDOR_OPENCODE_ROOT}/plugin/"
  rsync -a --delete --exclude "node_modules" --exclude "dist" "${DST_OPENCODE}/packages/sdk/js/" "${VENDOR_OPENCODE_ROOT}/sdk/"

  node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")

const vendorRoot = "/workspace/.vendor-opencode"
const pluginPkgPath = path.join(vendorRoot, "plugin", "package.json")
const sdkPkgPath = path.join(vendorRoot, "sdk", "package.json")
const opencodeRootPkgPath = "/workspace/opencode/package.json"

const opencodeRootPkg = JSON.parse(fs.readFileSync(opencodeRootPkgPath, "utf8"))
const catalog = opencodeRootPkg?.workspaces?.catalog || {}

const pluginPkg = JSON.parse(fs.readFileSync(pluginPkgPath, "utf8"))
pluginPkg.dependencies ||= {}
pluginPkg.dependencies["@opencode-ai/sdk"] = "file:../sdk"
if (pluginPkg.dependencies.zod === "catalog:") {
  pluginPkg.dependencies.zod = catalog.zod || "4.1.8"
}
delete pluginPkg.devDependencies
delete pluginPkg.scripts
fs.writeFileSync(pluginPkgPath, JSON.stringify(pluginPkg, null, 2) + "\n")

const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, "utf8"))
delete sdkPkg.devDependencies
delete sdkPkg.scripts
fs.writeFileSync(sdkPkgPath, JSON.stringify(sdkPkg, null, 2) + "\n")
EOF
}

install_opencode() {
  if [[ "${LAB_BOOTSTRAP_ROLE}" == "osg" ]]; then
    return
  fi

  if [[ -d "${DST_OPENCODE}/node_modules" && "${LAB_FORCE_INSTALL:-0}" != "1" ]]; then
    return
  fi

  rm -f "${DST_OPENCODE}/bun.lock"
  export BUN_CONFIG_REGISTRY="${LAB_BUN_REGISTRY:-https://registry.npmjs.org/}"
  (cd "${DST_OPENCODE}" && bun install)
}

install_osg_for_server() {
  if [[ "${LAB_BOOTSTRAP_ROLE}" != "osg" && "${LAB_BOOTSTRAP_ROLE}" != "dev" ]]; then
    return
  fi

  export npm_config_registry="${LAB_NPM_REGISTRY:-https://registry.npmjs.org/}"
  rm -f "${DST_OSG}/package-lock.json"
  (cd "${DST_OSG}" && npm install --workspace packages/server-plugin-sdk --workspace packages/protocol-library --workspace packages/client-library --workspace server --include-workspace-root --no-package-lock)
}

install_osg_for_opencode() {
  if [[ "${LAB_BOOTSTRAP_ROLE}" != "opencode" && "${LAB_BOOTSTRAP_ROLE}" != "dev" ]]; then
    return
  fi

  export npm_config_registry="${LAB_NPM_REGISTRY:-https://registry.npmjs.org/}"
  rm -f "${DST_OSG}/packages/protocol-library/package-lock.json"
  rm -f "${DST_OSG}/packages/client-library/package-lock.json"
  rm -f "${DST_OSG}/packages/client-opencode-plugin-v2/package-lock.json"
  npm --prefix "${DST_OSG}/packages/protocol-library" install --no-package-lock
  npm --prefix "${DST_OSG}/packages/client-library" install --no-package-lock
  npm --prefix "${DST_OSG}/packages/client-opencode-plugin-v2" install --no-package-lock
}

build_osg_local_packages() {
  if [[ "${LAB_BOOTSTRAP_ROLE}" == "osg" || "${LAB_BOOTSTRAP_ROLE}" == "dev" ]]; then
    npm --prefix "${DST_OSG}/packages/server-plugin-sdk" run build
    npm --prefix "${DST_OSG}/packages/protocol-library" run build
    npm --prefix "${DST_OSG}/packages/client-library" run build
  fi

  if [[ "${LAB_BOOTSTRAP_ROLE}" == "opencode" || "${LAB_BOOTSTRAP_ROLE}" == "dev" ]]; then
    return
  fi
}

main() {
  if [[ ! -d "${SRC_OSG}" ]]; then
    echo "missing OpenSessionGateway source under /sources" >&2
    exit 1
  fi

  if needs_opencode_source && [[ ! -d "${SRC_OPENCODE}" ]]; then
    echo "missing opencode source under /sources" >&2
    exit 1
  fi

  mkdir -p "${DST_ROOT}"

  if need_sync; then
    sync_repo "${SRC_OSG}" "${DST_OSG}"
    if needs_opencode_source; then
      sync_repo "${SRC_OPENCODE}" "${DST_OPENCODE}"
    fi
    touch "${SYNC_MARKER}"
  fi

  patch_osg_package_refs
  prepare_vendor_opencode_packages
  install_opencode
  install_osg_for_server
  install_osg_for_opencode
  build_osg_local_packages
}

main "$@"
