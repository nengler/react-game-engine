/* tse_overlaps: which boxes overlap, for the player's collisions. It touches no window and no raylib, so it runs
 * before tse_open and after tse_close. The same sweep as the script's own (packages/player/src/collide.ts), which a
 * backend without this function still uses: the two must find the same pairs. */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "tse.h"

/* The most bands the sweep is cut into, and how many mean box heights tall a band is. */
#define BAND_LIMIT 1024
#define BAND_HEIGHT 2.0

/* Working memory, kept between calls and grown when a frame has more boxes. */
static int32_t *scratch = NULL;
static int64_t scratch_capacity = 0;

static int before(const double *boxes, int32_t a, int32_t b) {
  const double left_a = boxes[(int64_t)a * 4], left_b = boxes[(int64_t)b * 4];
  return left_a < left_b || (left_a == left_b && a < b);
}

/* `order` by left edge, ties by index. It is usually last frame's order of boxes that barely moved, so an insertion
 * sort is close to linear; after too many shifts (a teleport, a new list) a merge sort finishes the job. Both only
 * ever move the values already in `order`, so a comparison that is inconsistent (a NaN in `boxes`) cannot make
 * either read or write out of bounds. */
static void sort_by_left_edge(const double *boxes, int32_t *order, int32_t count, int32_t *spare) {
  int64_t budget = (int64_t)count * 8;
  for (int32_t i = 1; i < count; i++) {
    const int32_t v = order[i];
    int32_t j = i - 1;
    while (j >= 0 && !before(boxes, order[j], v)) {
      order[j + 1] = order[j];
      j--;
      if (--budget < 0) {
        order[j + 1] = v; /* still a permutation */
        goto merge;
      }
    }
    order[j + 1] = v;
  }
  return;
merge:
  for (int32_t width = 1; width < count; width *= 2) {
    for (int32_t low = 0; low < count; low += 2 * width) {
      const int32_t mid = low + width < count ? low + width : count;
      const int32_t high = low + 2 * width < count ? low + 2 * width : count;
      int32_t a = low, b = mid, out = low;
      while (a < mid && b < high) spare[out++] = before(boxes, order[b], order[a]) ? order[b++] : order[a++];
      while (a < mid) spare[out++] = order[a++];
      while (b < high) spare[out++] = order[b++];
    }
    memcpy(order, spare, (size_t)count * sizeof(int32_t));
    if (width > count / 2) break; /* the next doubling would overflow for a huge count */
  }
}

/* The band a y falls in, between 0 and `last`: never out of range, whatever `y` is (a NaN is band 0). */
static int32_t band_of(double y, double top, double inverse, int32_t last) {
  const double f = (y - top) * inverse;
  if (f >= (double)last) return last;
  return f > 0 ? (int32_t)f : 0;
}

