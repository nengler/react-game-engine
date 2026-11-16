//! Builds `libtse` (and the raylib it wraps) with CMake from `../native`, and links it statically.
//!
//! The platform is raylib's: `Desktop` (a real window) by default, or `Memory` (its software renderer: no
//! window, no GPU, no system libraries) with the `headless` feature or `TSE_PLATFORM=Memory`. The Memory
//! platform is what tests and CI use.
use std::env;
use std::path::PathBuf;

fn main() {
    let native = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../native");
    for path in ["CMakeLists.txt", "src", "include"] {
        println!("cargo:rerun-if-changed={}", native.join(path).display());
    }
    println!("cargo:rerun-if-env-changed=TSE_PLATFORM");

    let platform = env::var("TSE_PLATFORM").unwrap_or_else(|_| {
        if env::var("CARGO_FEATURE_HEADLESS").is_ok() { "Memory".into() } else { "Desktop".into() }
    });
    let headless = platform == "Memory";

    let out = cmake::Config::new(&native)
        .define("TSE_PLATFORM", &platform)
        .profile("Release")
        .build_target("tse_static")
        .build();
    let build = out.join("build");

    // libtse, then raylib (which carries GLFW inside it), in link order. A multi-config generator (Visual Studio, the default
    // with MSVC) puts each library in a `Release` folder below these, so both are searched.
    let raylib = build.join("_deps/raylib-build/raylib");
    for dir in [build.clone(), build.join("Release"), raylib.clone(), raylib.join("Release")] {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    println!("cargo:rustc-link-lib=static=tse_static");
    println!("cargo:rustc-link-lib=static=raylib");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    match target_os.as_str() {
        "linux" => {
            // Nothing for X11 or OpenGL: raylib's GLFW loads those libraries at run time (the built binary needs
            // only libm, libgcc_s and libc), so a machine that builds this does not need their link libraries.
            // CMake's own link line for raylib lists libSM and libICE too; they are not used, and a build machine
            // without their development packages cannot link them.
            for lib in ["m", "pthread", "dl"] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        }
        // These follow raylib's own link lists; the release workflow builds and smoke-tests them on macOS and Windows.
        "macos" => {
            if !headless {
                for framework in ["Cocoa", "IOKit", "CoreVideo", "OpenGL"] {
                    println!("cargo:rustc-link-lib=framework={framework}");
                }
            }
            for framework in ["CoreAudio", "AudioToolbox", "CoreFoundation"] {
                println!("cargo:rustc-link-lib=framework={framework}");
            }
        }
        "windows" => {
            for lib in ["winmm", "gdi32", "user32", "shell32", "ole32"] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
            if !headless {
                println!("cargo:rustc-link-lib=dylib=opengl32");
            }
        }
        _ => {}
    }
}
