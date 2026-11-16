/* Saved data: named entries in the user's data folder, written atomically. See tse.h. Needs no window. */
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#ifdef _WIN32
#include <direct.h>
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#endif
#include "tse.h"

#define DIR_MAX 3072
#define NAME_MAX_LEN 64

static char dir[DIR_MAX];
static int opened = 0;

/* 1 to 64 of A-Z a-z 0-9 _ - : so a name or id can never hold a separator or a dot. */
static int valid_name(const char *name) {
  if (name == NULL) return 0;
  size_t n = strlen(name);
  if (n < 1 || n > NAME_MAX_LEN) return 0;
  for (size_t i = 0; i < n; i++) {
    char c = name[i];
    int ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (!ok) return 0;
  }
  return 1;
}

static int make_dir(const char *path) {
#ifdef _WIN32
  int r = _mkdir(path);
#else
  int r = mkdir(path, 0777);
#endif
  if (r == 0 || errno == EEXIST) return 0;
  /* Some prefixes cannot be made but are there all the same (a drive, a network share's root): fine if it is a folder. */
  struct stat st;
  if (stat(path, &st) == 0 && (st.st_mode & S_IFMT) == S_IFDIR) return 0;
  return -1;
}

/* mkdir -p: each prefix of the path, so a missing ~/.local/share is made too. */
static int make_dirs(const char *path) {
  char buf[DIR_MAX];
  size_t n = strlen(path);
  if (n == 0 || n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1);
  size_t start = 1;
#ifdef _WIN32
  /* "C:\..." or "C:/...": the drive is there; start making folders after it. */
  if (n >= 3 && buf[1] == ':' && (buf[2] == '\\' || buf[2] == '/')) start = 3;
#endif
  for (size_t i = start; i < n; i++) {
    if (buf[i] == '/' || buf[i] == '\\') {
      char saved = buf[i];
      buf[i] = 0;
      if (make_dir(buf) != 0) return -1;
      buf[i] = saved;
    }
  }
  return make_dir(buf);
}

static int entry_path(char *out, size_t size, const char *name, const char *ext) {
  if (!opened || !valid_name(name)) return -1;
  int n = snprintf(out, size, "%s/%s.%s", dir, name, ext);
  return (n > 0 && (size_t)n < size) ? 0 : -1;
}

/* An environment variable as the process has it now. On Windows the C runtime's getenv reads a copy made at startup, so a
 * variable the host sets later (Node's process.env) would not be seen; the process's own block is read instead. */
static const char *env(const char *name) {
#ifdef _WIN32
  static char values[4][DIR_MAX];
  static int next = 0;
  char *out = values[next];
  next = (next + 1) % 4;
  DWORD n = GetEnvironmentVariableA(name, out, DIR_MAX);
  return (n > 0 && n < DIR_MAX) ? out : NULL;
#else
  return getenv(name);
#endif
}

int32_t tse_storage_open(const char *game_id) {
  opened = 0;
  if (!valid_name(game_id)) return 1;
  const char *override = env("TSE_DATA_DIR");
  int n;
  if (override != NULL && override[0] != 0) {
    n = snprintf(dir, sizeof(dir), "%s", override);
  } else {
    const char *xdg = env("XDG_DATA_HOME");
    const char *home = env("HOME");
#ifdef _WIN32
    const char *appdata = env("APPDATA");
    if (appdata != NULL && appdata[0] != 0) n = snprintf(dir, sizeof(dir), "%s/%s", appdata, game_id);
    else return 2;
#else
    if (xdg != NULL && xdg[0] == '/') n = snprintf(dir, sizeof(dir), "%s/%s", xdg, game_id);
    else if (home != NULL && home[0] != 0) {
#ifdef __APPLE__
      n = snprintf(dir, sizeof(dir), "%s/Library/Application Support/%s", home, game_id);
#else
      n = snprintf(dir, sizeof(dir), "%s/.local/share/%s", home, game_id);
#endif
    } else return 2;
#endif
  }
  if (n <= 0 || (size_t)n >= sizeof(dir)) return 3;
  /* A trailing separator would double up in entry_path. */
  while (n > 1 && (dir[n - 1] == '/' || dir[n - 1] == '\\')) dir[--n] = 0;
  if (make_dirs(dir) != 0) return 4;
  opened = 1;
  return 0;
}

int32_t tse_storage_read(const char *name, uint8_t *out, int32_t capacity) {
  char path[DIR_MAX + 128];
  if (entry_path(path, sizeof(path), name, "dat") != 0) return -1;
  FILE *f = fopen(path, "rb");
  if (f == NULL) return -1;
  if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return -1; }
  long size = ftell(f);
  if (size < 0 || size > INT32_MAX) { fclose(f); return -1; }
  if (out != NULL && capacity >= size) {
    rewind(f);
    size_t got = size > 0 ? fread(out, 1, (size_t)size, f) : 0;
    if (got != (size_t)size) { fclose(f); return -1; }
  }
  fclose(f);
  return (int32_t)size;
}

int32_t tse_storage_write(const char *name, const uint8_t *data, int32_t length) {
  char path[DIR_MAX + 128];
  char tmp[DIR_MAX + 128];
  if (entry_path(path, sizeof(path), name, "dat") != 0 || entry_path(tmp, sizeof(tmp), name, "tmp") != 0) return 1;
  if (length < 0 || (length > 0 && data == NULL)) return 2;
  FILE *f = fopen(tmp, "wb");
  if (f == NULL) return 3;
  int ok = length == 0 || fwrite(data, 1, (size_t)length, f) == (size_t)length;
  ok = ok && fflush(f) == 0;
#ifdef _WIN32
  ok = ok && _commit(_fileno(f)) == 0;
#else
  ok = ok && fsync(fileno(f)) == 0;
#endif
  ok = (fclose(f) == 0) && ok;
  if (!ok) { remove(tmp); return 4; }
#ifdef _WIN32
  if (!MoveFileExA(tmp, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) { remove(tmp); return 5; }
#else
  if (rename(tmp, path) != 0) { remove(tmp); return 5; }
#endif
  return 0;
}

int32_t tse_storage_remove(const char *name) {
  char path[DIR_MAX + 128];
  if (entry_path(path, sizeof(path), name, "dat") != 0) return 1;
  if (remove(path) != 0 && errno != ENOENT) return 2;
  return 0;
}
