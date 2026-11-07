function Enemy() {
  return (
    <Entity name="Enemy">
      <Sprite image="enemy.png" />
      <Collider width={20} height={20} />
    </Entity>
  );
}

function Level() {
  const [wave, setWave] = useState(1);
  const [bossVisible, setBossVisible] = useState(false);
  return (
    <Entity name="Level">
      <Enemy />
      <Enemy />
      {wave >= 3 && <Enemy />}
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
        </Entity>
      )}
    </Entity>
  );
}
