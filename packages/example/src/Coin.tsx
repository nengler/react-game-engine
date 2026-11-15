import { useMutable, useUpdate, Sprite } from "@rge/runtime/jsx";

interface CoinProps {
  value: number;
  spin?: number;
}

// The component *is* a Sprite: no container around it, and a parent can place it like any other component.
const Coin = ({ value, spin = 1 }: CoinProps) => {
  const s = useMutable({ angle: 0 });
  useUpdate((dt) => {
    s.angle += dt * spin;
  });
  return <Sprite image={value >= 5 ? "gold-coin.png" : "coin.png"} rotation={s.angle} />;
};

export default Coin;

interface TrailProps {
  value: number;
}

// A fragment root is an implicit container with nothing else on it. This one takes its props as an object.
export function Trail(props: TrailProps) {
  return (
    <>
      <Coin value={props.value} />
      <Coin value={props.value} transform={{ x: 16 }} />
      <Coin value={props.value} transform={{ x: 32 }} spin={4} />
    </>
  );
}
