//! The `Backend` object the game's `hostBackend()` finds on `globalThis.__tseBackend`: the same eight
//! methods the Node host implements, over the same `libtse` calls. One `frame` call per frame carries the
//! draw records; the input comes back by writing into the two typed arrays the player passes.
use crate::ffi;
use rquickjs::{Ctx, Exception, Function, Object, Result as JsResult, TypedArray};
use std::ffi::CString;
use std::os::raw::c_char;

/// The global a host sets before it runs the game (`HOST_BACKEND_KEY` in `@tsengine/player`).
const HOST_BACKEND_KEY: &str = "__tseBackend";

/// Check that the library this binary was linked against is the one `tse.h` this file was written for.
pub fn check_abi() -> Result<(), String> {
    let version = unsafe { ffi::tse_abi_version() };
    if version != ffi::TSE_ABI_VERSION {
        return Err(format!("libtse speaks ABI version {version}, but this host expects {}", ffi::TSE_ABI_VERSION));
    }
    Ok(())
}

pub fn install<'js>(ctx: &Ctx<'js>) -> JsResult<()> {
    let backend = Object::new(ctx.clone())?;
    backend.set("open", Function::new(ctx.clone(), open)?.with_name("open")?)?;
    backend.set("close", Function::new(ctx.clone(), close)?.with_name("close")?)?;
    backend.set("setFullscreen", Function::new(ctx.clone(), set_fullscreen)?.with_name("setFullscreen")?)?;
    backend.set("loadTexture", Function::new(ctx.clone(), load_texture)?.with_name("loadTexture")?)?;
    backend.set("loadShader", Function::new(ctx.clone(), load_shader)?.with_name("loadShader")?)?;
    backend.set("loadSound", Function::new(ctx.clone(), load_sound)?.with_name("loadSound")?)?;
    backend.set("playSound", Function::new(ctx.clone(), play_sound)?.with_name("playSound")?)?;
    backend.set("loadMusic", Function::new(ctx.clone(), load_music)?.with_name("loadMusic")?)?;
    backend.set("playMusic", Function::new(ctx.clone(), play_music)?.with_name("playMusic")?)?;
    backend.set("setMusicVolume", Function::new(ctx.clone(), set_music_volume)?.with_name("setMusicVolume")?)?;
    backend.set("stopMusic", Function::new(ctx.clone(), stop_music)?.with_name("stopMusic")?)?;
    backend.set("setGamepadDeadzone", Function::new(ctx.clone(), set_gamepad_deadzone)?.with_name("setGamepadDeadzone")?)?;
    backend.set("measureText", Function::new(ctx.clone(), measure_text)?.with_name("measureText")?)?;
    backend.set("textureSize", Function::new(ctx.clone(), texture_size)?.with_name("textureSize")?)?;
    backend.set("overlaps", Function::new(ctx.clone(), overlaps)?.with_name("overlaps")?)?;
    backend.set("typed", Function::new(ctx.clone(), typed)?.with_name("typed")?)?;
    backend.set("frame", Function::new(ctx.clone(), frame)?.with_name("frame")?)?;
    // Saved data (ABI v7): `storage.open(gameId)`, then `read(name)` (text or null), `write(name, text)` and `remove(name)`.
    let storage = Object::new(ctx.clone())?;
    storage.set("open", Function::new(ctx.clone(), storage_open)?.with_name("open")?)?;
    storage.set("read", Function::new(ctx.clone(), storage_read)?.with_name("read")?)?;
    storage.set("write", Function::new(ctx.clone(), storage_write)?.with_name("write")?)?;
    storage.set("remove", Function::new(ctx.clone(), storage_remove)?.with_name("remove")?)?;
    backend.set("storage", storage)?;
    ctx.globals().set(HOST_BACKEND_KEY, backend)
}

/// A C string from JavaScript text; a NUL inside it would end the string early, so it becomes a space.
fn c_string(text: &str) -> CString {
    CString::new(text.replace('\0', " ")).expect("no NUL is left")
}

