//! QuickJS has no `console`. The game and the player use `console.warn`; scripts print results with
//! `console.log`. `log`, `info` and `debug` go to stdout; `warn` and `error` go to stderr.
use rquickjs::{Ctx, Function, Object, Result as JsResult, Value};

pub fn install<'js>(ctx: &Ctx<'js>) -> JsResult<()> {
    let console = Object::new(ctx.clone())?;
    for name in ["log", "info", "debug"] {
        console.set(name, Function::new(ctx.clone(), to_stdout)?.with_name(name)?)?;
    }
    for name in ["warn", "error"] {
        console.set(name, Function::new(ctx.clone(), to_stderr)?.with_name(name)?)?;
    }
    ctx.globals().set("console", console)
}

fn to_stdout<'js>(ctx: Ctx<'js>, args: rquickjs::function::Rest<Value<'js>>) {
    println!("{}", format_args_for_print(&ctx, &args));
}

fn to_stderr<'js>(ctx: Ctx<'js>, args: rquickjs::function::Rest<Value<'js>>) {
    eprintln!("{}", format_args_for_print(&ctx, &args));
}

/// Strings as they are; an error as its stack; anything else as JSON, or as `String(value)` if it has none.
fn format_args_for_print<'js>(ctx: &Ctx<'js>, args: &[Value<'js>]) -> String {
    args.iter().map(|value| format_one(ctx, value)).collect::<Vec<_>>().join(" ")
}

fn format_one<'js>(ctx: &Ctx<'js>, value: &Value<'js>) -> String {
    if let Some(string) = value.as_string() {
        return string.to_string().unwrap_or_default();
    }
    if let Some(object) = value.as_object() {
        if let Ok(stack) = object.get::<_, String>("stack") {
            return stack;
        }
    }
    if let Ok(Some(json)) = ctx.json_stringify(value.clone()) {
        if let Ok(text) = json.to_string() {
            return text;
        }
    }
    let to_string: Result<Function, _> = ctx.globals().get("String");
    match to_string.and_then(|f| f.call::<_, String>((value.clone(),))) {
        Ok(text) => text,
        Err(_) => "<unprintable>".to_string(),
    }
}
