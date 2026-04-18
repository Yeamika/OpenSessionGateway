#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="standalone"
export LAB_SYNC_ALWAYS="${LAB_SYNC_ALWAYS:-1}"
export BUN_CONFIG_REGISTRY="${LAB_BUN_REGISTRY:-https://registry.npmjs.org/}"
export npm_config_registry="${LAB_NPM_REGISTRY:-https://registry.npmjs.org/}"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

cd /workspace/opencode

rm -rf ./node_modules ./packages/*/node_modules ./packages/console/*/node_modules

if [[ -f /sources/opencode/bun.lock ]]; then
  cp /sources/opencode/bun.lock ./bun.lock
  bun install --frozen-lockfile
else
  bun install
fi

VERSION="${OPENCODE_BUILD_VERSION:-0.0.0-local-yes-$(date -u +'%y%m%d%H%M')}"
OUTPUT_ROOT="${OPENCODE_BUILD_OUTPUT_ROOT:-/runtime/opencode-builds}"
OUTPUT_DIR="${OUTPUT_ROOT}/${VERSION}"
export OUTPUT_DIR

mkdir -p "${OUTPUT_DIR}"
rm -f ./opencode-*.tgz
rm -f ./packages/sdk/js/opencode-ai-sdk-*.tgz
rm -f ./packages/plugin/opencode-ai-plugin-*.tgz

export OPENCODE_CHANNEL="${OPENCODE_CHANNEL:-local-yes}"
export OPENCODE_VERSION="${VERSION}"

bun ./packages/opencode/script/build.ts

(cd ./packages/sdk/js && bun run build)
(cd ./packages/plugin && bun run build)

npm pack ./packages/opencode/dist/opencode-windows-x64 --pack-destination "${OUTPUT_DIR}"
npm pack ./packages/opencode/dist/opencode-linux-arm64 --pack-destination "${OUTPUT_DIR}"
npm pack ./packages/opencode/dist/opencode-linux-x64 --pack-destination "${OUTPUT_DIR}"

mkdir -p ./packages/opencode/dist/opencode-ai
rm -rf ./packages/opencode/dist/opencode-ai/bin
cp -r ./packages/opencode/bin ./packages/opencode/dist/opencode-ai/bin
cp ./packages/opencode/script/postinstall.mjs ./packages/opencode/dist/opencode-ai/postinstall.mjs
cp ./LICENSE ./packages/opencode/dist/opencode-ai/LICENSE
node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve("./packages/opencode")
const dist = path.join(root, "dist")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const win = JSON.parse(fs.readFileSync(path.join(dist, "opencode-windows-x64", "package.json"), "utf8"))
const linuxX64 = JSON.parse(fs.readFileSync(path.join(dist, "opencode-linux-x64", "package.json"), "utf8"))
const linuxArm64 = JSON.parse(fs.readFileSync(path.join(dist, "opencode-linux-arm64", "package.json"), "utf8"))

fs.writeFileSync(
  path.join(dist, "opencode-ai", "package.json"),
  JSON.stringify(
    {
      name: "opencode-ai",
      version: win.version,
      license: pkg.license,
      bin: {
        opencode: "./bin/opencode",
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      optionalDependencies: {
        [win.name]: win.version,
        [linuxX64.name]: linuxX64.version,
        [linuxArm64.name]: linuxArm64.version,
      },
    },
    null,
    2,
  ) + "\n",
)
EOF

npm pack ./packages/opencode/dist/opencode-ai --pack-destination "${OUTPUT_DIR}"

cp ./packages/sdk/js/package.json ./packages/sdk/js/package.json.bak
node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")

const file = path.resolve("./packages/sdk/js/package.json")
const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
pkg.version = process.env.OPENCODE_VERSION
const map = (value) => {
  if (typeof value === "string") {
    const item = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    return { import: item + ".js", types: item + ".d.ts" }
  }
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item)]))
}
pkg.exports = map(pkg.exports)
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n")
EOF
(cd ./packages/sdk/js && bun pm pack)
mv ./packages/sdk/js/opencode-ai-sdk-*.tgz "${OUTPUT_DIR}/"
mv ./packages/sdk/js/package.json.bak ./packages/sdk/js/package.json

cp ./packages/plugin/package.json ./packages/plugin/package.json.bak
node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")

const file = path.resolve("./packages/plugin/package.json")
const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
pkg.version = process.env.OPENCODE_VERSION
pkg.dependencies["@opencode-ai/sdk"] = pkg.version
pkg.exports = Object.fromEntries(
  Object.entries(pkg.exports).map(([key, value]) => {
    const item = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    return [key, { import: item + ".js", types: item + ".d.ts" }]
  }),
)
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n")
EOF
(cd ./packages/plugin && bun pm pack)
mv ./packages/plugin/opencode-ai-plugin-*.tgz "${OUTPUT_DIR}/"
mv ./packages/plugin/package.json.bak ./packages/plugin/package.json

node <<'EOF' > "${OUTPUT_DIR}/build-full-packages.json"
const fs = require("node:fs")

const entries = [
  { kind: "cli", artifact: "opencode-cli", glob: /^opencode-ai-.*\.tgz$/ },
  { kind: "cli-binary", artifact: "opencode-windows-x64", glob: /^opencode-windows-x64-.*\.tgz$/ },
  { kind: "cli-binary", artifact: "opencode-linux-x64", glob: /^opencode-linux-x64-.*\.tgz$/ },
  { kind: "cli-binary", artifact: "opencode-linux-arm64", glob: /^opencode-linux-arm64-.*\.tgz$/ },
  { kind: "sdk", artifact: "opencode-sdk", glob: /^opencode-ai-sdk-.*\.tgz$/ },
  { kind: "pluginsdk", artifact: "opencode-plugin-sdk", glob: /^opencode-ai-plugin-.*\.tgz$/ },
]

const root = process.env.OUTPUT_DIR
const files = fs.readdirSync(root)
const output = entries.map((item) => ({
  kind: item.kind,
  artifact: item.artifact,
  file: files.find((name) => item.glob.test(name)) || null,
}))
process.stdout.write(JSON.stringify(output, null, 2) + "\n")
EOF

echo "Built opencode packages"
echo "version=${VERSION}"
echo "output=${OUTPUT_DIR}"