fn open<'js>(ctx: Ctx<'js>, config: Object<'js>) -> JsResult<()> {
    let width: i32 = config.get("width")?;
    let height: i32 = config.get("height")?;
    let title: String = config.get("title")?;
    let flag = |name: &str, default: bool| -> JsResult<bool> { Ok(config.get::<_, Option<bool>>(name)?.unwrap_or(default)) };
    let mut options = 0;
    if flag("resizable", true)? { options |= ffi::TSE_OPEN_RESIZABLE; }
    if flag("vsync", true)? { options |= ffi::TSE_OPEN_VSYNC; }
    let hidden = flag("hidden", false)?;
    if hidden { options |= ffi::TSE_OPEN_HIDDEN; }
    if flag("smooth", false)? { options |= ffi::TSE_OPEN_SMOOTH; }
    if flag("sharp", false)? { options |= ffi::TSE_OPEN_SHARP; }
    if flag("highDpi", !hidden)? { options |= ffi::TSE_OPEN_HIGHDPI; }
    let title = c_string(&title);
    let code = unsafe { ffi::tse_open(width, height, title.as_ptr(), options) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("Could not open the window (libtse error {code}).")));
    }
    Ok(())
}

fn close() {
    unsafe { ffi::tse_close() }
}

/// Full screen on or off; false when libtse cannot (no window, or a hidden one).
fn set_fullscreen(on: bool) -> bool {
    unsafe { ffi::tse_set_fullscreen(on as i32) == 0 }
}

fn load_texture(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::tse_load_texture(path.as_ptr()) }
}

/// A layer's shader (ABI v11): a handle, -1 when it could not be loaded, -2 where this build runs none.
fn load_shader(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::tse_load_shader(path.as_ptr()) }
}

fn load_sound(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::tse_load_sound(path.as_ptr()) }
}

/// Play a sound at `volume` (0 to 1) over any plays of it still going.
fn play_sound(handle: i32, volume: Option<f64>) {
    unsafe { ffi::tse_play_sound_ex(handle, volume.unwrap_or(1.0)) }
}

fn load_music(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::tse_load_music(path.as_ptr()) }
}

fn play_music(handle: i32, volume: f64, looping: bool) {
    unsafe { ffi::tse_music_play(handle, volume, looping as i32) }
}

fn set_music_volume(handle: i32, volume: f64) {
    unsafe { ffi::tse_music_set_volume(handle, volume) }
}

fn stop_music(handle: i32) {
    unsafe { ffi::tse_music_stop(handle) }
}

fn set_gamepad_deadzone(deadzone: f64) {
    unsafe { ffi::tse_set_gamepad_deadzone(deadzone) }
}

/// Open the game's saved-data folder (`tse_storage_open`): true when it is there to use.
fn storage_open(game_id: String) -> bool {
    let id = c_string(&game_id);
    unsafe { ffi::tse_storage_open(id.as_ptr()) == 0 }
}

/// An entry's text, or null (`None`) when there is none or it is not UTF-8.
fn storage_read(name: String) -> Option<String> {
    let name = c_string(&name);
    let size = unsafe { ffi::tse_storage_read(name.as_ptr(), std::ptr::null_mut(), 0) };
    if size < 0 {
        return None;
    }
    let mut bytes = vec![0u8; size as usize];
    let got = unsafe { ffi::tse_storage_read(name.as_ptr(), bytes.as_mut_ptr(), size) };
    if got != size {
        return None; // it changed between the two calls
    }
    String::from_utf8(bytes).ok()
}

fn storage_write(name: String, text: String) -> bool {
    let name = c_string(&name);
    let bytes = text.as_bytes();
    unsafe { ffi::tse_storage_write(name.as_ptr(), bytes.as_ptr(), bytes.len() as i32) == 0 }
}

fn storage_remove(name: String) {
    let name = c_string(&name);
    unsafe { ffi::tse_storage_remove(name.as_ptr()) };
}

/// What was typed in the last frame (ABI v9): its characters, with U+0008 for each Backspace.
fn typed() -> String {
    let mut out = [0u32; ffi::TSE_TYPED_MAX];
    let count = unsafe { ffi::tse_typed(out.as_mut_ptr(), ffi::TSE_TYPED_MAX as i32) };
    let count = (count.max(0) as usize).min(ffi::TSE_TYPED_MAX);
    out[..count].iter().filter_map(|&c| char::from_u32(c)).collect()
}

/// The width and line height of `text` at `size`, as an object.
fn measure_text<'js>(ctx: Ctx<'js>, text: String, size: f64) -> JsResult<Object<'js>> {
    let text = c_string(&text);
    let mut out = [0.0f64; 2];
    let code = unsafe { ffi::tse_measure_text(text.as_ptr(), size, out.as_mut_ptr()) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("libtse could not measure text at size {size}.")));
    }
    size_object(&ctx, out)
}

/// The width and height of a loaded texture, as an object.
fn texture_size<'js>(ctx: Ctx<'js>, handle: i32) -> JsResult<Object<'js>> {
    let mut out = [0.0f64; 2];
    let code = unsafe { ffi::tse_texture_size(handle, out.as_mut_ptr()) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("libtse has no texture with handle {handle}.")));
    }
    size_object(&ctx, out)
}

