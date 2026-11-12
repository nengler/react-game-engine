import { Entity, useInput } from "@rge/runtime/jsx";

interface KeyPromptProps {
  /** The key pressed (never Escape). */
  onKey: (key: string) => void;
  /** Escape was pressed: no key is given. */
  onCancel: () => void;
}

/**
 * Waits for one key, for a settings row that rebinds an action. It is `modal`, so the menu under it hears nothing while it waits
 * (the row shows "press a key..."); it draws nothing itself. The press that opened it was an earlier step, so it is not taken.
 */
export function KeyPrompt({ onKey, onCancel }: KeyPromptProps) {
  useInput((input) => {
    const key = input.lastPressed();
    if (key === undefined) return;
    if (key === "Escape") onCancel();
    else onKey(key);
  });
  return <Entity name="KeyPrompt" modal />;
}
