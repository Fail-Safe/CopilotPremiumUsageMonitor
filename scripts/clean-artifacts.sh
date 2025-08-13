#!/usr/bin/env bash
# Remove local build/test artifacts for a clean tree.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Cleaning coverage outputs...";
rm -rf coverage .nyc_output .node_coverage || true

echo "Cleaning build outputs...";
rm -rf out .tsbuildinfo || true

echo "Done."
