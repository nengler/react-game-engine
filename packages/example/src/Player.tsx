import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity name="Player">
      <Sprite image={health > 50 ? "normal.png" : "hurt.png"} />
      <Collider width={16} height={24} />
      {health < 25 && <WarningIcon />}
    </Entity>
  );
}
