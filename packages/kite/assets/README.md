# Assets

`packages/kite/tools/make-assets.ts` (`npm run kite:assets`) writes everything here. The art and sound effects are Kenney's
(https://kenney.nl, CC0: free to use, no attribution required); the files used are in `tools/kenney/`, and the script lays
them out at the sizes the game reads. The font and the music are made in the script, in code. To change an asset, change the
script (or swap a file in `tools/kenney/`) and run it.

| File | What it is |
| --- | --- |
| `tiles.png` | 80 × 20, sixteen 10 × 10 tiles: dirt, dirt with grass on top, four spikes, three marker tiles (empty). Pixel Platformer's 18 × 18 tiles 122, 2 and 68 (turned for each direction), shrunk |
| `hero.png` | 96 × 24, 12 × 12 frames of the character: idle, run, jump, fall, wall, dash, death burst. Pixel Platformer's green alien (characters 0 and 1, 24 × 24, halved); the burst is drawn in code |
| `font.png` | 80 × 48, a 5 × 7 pixel font in 5 × 8 cells, the characters 32 to 127 (lower case is the upper-case glyph) |
| `jump.wav` `dash.wav` `land.wav` `death.wav` `gem.wav` `start.wav` | Kenney's Digital Audio, Impact Sounds and Interface Sounds (22.05 kHz, mono): see `sfx()` for which is which |
| `theme.wav` | a 16-second looping tune, synthesised: square-wave bass and lead on an A minor pentatonic scale at 96 BPM (16 kHz, mono) |