fn size_object<'js>(ctx: &Ctx<'js>, size: [f64; 2]) -> JsResult<Object<'js>> {
    let object = Object::new(ctx.clone())?;
    object.set("width", size[0])?;
    object.set("height", size[1])?;
    Ok(object)
}

/// The pairs of boxes that overlap (`tse_overlaps`): never more boxes than `boxes` and `order` hold, whatever `count` claims.
fn overlaps<'js>(ctx: Ctx<'js>, boxes: TypedArray<'js, f64>, count: i32, order: TypedArray<'js, i32>, pairs: TypedArray<'js, i32>) -> JsResult<i32> {
    let (boxes_ptr, boxes_len) = raw_f64(&ctx, &boxes, "boxes")?;
    let (order_ptr, order_len) = raw_i32(&ctx, &order, "order")?;
    let (pairs_ptr, pairs_len) = raw_i32(&ctx, &pairs, "pairs")?;
    let count = (count.max(0) as usize).min(boxes_len / 4).min(order_len).min(i32::MAX as usize);
    let capacity = (pairs_len / 2).min(i32::MAX as usize);
    Ok(unsafe { ffi::tse_overlaps(boxes_ptr as *const f64, count as i32, order_ptr, pairs_ptr, capacity as i32) })
}

/// Draw and present one frame, then write the next frame's input into `input` and `keys`.
fn frame<'js>(
    ctx: Ctx<'js>,
    clear_color: f64,
    records: TypedArray<'js, f64>,
    length: i32,
    texts: Vec<String>,
    input: TypedArray<'js, f64>,
    keys: TypedArray<'js, u8>,
) -> JsResult<()> {
    let (records_ptr, records_len) = raw_f64(&ctx, &records, "records")?;
    let (input_ptr, input_len) = raw_f64(&ctx, &input, "input")?;
    let (keys_ptr, keys_len) = raw_u8(&ctx, &keys, "keys")?;
    let key_count = unsafe { ffi::tse_key_count() } as usize;
    if input_len < ffi::TSE_IN_LEN {
        return Err(Exception::throw_type(&ctx, &format!("The input buffer needs {} entries, not {input_len}.", ffi::TSE_IN_LEN)));
    }
    // Exactly: a longer buffer means the game was built with more keys than this libtse knows, so names past the
    // end of libtse's table would silently never be pressed (the Node host checks the same thing at load).
    if keys_len != key_count {
        return Err(Exception::throw_type(
            &ctx,
            &format!("The keys buffer has {keys_len} entries, but libtse has {key_count} keys: tse.h and protocol.ts have drifted apart."),
        ));
    }
    // Never read past what the array holds, whatever length the caller claims.
    let length = (length.max(0) as usize).min(records_len);

    // NUL-terminated strings back to back, with the offset of each.
    let mut packed: Vec<u8> = Vec::new();
    let mut offsets: Vec<i32> = Vec::with_capacity(texts.len());
    for text in &texts {
        offsets.push(packed.len() as i32);
        packed.extend(text.bytes().map(|b| if b == 0 { b' ' } else { b }));
        packed.push(0);
    }
    if packed.is_empty() {
        packed.push(0);
    }

    unsafe {
        ffi::tse_frame(
            clear_color as u32,
            records_ptr as *const f64,
            length as i32,
            packed.as_ptr() as *const c_char,
            offsets.as_ptr(),
            offsets.len() as i32,
            input_ptr,
            keys_ptr,
        );
    }
    Ok(())
}

/// The memory behind a typed array and its length in elements. It is valid until the next call into
/// JavaScript, and `frame` makes none. (A macro, because rquickjs does not export the trait that bounds
/// the element type.)
macro_rules! raw_fn {
    ($name:ident, $t:ty) => {
        fn $name(ctx: &Ctx<'_>, array: &TypedArray<'_, $t>, what: &str) -> JsResult<(*mut $t, usize)> {
            let bytes = array
                .as_raw()
                .ok_or_else(|| Exception::throw_type(ctx, &format!("The {what} array has been detached.")))?;
            let ptr = bytes.as_ptr() as *mut u8;
            if (ptr as usize) % std::mem::align_of::<$t>() != 0 {
                return Err(Exception::throw_type(ctx, &format!("The {what} array is not aligned.")));
            }
            Ok((ptr as *mut $t, bytes.len() / std::mem::size_of::<$t>()))
        }
    };
}
raw_fn!(raw_f64, f64);
raw_fn!(raw_u8, u8);
raw_fn!(raw_i32, i32);
