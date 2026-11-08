function Mover() {
  const transform = useTransform({ x: 0, y: 0 });
  const body = useRef<Sprite>();

  onUpdate((dt) => {
    transform.x += 60 * dt;
    body.current.image = transform.x > 100 ? "run.png" : "idle.png";
  });

  return (
    <Entity name="Mover">
      <Sprite ref={body} image="idle.png" />
    </Entity>
  );
}
