//! `native/include/rge.h`, as Rust declarations. The header is the source of truth.
use std::os::raw::c_char;

pub const RGE_ABI_VERSION: i32 = 2;

pub const RGE_IN_LEN: usize = 7;

pub const RGE_OPEN_RESIZABLE: u32 = 1;
pub const RGE_OPEN_VSYNC: u32 = 2;
pub const RGE_OPEN_HIDDEN: u32 = 4;
pub const RGE_OPEN_SMOOTH: u32 = 8;

extern "C" {
    pub fn rge_abi_version() -> i32;
    pub fn rge_key_count() -> i32;
    pub fn rge_open(width: i32, height: i32, title: *const c_char, options: u32) -> i32;
    pub fn rge_close();
    pub fn rge_load_texture(path: *const c_char) -> i32;
    pub fn rge_load_sound(path: *const c_char) -> i32;
    pub fn rge_play_sound(handle: i32);
    pub fn rge_measure_text(text: *const c_char, size: f64, out: *mut f64) -> i32;
    pub fn rge_texture_size(handle: i32, out: *mut f64) -> i32;
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
