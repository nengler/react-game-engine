# Assets

`packages/hearth/tools/make-assets.ts` (`npm run hearth:assets`) writes everything here but `font.png`, which is Kite's font
copied across. The art and sound effects are Kenney's (https://kenney.nl, CC0: free to use, no attribution required); the
files used are in `tools/kenney/`, and the script lays them out at the sizes the game reads. The music is made in the script, in
code. To change an asset, change the script (or swap a file in `tools/kenney/`) and run it.

| File | What it is |
| --- | --- |
| `tiles.png` | 80 × 40, 10 × 10 tiles: grass, grass with flowers, path (Tiny Battle, Tiny Town), build pad (Tower Defense's plate); tiles 10-12 and 20 up are marker ids, drawn empty |
| `enemies.png` | 56 × 42, 14 × 14 frames: a 4-frame walk for the runner (a bat), grunt (a slime) and brute (a cyclops), from Tiny Dungeon |
| `tower_bases.png` `barrels.png` | 36 × 36, 12 × 12 frames, frame = kind × 3 + level (bolt, mortar, frost): Tower Defense's plate and cannon, shrunk, outlined and tinted per kind |
| `shots.png` | 32 × 8, four 8 × 8 frames: bolt, shell, muzzle flash, spark (Tower Defense's bullets and star) |
| `icons.png` | 60 × 10, six 10 × 10 icons: the three cannons, a coin (Pixel Platformer), a heart and a flag (Tiny Battle) |
| `hearth.png` `cursor.png` | the hearth (Tiny Battle's headquarters with a Tower Defense flame, two flicker frames, 20 × 20) and the cursor (Tiny Battle's corner brackets, 14 × 14) |
| `font.png` | 80 × 48, the 5 × 7 pixel font (lower case is drawn as upper case) |
| `*.wav` | fifteen effects from Kenney's audio packs (22.05 kHz, mono; see `sfx()` for which is which) and `theme.wav`, a synthesised looping tune (16 kHz, mono) |
