//! tse-host: run a bundled game (one ES module) in QuickJS-ng, drawing through libtse (raylib).
//!
//!     tse-host [<game.js>] [--root <dir>]
//!
//! `--root` is the folder the game's relative paths (its `assets/`) are resolved against; the default is
//! the current directory. With no arguments it runs the `game.js` next to the executable, in that folder:
//! that is how a packaged game starts (`npm run package`). The bundle is made with `npm run bundle`. An
//! uncaught exception prints its stack and exits with status 1.
mod backend;
mod console;
mod ffi;

use rquickjs::{CatchResultExt, Context, Module, Runtime};
use std::process::ExitCode;

const USAGE: &str = "usage: tse-host [<game.js>] [--root <dir>]   (no arguments: run game.js next to this executable)";

fn main() -> ExitCode {
    let mut game: Option<String> = None;
    let mut root: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => match args.next() {
                Some(value) => root = Some(value),
                None => return usage_error("--root needs a folder."),
            },
            "-h" | "--help" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            flag if flag.starts_with("--") => return usage_error(&format!("unknown option {flag}.")),
            _ if game.is_none() => game = Some(arg),
            _ => return usage_error("only one game file can be run."),
        }
    }
    // A packaged game: no arguments, and `game.js` sits next to the executable, which is also the root.
    if game.is_none() {
        match std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.to_path_buf())) {
            Some(dir) if dir.join("game.js").is_file() => {
                game = Some(dir.join("game.js").to_string_lossy().into_owned());
                root.get_or_insert_with(|| dir.to_string_lossy().into_owned());
            }
            _ => return usage_error("no game file given, and there is no game.js next to this executable."),
        }
    }
    let game = game.expect("set above");

    if let Err(message) = backend::check_abi() {
        eprintln!("{message}");
        return ExitCode::from(1);
    }
    // A relative game path means relative to where it was started, so make it absolute before changing folder.
    let game = std::fs::canonicalize(&game).map(|p| p.to_string_lossy().into_owned()).unwrap_or(game);
    if let Some(root) = root {
        if let Err(error) = std::env::set_current_dir(&root) {
            eprintln!("Cannot use --root {root}: {error}");
            return ExitCode::from(2);
        }
    }
    run(&game)
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("{message}\n{USAGE}");
    ExitCode::from(2)
}

fn run(path: &str) -> ExitCode {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("Cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };

    let runtime = Runtime::new().expect("the JavaScript runtime starts");
    // The game's own recursion is shallow (a tree walk); this leaves room under the main thread's 8 MB.
    runtime.set_max_stack_size(4 * 1024 * 1024);
    let context = Context::full(&runtime).expect("the JavaScript context starts");

    context.with(|ctx| {
        let setup = console::install(&ctx).and_then(|_| backend::install(&ctx));
        if let Err(error) = setup.catch(&ctx) {
            eprintln!("{error}");
            return ExitCode::from(1);
        }
        // The game runs inside the module's evaluation: `run()` loops until the window closes.
        let result = Module::evaluate(ctx.clone(), path, source).and_then(|promise| promise.finish::<()>());
        match result.catch(&ctx) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("{error}");
                ExitCode::from(1)
            }
        }
    })
}
