# Assets

Everything here was made for this repository by `packages/hearth/tools/make-assets.ts` (`npm run hearth:assets`), in code, with no
source material from anywhere else, except `font.png`, which is Kite's font copied across. To change an asset, change the script and run it.

| File | What it is |
| --- | --- |
| `tiles.png` | 80 × 40, 10 × 10 tiles: grass, grass with a tuft, path, build pad (tiles 10-12 and 20 up are marker ids, drawn empty) |
| `enemies.png` | 56 × 42, 14 × 14 frames: a 4-frame walk for the runner, grunt and brute (a row each) |
| `tower_bases.png` `barrels.png` | 36 × 36, 12 × 12 frames, frame = kind × 3 + level (bolt, mortar, frost) |
| `shots.png` | 32 × 8, four 8 × 8 frames: bolt, shell, muzzle flash, spark |
| `icons.png` | 60 × 10, six 10 × 10 icons: bolt, mortar, frost, gold, lives, wave |
| `hearth.png` `cursor.png` | the hearth (two flicker frames, 20 × 20) and the cursor's corner brackets (14 × 14) |
| `font.png` | 80 × 48, the 5 × 7 pixel font (lower case is drawn as upper case) |
| `*.wav` | fifteen synthesised effects (22.05 kHz, mono) and `theme.wav`, a looping tune (16 kHz, mono) |
