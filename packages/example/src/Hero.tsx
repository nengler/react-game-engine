function Hero() {
  const [health, setHealth] = useState(100);
  const [poisoned, setPoisoned] = useState(false);

  onUpdate((dt) => {
    if (poisoned) {
      const next = health - dt * 5;
      setHealth(next > 0 ? next : 0);
    }
  });

  onCollisionEnter(() => {
    setHealth((h) => h - 10);
    setPoisoned(true);
  });

  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
      <Collider width={16} height={24} />
    </Entity>
  );
}