int32_t tse_overlaps(const double *boxes, int32_t count, int32_t *order, int32_t *pairs, int32_t capacity) {
  if (boxes == NULL || order == NULL || count <= 0) return 0;
  if (pairs == NULL || capacity < 0) capacity = 0;

  /* One block: a seen flag and a merge slot for each box, its first and last band, the band tables, and the boxes of
   * each band one after another (up to three entries a box; see below). */
  const int64_t n = count;
  const int64_t needed = n * 7 + 2 * (BAND_LIMIT + 1);
  if (scratch_capacity < needed) {
    int32_t *grown = (int32_t *)realloc(scratch, (size_t)needed * sizeof(int32_t));
    if (grown == NULL) return 0;
    scratch = grown;
    scratch_capacity = needed;
  }
  int32_t *spare = scratch;
  int32_t *first = scratch + n;
  int32_t *last = scratch + 2 * n;
  int32_t *fill = scratch + 3 * n;
  int32_t *starts = fill + BAND_LIMIT + 1;
  int32_t *slots = starts + BAND_LIMIT + 1;
  const int64_t slots_capacity = n * 3;

  /* `order` is the caller's memory and may hold anything: unless it is a permutation of the boxes, start from 0, 1, 2… */
  memset(spare, 0, (size_t)count * sizeof(int32_t));
  int valid = 1;
  for (int32_t i = 0; i < count; i++) {
    const int32_t v = order[i];
    if (v < 0 || v >= count || spare[v]) {
      valid = 0;
      break;
    }
    spare[v] = 1;
  }
  if (!valid) {
    for (int32_t i = 0; i < count; i++) order[i] = i;
  }
  sort_by_left_edge(boxes, order, count, spare);

  /* A sweep over x tests every pair of boxes that overlap in x, wherever they are in y. So the boxes are dealt into
   * horizontal bands, each swept on its own; a box is in every band it reaches into, and a pair that shares several
   * bands is taken in the first of them. A band is BAND_HEIGHT mean box heights, so a box is in one or two bands
   * unless it is far taller than most, and the entries are at most 2.5 for each box (the sum of height / band height
   * is count / BAND_HEIGHT, and each box is in at most that plus two). Anything else is swept as one band. */
  double top = INFINITY, bottom = -INFINITY, heights = 0;
  for (int32_t i = 0; i < count; i++) {
    const double min_y = boxes[(int64_t)i * 4 + 1], max_y = boxes[(int64_t)i * 4 + 3];
    if (min_y < top) top = min_y;
    if (max_y > bottom) bottom = max_y;
    heights += max_y - min_y;
  }
  const double range = bottom - top;
  double height = heights / count * BAND_HEIGHT;
  int32_t bands = 1;
  if (range < INFINITY && height > 0 && range >= height) {
    const double wanted = floor(range / height) + 1;
    if (wanted > BAND_LIMIT) {
      bands = BAND_LIMIT;
      height = range / BAND_LIMIT;
    } else {
      bands = (int32_t)wanted;
    }
  }
  if (bands > 1) {
    const double inverse = 1 / height;
    const int32_t last_band = bands - 1;
    int64_t entries = 0;
    memset(fill, 0, (size_t)bands * sizeof(int32_t));
    for (int32_t i = 0; i < count; i++) {
      const int32_t a = band_of(boxes[(int64_t)i * 4 + 1], top, inverse, last_band);
      int32_t b = band_of(boxes[(int64_t)i * 4 + 3], top, inverse, last_band);
      if (b < a) b = a;
      first[i] = a;
      last[i] = b;
      for (int32_t k = a; k <= b; k++) fill[k]++;
      entries += b - a + 1;
    }
    if (entries > slots_capacity) {
      bands = 1; /* not boxes this function was promised: sweep them as one band */
    } else {
      int32_t at = 0;
      for (int32_t b = 0; b < bands; b++) {
        const int32_t size = fill[b];
        starts[b] = at;
        fill[b] = at;
        at += size;
      }
      starts[bands] = at;
      for (int32_t s = 0; s < count; s++) {
        const int32_t p = order[s];
        for (int32_t k = first[p]; k <= last[p]; k++) slots[fill[k]++] = p;
      }
    }
  }
  const int32_t *list = slots;
  if (bands == 1) {
    list = order;
    starts[0] = 0;
    starts[1] = count;
  }

  /* In each band, boxes by left edge: a box can only touch the ones after it that start before it ends. */
  int64_t found = 0;
  for (int32_t band = 0; band < bands; band++) {
    const int32_t end = starts[band + 1];
    for (int32_t s = starts[band]; s < end; s++) {
      const int32_t p = list[s];
      const double *box = boxes + (int64_t)p * 4;
      const double min_y = box[1], max_x = box[2], max_y = box[3];
      for (int32_t t = s + 1; t < end; t++) {
        const int32_t q = list[t];
        const double *other = boxes + (int64_t)q * 4;
        if (other[0] >= max_x) break;
        if (!(min_y < other[3] && max_y > other[1])) continue;
        if (bands > 1 && (first[p] > first[q] ? first[p] : first[q]) != band) continue;
        if (found < capacity) {
          pairs[found * 2] = p;
          pairs[found * 2 + 1] = q;
        }
        found++;
      }
    }
  }
  return found > INT32_MAX ? INT32_MAX : (int32_t)found;
}
