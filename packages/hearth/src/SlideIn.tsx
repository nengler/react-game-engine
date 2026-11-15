import { type Child, Flex, useMount, useSpring, useMutable, useTween } from "@tsengine/runtime/jsx";

interface SlideInProps {
  children: Child;
}

/**
 * What it holds slides in from the right and fades in as it appears: `shown` turns on once it is mounted, and a spring and a
 * tween follow it. The side panel's build menu and upgrade panel come in this way.
 */
export function SlideIn({ children }: SlideInProps) {
  const s = useMutable({ shown: false });
  useMount(() => {
    s.shown = true;
  });
  const x = useSpring(s.shown ? 0 : 24, { duration: 0.3, bounce: 0.15 });
  const opacity = useTween(s.shown ? 1 : 0, { duration: 0.15 });

  return (
    <Flex direction="column" width="grow" transform={{ x, opacity }}>
      {children}
    </Flex>
  );
}
