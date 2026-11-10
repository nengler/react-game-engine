//! The `Backend` object the game's `hostBackend()` finds on `globalThis.__rgeBackend`: the same eight
//! methods the Node host implements, over the same `librge` calls. One `frame` call per frame carries the
//! draw records; the input comes back by writing into the two typed arrays the player passes.
use crate::ffi;
use rquickjs::{Ctx, Exception, Function, Object, Result as JsResult, TypedArray};
use std::ffi::CString;
use std::os::raw::c_char;

/// The global a host sets before it runs the game (`HOST_BACKEND_KEY` in `@rge/player`).
const HOST_BACKEND_KEY: &str = "__rgeBackend";

/// Check that the library this binary was linked against is the one `rge.h` this file was written for.
pub fn check_abi() -> Result<(), String> {
    let version = unsafe { ffi::rge_abi_version() };
    if version != ffi::RGE_ABI_VERSION {
        return Err(format!("librge speaks ABI version {version}, but this host expects {}", ffi::RGE_ABI_VERSION));
    }
    Ok(())
}

pub fn install<'js>(ctx: &Ctx<'js>) -> JsResult<()> {
    let backend = Object::new(ctx.clone())?;
    backend.set("open", Function::new(ctx.clone(), open)?.with_name("open")?)?;
    backend.set("close", Function::new(ctx.clone(), close)?.with_name("close")?)?;
    backend.set("setFullscreen", Function::new(ctx.clone(), set_fullscreen)?.with_name("setFullscreen")?)?;
    backend.set("loadTexture", Function::new(ctx.clone(), load_texture)?.with_name("loadTexture")?)?;
    backend.set("loadSound", Function::new(ctx.clone(), load_sound)?.with_name("loadSound")?)?;
    backend.set("playSound", Function::new(ctx.clone(), play_sound)?.with_name("playSound")?)?;
    backend.set("measureText", Function::new(ctx.clone(), measure_text)?.with_name("measureText")?)?;
    backend.set("textureSize", Function::new(ctx.clone(), texture_size)?.with_name("textureSize")?)?;
    backend.set("frame", Function::new(ctx.clone(), frame)?.with_name("frame")?)?;
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
    if flag("resizable", true)? { options |= ffi::RGE_OPEN_RESIZABLE; }
    if flag("vsync", true)? { options |= ffi::RGE_OPEN_VSYNC; }
    if flag("hidden", false)? { options |= ffi::RGE_OPEN_HIDDEN; }
    if flag("smooth", false)? { options |= ffi::RGE_OPEN_SMOOTH; }
    let title = c_string(&title);
    let code = unsafe { ffi::rge_open(width, height, title.as_ptr(), options) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("Could not open the window (librge error {code}).")));
    }
    Ok(())
}

fn close() {
    unsafe { ffi::rge_close() }
}

/// Full screen on or off; false when librge cannot (no window, or a hidden one).
fn set_fullscreen(on: bool) -> bool {
    unsafe { ffi::rge_set_fullscreen(on as i32) == 0 }
}

fn load_texture(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::rge_load_texture(path.as_ptr()) }
}

fn load_sound(path: String) -> i32 {
    let path = c_string(&path);
    unsafe { ffi::rge_load_sound(path.as_ptr()) }
}

fn play_sound(handle: i32) {
    unsafe { ffi::rge_play_sound(handle) }
}

/// The width and line height of `text` at `size`, as an object.
fn measure_text<'js>(ctx: Ctx<'js>, text: String, size: f64) -> JsResult<Object<'js>> {
    let text = c_string(&text);
    let mut out = [0.0f64; 2];
    let code = unsafe { ffi::rge_measure_text(text.as_ptr(), size, out.as_mut_ptr()) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("librge could not measure text at size {size}.")));
    }
    size_object(&ctx, out)
}

/// The width and height of a loaded texture, as an object.
fn texture_size<'js>(ctx: Ctx<'js>, handle: i32) -> JsResult<Object<'js>> {
    let mut out = [0.0f64; 2];
    let code = unsafe { ffi::rge_texture_size(handle, out.as_mut_ptr()) };
    if code != 0 {
        return Err(Exception::throw_message(&ctx, &format!("librge has no texture with handle {handle}.")));
    }
    size_object(&ctx, out)
}

fn size_object<'js>(ctx: &Ctx<'js>, size: [f64; 2]) -> JsResult<Object<'js>> {
    let object = Object::new(ctx.clone())?;
    object.set("width", size[0])?;
    object.set("height", size[1])?;
    Ok(object)
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
    let key_count = unsafe { ffi::rge_key_count() } as usize;
    if input_len < ffi::RGE_IN_LEN {
        return Err(Exception::throw_type(&ctx, &format!("The input buffer needs {} entries, not {input_len}.", ffi::RGE_IN_LEN)));
    }
    // Exactly: a longer buffer means the game was built with more keys than this librge knows, so names past the
    // end of librge's table would silently never be pressed (the Node host checks the same thing at load).
    if keys_len != key_count {
        return Err(Exception::throw_type(
            &ctx,
            &format!("The keys buffer has {keys_len} entries, but librge has {key_count} keys: rge.h and protocol.ts have drifted apart."),
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
        ffi::rge_frame(
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
