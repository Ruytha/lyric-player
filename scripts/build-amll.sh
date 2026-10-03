#!/usr/bin/env sh
# Rebuilds src/vendor/amll-lyrics.js (+ .css) from @applemusic-like-lyrics/core.
# Bundles DomLyricPlayer and the mesh-gradient background; the Pixi renderer is stubbed.
# Usage: sh scripts/build-amll.sh [version]   (default 0.6.0)
set -e
VERSION="${1:-0.6.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund "@applemusic-like-lyrics/core@$VERSION" esbuild >/dev/null
echo "export { DomLyricPlayer, BackgroundRender, MeshGradientRenderer } from '@applemusic-like-lyrics/core';" > entry.js
cat > pixi-stub.js <<'JS'
// AMLL's Pixi background renderer isn't used; these stand in for its imports.
const unavailable = () => { throw new Error('Pixi renderer is not bundled'); };
export class Application { constructor() { unavailable(); } }
export class Container { constructor() { unavailable(); } }
export class Sprite { constructor() { unavailable(); } }
export class BlurFilter { constructor() { unavailable(); } }
export class BulgePinchFilter { constructor() { unavailable(); } }
export class ColorMatrixFilter { constructor() { unavailable(); } }
export const Texture = { from: unavailable };
export const utils = {};
JS
ALIASES=""
for m in app core display filter-blur filter-bulge-pinch filter-color-matrix sprite; do
  ALIASES="$ALIASES --alias:@pixi/$m=./pixi-stub.js"
done
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 $ALIASES --outfile=out.js
{
  printf '/*!\n * @applemusic-like-lyrics/core %s (DomLyricPlayer + mesh-gradient background; Pixi renderer stubbed out)\n' "$VERSION"
  printf ' * https://github.com/amll-dev/applemusic-like-lyrics\n'
  printf ' * Copyright (c) the AMLL contributors. Licensed under AGPL-3.0-only (see LICENSE).\n'
  printf ' * Bundled with esbuild; rebuild with scripts/build-amll.sh.\n */\n'
  cat out.js
} > "$ROOT/src/vendor/amll-lyrics.js"
{
  printf '/* @applemusic-like-lyrics/core %s stylesheet. AGPL-3.0-only. */\n' "$VERSION"
  cat node_modules/@applemusic-like-lyrics/core/dist/style.css
} > "$ROOT/src/vendor/amll-lyrics.css"
rm -rf "$WORK"
echo "Updated src/vendor/amll-lyrics.js and amll-lyrics.css ($VERSION)"
