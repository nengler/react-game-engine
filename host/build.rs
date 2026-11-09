//! Builds `librge` (and the raylib it wraps) with CMake from `../native`, and links it statically.
//!
//! The platform is raylib's: `Desktop` (a real window) by default, or `Memory` (its software renderer: no
//! window, no GPU, no system libraries) with the `headless` feature or `RGE_PLATFORM=Memory`. The Memory
//! platform is what tests and CI use.
use std::env;
use std::path::PathBuf;

fn main() {
    let native = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../native");
    for path in ["CMakeLists.txt", "src", "include"] {
        println!("cargo:rerun-if-changed={}", native.join(path).display());
    }
    println!("cargo:rerun-if-env-changed=RGE_PLATFORM");

    let platform = env::var("RGE_PLATFORM").unwrap_or_else(|_| {
        if env::var("CARGO_FEATURE_HEADLESS").is_ok() { "Memory".into() } else { "Desktop".into() }
    });
    let headless = platform == "Memory";

    let out = cmake::Config::new(&native)
        .define("RGE_PLATFORM", &platform)
        .profile("Release")
        .build_target("rge_static")
        .build();
    let build = out.join("build");

    // librge, then raylib (which carries GLFW inside it), in link order.
    println!("cargo:rustc-link-search=native={}", build.display());
    println!("cargo:rustc-link-search=native={}", build.join("_deps/raylib-build/raylib").display());
    println!("cargo:rustc-link-lib=static=rge_static");
    println!("cargo:rustc-link-lib=static=raylib");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    match target_os.as_str() {
        "linux" => {
            if !headless {
                // What raylib's CMake lists for its X11 + OpenGL build.
                for lib in ["OpenGL", "GLX", "X11", "Xext", "SM", "ICE", "rt"] {
                    println!("cargo:rustc-link-lib=dylib={lib}");
                }
            }
            for lib in ["m", "pthread", "dl"] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        }
        // Unverified: these follow raylib's own link lists.
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
