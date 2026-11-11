import { Shape } from "@rge/runtime/jsx";

interface RangeRingProps {
  range: number;
}

/** The circle a tower reaches, centred on it. */
export function RangeRing({ range }: RangeRingProps) {
  return <Shape kind="circle" width={range * 2} height={range * 2} color="#ffffff22" transform={{ x: -range, y: -range }} />;
}
