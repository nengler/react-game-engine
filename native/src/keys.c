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

uint8_t keys_flags(int32_t index) {
  if (index < 0 || index >= KEY_TABLE_LENGTH) return 0;
  const KeyEntry *entry = &KEYS[index];
  uint8_t flags = 0;
  if (entry->kind == KIND_M) {
    if (IsMouseButtonDown(entry->code)) flags |= RGE_KEY_DOWN;
    if (IsMouseButtonPressed(entry->code)) flags |= RGE_KEY_PRESSED;
    if (IsMouseButtonReleased(entry->code)) flags |= RGE_KEY_RELEASED;
    return flags;
  }
  int partner = right_partner(entry->code);
  if (IsKeyDown(entry->code) || (partner && IsKeyDown(partner))) flags |= RGE_KEY_DOWN;
  if (IsKeyPressed(entry->code) || (partner && IsKeyPressed(partner))) flags |= RGE_KEY_PRESSED;
  if (IsKeyReleased(entry->code) || (partner && IsKeyReleased(partner))) flags |= RGE_KEY_RELEASED;
  return flags;
}
