#include "internal.h"
#include "rge.h"

/* The key table is include/rge.h's RGE_KEYS, expanded here: the order is the keys buffer's order. */
enum { KIND_K, KIND_M };

typedef struct {
  int kind;
  int code;
} KeyEntry;

#define ENTRY(kind, code, name) { KIND_##kind, code },
static const KeyEntry KEYS[] = { RGE_KEYS(ENTRY) };
#undef ENTRY

#define KEY_TABLE_LENGTH ((int32_t)(sizeof(KEYS) / sizeof(KEYS[0])))

int32_t keys_count(void) {
  return KEY_TABLE_LENGTH;
}

/* Shift, Control and Alt are listed once, as the left key; the right key counts too. */
static int right_partner(int code) {
  switch (code) {
    case KEY_LEFT_SHIFT: return KEY_RIGHT_SHIFT;
    case KEY_LEFT_CONTROL: return KEY_RIGHT_CONTROL;
    case KEY_LEFT_ALT: return KEY_RIGHT_ALT;
    default: return 0;
  }
}

/* One key's flags from raylib. */
static uint8_t key_flags(int code) {
  uint8_t flags = 0;
  if (IsKeyDown(code)) flags |= RGE_KEY_DOWN;
  if (IsKeyPressed(code)) flags |= RGE_KEY_PRESSED;
  if (IsKeyReleased(code)) flags |= RGE_KEY_RELEASED;
  return flags;
}

/* Whether a key was down last frame, from its flags this frame: down now and not just pressed, or just released. */
static bool was_down(uint8_t flags) {
  return (flags & RGE_KEY_DOWN) ? !(flags & RGE_KEY_PRESSED) : (flags & RGE_KEY_RELEASED) != 0;
}

uint8_t keys_combine(uint8_t left, uint8_t right) {
  bool down = ((left | right) & RGE_KEY_DOWN) != 0;
  bool before = was_down(left) || was_down(right);
  uint8_t flags = 0;
  if (down) flags |= RGE_KEY_DOWN;
  if (down && !before) flags |= RGE_KEY_PRESSED;
  if (!down && before) flags |= RGE_KEY_RELEASED;
  return flags;
}

uint8_t keys_flags(int32_t index) {
  if (index < 0 || index >= KEY_TABLE_LENGTH) return 0;
  const KeyEntry *entry = &KEYS[index];
  if (entry->kind == KIND_M) {
    uint8_t flags = 0;
    if (IsMouseButtonDown(entry->code)) flags |= RGE_KEY_DOWN;
    if (IsMouseButtonPressed(entry->code)) flags |= RGE_KEY_PRESSED;
    if (IsMouseButtonReleased(entry->code)) flags |= RGE_KEY_RELEASED;
    return flags;
  }
  int partner = right_partner(entry->code);
  if (!partner) return key_flags(entry->code);
  return keys_combine(key_flags(entry->code), key_flags(partner));
}
