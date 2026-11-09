#ifndef RGE_INTERNAL_H
#define RGE_INTERNAL_H
/* Private to librge: the asset tables and the key table. The public ABI is include/rge.h. */
#include <stdbool.h>
#include <stdint.h>
#include "raylib.h"

/* ---------- assets.c ---------- */
/* `audio` false skips the audio device: sounds still load (so they are found) but stay silent. */
void assets_init(bool smooth, bool audio);
void assets_shutdown(void);
/* Handles are indices; an invalid handle returns false / does nothing. */
bool assets_texture(int32_t handle, Texture2D *out);
void assets_play(int32_t handle);
bool assets_audio_ready(void);

/* ---------- keys.c ---------- */
int32_t keys_count(void);
/* The RGE_KEY_* flags for key `index` this frame; Shift, Control and Alt read either side. */
uint8_t keys_flags(int32_t index);
/* Two keys read as one (left and right Shift): down while either is down, pressed when the first goes down, released
 * when the last comes up. Holding one side and pressing the other is not a second press. Takes and returns RGE_KEY_* flags. */
uint8_t keys_combine(uint8_t left, uint8_t right);

#endif
