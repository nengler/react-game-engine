# The fonts built into libtse

libtse holds eleven bitmap fonts, drawn into its own code as tables (`native/src/fonts_data.h`), so a game can use them by name
(`<Text font="tse:m5x7">`) without shipping a file. They come from the fonts below, rasterised at their own pixel size by
`tools/fonts/make-fonts.py`, which gives the digits one width; otherwise each is the original's glyphs and spacing. Every
build of libtse, and every game packaged with it, carries these fonts, so this file goes with them (`npm run pack` and
`tse package` copy it).

| Name | From | License |
| --- | --- | --- |
| `tse:small` | Tom Thumb, by Brian J. Swetland and Vassilii Khachaturov, with changes by Robey Pointer | CC0 1.0, or the BSD license below |
| `tse:tiny5` | Tiny5, Copyright 2022-2024 The Tiny5 Project Authors (https://github.com/Gissio/font_tiny5) | SIL OFL 1.1 |
| `tse:micro5` | Micro 5, Copyright 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-micro) | SIL OFL 1.1 |
| `tse:m5x7` | m5x7, by Daniel Linssen (https://managore.itch.io/m5x7) | CC0 1.0 |
| `tse:silkscreen` | Silkscreen, Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen) | SIL OFL 1.1 |
| `tse:caps` | Kite's 5 × 7 capitals, from this repository (`packages/kite/assets/font.png`) | MIT, as the engine |
| `tse:arcade` | Press Start 2P, Copyright 2012 The Press Start 2P Project Authors (cody@zone38.net), with Reserved Font Name "Press Start 2P" | SIL OFL 1.1 |
| `tse:unscii` | unscii-8, by Viznut (http://viznut.fi/unscii/) | Public domain |
| `tse:unscii-thin` | unscii-8-thin, by Viznut | Public domain |
| `tse:jersey10` | Jersey 10, Copyright 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey) | SIL OFL 1.1 |
| `tse:unscii-tall` | unscii-16, by Viznut | Public domain |

`tse:arcade` is a Modified Version of Press Start 2P under the OFL: it is not called by that Reserved Font Name. The fonts under
the OFL may be used in any game, sold or free; they may not be sold on their own.

## Tom Thumb

Robey Pointer and Brian Swetland released Tom Thumb under CC0 1.0 (https://opengameart.org/node/39490). The original 3 × 5
font was released under this license:

```
The original 3x5 font is licensed under the 3-clause BSD license:

Copyright 1999 Brian J. Swetland
Copyright 1999 Vassilii Khachaturov
Portions (of vt100.c/vt100.h) copyright Dan Marks

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions, and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions, and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the authors may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## SIL Open Font License

Tiny5, Micro 5, Silkscreen, Press Start 2P and Jersey 10 are licensed under the SIL Open Font License, Version 1.1:

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
