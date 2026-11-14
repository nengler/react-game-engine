import { Sprite, useMount, useMutable, useUnmount } from "@rge/runtime/jsx";

interface BannerProps {
  text: string;
  onDone?: () => void;
}

/**
 * Shows itself once it has joined the world, and tells its parent when it
 * leaves. `useMount` runs once, after the first render; `useUnmount` cannot set
 * state (the banner is going away), so the parent hears about it through a callback.
 */
export function Banner({ text, onDone }: BannerProps) {
  const s = useMutable({ shown: false });
  useMount(() => { s.shown = true; });
  useUnmount(() => onDone?.());
  return <Sprite image={s.shown ? `banner-${text}.png` : "banner-hidden.png"} />;
}
