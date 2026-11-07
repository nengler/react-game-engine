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

function WarningIcon() {
  return (
    <Entity name="Warning">
      <Sprite image="warning.png" />
    </Entity>
  );
}
