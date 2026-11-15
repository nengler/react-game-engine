//! `native/include/rge.h`, as Rust declarations. The header is the source of truth.
use std::os::raw::c_char;

pub const RGE_ABI_VERSION: i32 = 11;
pub const RGE_TYPED_MAX: usize = 64;

pub const RGE_IN_LEN: usize = 7;

pub const RGE_OPEN_RESIZABLE: u32 = 1;
pub const RGE_OPEN_VSYNC: u32 = 2;
pub const RGE_OPEN_HIDDEN: u32 = 4;
pub const RGE_OPEN_SMOOTH: u32 = 8;
pub const RGE_OPEN_SHARP: u32 = 16;

extern "C" {
    pub fn rge_abi_version() -> i32;
    pub fn rge_key_count() -> i32;
    pub fn rge_open(width: i32, height: i32, title: *const c_char, options: u32) -> i32;
    pub fn rge_close();
    pub fn rge_set_fullscreen(on: i32) -> i32;
    pub fn rge_load_texture(path: *const c_char) -> i32;
    pub fn rge_load_shader(path: *const c_char) -> i32;
    pub fn rge_load_sound(path: *const c_char) -> i32;
    pub fn rge_play_sound_ex(handle: i32, volume: f64);
    pub fn rge_load_music(path: *const c_char) -> i32;
    pub fn rge_music_play(handle: i32, volume: f64, loop_: i32);
    pub fn rge_music_set_volume(handle: i32, volume: f64);
    pub fn rge_music_stop(handle: i32);
    pub fn rge_set_gamepad_deadzone(deadzone: f64);
    pub fn rge_measure_text(text: *const c_char, size: f64, out: *mut f64) -> i32;
    pub fn rge_texture_size(handle: i32, out: *mut f64) -> i32;
    pub fn rge_storage_open(game_id: *const c_char) -> i32;
    pub fn rge_storage_read(name: *const c_char, out: *mut u8, capacity: i32) -> i32;
    pub fn rge_storage_write(name: *const c_char, data: *const u8, length: i32) -> i32;
    pub fn rge_storage_remove(name: *const c_char) -> i32;
    pub fn rge_typed(out: *mut u32, capacity: i32) -> i32;
    pub fn rge_overlaps(boxes: *const f64, count: i32, order: *mut i32, pairs: *mut i32, capacity: i32) -> i32;
    pub fn rge_frame(
        clear_color: u32,
        records: *const f64,
        records_length: i32,
        text: *const c_char,
        text_offsets: *const i32,
        text_count: i32,
        input: *mut f64,
        keys: *mut u8,
    );
}
