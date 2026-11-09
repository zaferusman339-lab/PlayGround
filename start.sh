#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")" && pwd -P)}"
export PROJECT_DIR
cd "$PROJECT_DIR"
PORT="${PORT:-3000}"
OUTPUT_DIR="$PROJECT_DIR/dist"
export PORT OUTPUT_DIR

: "${OPENCODE_WEB_DIR:?OPENCODE_WEB_DIR must point to the worker metadata directory}"
time -p mkdir -p "$OUTPUT_DIR" "$OPENCODE_WEB_DIR"
time -p cp "$PROJECT_DIR/index.html" "$OUTPUT_DIR/index.html"
time -p node -e 'const fs=require("node:fs"); const path=require("node:path"); fs.writeFileSync(path.join(process.env.OPENCODE_WEB_DIR,"deployment-output.json"), JSON.stringify({project:process.env.PROJECT_DIR,directory:path.resolve(process.env.OUTPUT_DIR)}))'
time -p python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$OUTPUT_DIR"
