#include <stdlib.h>
#include "internal.h"

/* Textures and sounds are kept in growable tables; a handle is an index and is never reused. The
 * TypeScript side loads each path once, so this side does not look paths up. */

typedef struct {
  Texture2D *items;
  int32_t count;
  int32_t capacity;
} TextureTable;

typedef struct {
  Sound *items;
  bool *loaded; /* false for a sound that exists but cannot play (no audio device) */
  int32_t count;
  int32_t capacity;
} SoundTable;

static TextureTable textures;
static SoundTable sounds;
static bool smooth_filter;
static bool audio_ready;

void assets_init(bool smooth, bool audio) {
  smooth_filter = smooth;
  audio_ready = false;
  if (!audio) return;
  InitAudioDevice();
  audio_ready = IsAudioDeviceReady();
  if (!audio_ready) TraceLog(LOG_WARNING, "RGE: no audio device: sounds will be silent");
}

bool assets_audio_ready(void) {
  return audio_ready;
}

void assets_shutdown(void) {
  for (int32_t i = 0; i < textures.count; i++) UnloadTexture(textures.items[i]);
  for (int32_t i = 0; i < sounds.count; i++) if (sounds.loaded[i]) UnloadSound(sounds.items[i]);
  free(textures.items);
  free(sounds.items);
  free(sounds.loaded);
  textures = (TextureTable){0};
  sounds = (SoundTable){0};
  if (audio_ready) CloseAudioDevice();
  audio_ready = false;
}

bool assets_texture(int32_t handle, Texture2D *out) {
  if (handle < 0 || handle >= textures.count) return false;
  *out = textures.items[handle];
  return true;
}

void assets_play(int32_t handle) {
  if (handle < 0 || handle >= sounds.count || !sounds.loaded[handle]) return;
  PlaySound(sounds.items[handle]);
}

int32_t rge_load_texture(const char *path) {
  if (path == NULL || !FileExists(path)) return -1;
  Texture2D texture = LoadTexture(path);
  if (texture.id == 0) return -1;
  SetTextureFilter(texture, smooth_filter ? TEXTURE_FILTER_BILINEAR : TEXTURE_FILTER_POINT);
  if (textures.count == textures.capacity) {
    int32_t capacity = textures.capacity ? textures.capacity * 2 : 16;
    Texture2D *grown = realloc(textures.items, (size_t)capacity * sizeof(Texture2D));
    if (grown == NULL) {
      UnloadTexture(texture);
      return -1;
    }
    textures.items = grown;
    textures.capacity = capacity;
  }
  textures.items[textures.count] = texture;
  return textures.count++;
}

int32_t rge_load_sound(const char *path) {
  if (path == NULL || !FileExists(path)) return -1;
  Sound sound = {0};
  bool loaded = false;
  if (audio_ready) {
    sound = LoadSound(path);
    if (!IsSoundValid(sound)) return -1;
    loaded = true;
  }
  /* Without an audio device the sound is remembered but silent, so a headless run still counts it as found. */
  if (sounds.count == sounds.capacity) {
    int32_t capacity = sounds.capacity ? sounds.capacity * 2 : 16;
    Sound *grown_items = realloc(sounds.items, (size_t)capacity * sizeof(Sound));
    if (grown_items == NULL) {
      if (loaded) UnloadSound(sound);
      return -1;
    }
    sounds.items = grown_items;
    bool *grown_loaded = realloc(sounds.loaded, (size_t)capacity * sizeof(bool));
    if (grown_loaded == NULL) {
      if (loaded) UnloadSound(sound);
      return -1;
    }
    sounds.loaded = grown_loaded;
    sounds.capacity = capacity;
  }
  sounds.items[sounds.count] = sound;
  sounds.loaded[sounds.count] = loaded;
  return sounds.count++;
}

void rge_play_sound(int32_t handle) {
  assets_play(handle);
}
