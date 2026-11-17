import { Flex, Hud, Text } from "@tsengine/runtime/jsx";

export interface FontSamplerProps {
  /** The screen's width in pixels, for the dialogue box's wrapping. */
  width: number;
  /** One built-in font (`"tse:m5x7"`) as a game would use it: a HUD line, a title and a dialogue box. */
  font?: string;
  /** Without `font`, these fonts, a line each (the stories give `BUILTIN_FONTS`). */
  fonts?: readonly string[];
}

const SAMPLE = "The quick brown fox jumps over the lazy dog.";
const DIALOGUE = "You found the old lantern! It is cold, but something inside still flickers. Take it to the keeper?";

/**
 * The fonts built into the engine, to choose one for a game: `tse preview packages/demo` shows them at 320 × 180, 480 × 270 and
 * 640 × 360 (F5 and F6 switch story). Each is drawn at its own size, a pixel of the font to a pixel of the screen.
 */
export function FontSampler({ width, font, fonts = [] }: FontSamplerProps) {
  if (font === undefined)
    return (
      <Hud>
        <Flex direction="column" gap={3} padding={4}>
          {fonts.map((name) => (
            <Text key={name} font={name} color="white">
              {`${name}  ${SAMPLE}  HP 42/50  Gold 1,280`}
            </Text>
          ))}
        </Flex>
      </Hud>
    );
  return (
    <Hud>
      <Flex direction="column" gap={6} padding={6} width="grow" height="grow">
        <Flex direction="row" justifyContent="space-between" width="grow">
          <Text font={font} color="#ffd66b">
            HP 42/50
          </Text>
          <Text font={font} color="#ffd66b">
            Gold 1,280
          </Text>
          <Text font={font} color="#9fb4ff">
            {font}
          </Text>
        </Flex>
        <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={4}>
          <Text font={font} color="white" outline="#5b3fb0">
            THE LANTERN KEEPER
          </Text>
          <Text font={font} color="#c8cde0">
            Press Enter to start
          </Text>
        </Flex>
        <Flex padding={5} width="grow" background="#20263a" borderWidth={1} borderColor="#9fb4ff">
          <Text font={font} color="white" maxWidth={width - 24} lineGap={2}>
            {DIALOGUE}
          </Text>
        </Flex>
      </Flex>
    </Hud>
  );
}
