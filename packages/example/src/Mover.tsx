function Mover() {
  const [x, setX] = useState(0);

  onUpdate((dt) => {
    setX((previous) => previous + 60 * dt);
  });

  return (
    <Entity name="Mover" transform={{ x, y: 0 }}>
      <Sprite image={x > 100 ? "run.png" : "idle.png"} />
    </Entity>
  );
}
