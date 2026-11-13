import { Entity, Shape, Text, useMount, useSpring, useState, useTween } from "@rge/runtime/jsx";

interface NoticeProps {
  text: string;
}

/**
 * The card that says what just happened ("Got the lantern"). It drops in from above with a little bounce and fades in as it
 * appears: `shown` turns on once it is mounted, and a spring and a tween follow it.
 */
export function Notice({ text }: NoticeProps) {
  const [shown, setShown] = useState(false);
  useMount(() => {
    setShown(true);
  });
  const y = useSpring(shown ? 18 : 4, { duration: 0.35, bounce: 0.3 });
  const opacity = useTween(shown ? 1 : 0, { duration: 0.2 });

  return (
    <Entity transform={{ y, opacity }}>
      <Shape kind="rect" width={320} height={14} color="#10131ccc" />
      <Text transform={{ x: 0, y: 2 }} width={320} align="center" color="#fff1d6">{text}</Text>
    </Entity>
  );
}
