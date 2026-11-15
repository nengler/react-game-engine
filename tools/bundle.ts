/**
 * Bundle a game's entry file into one ES module for the Rust host (QuickJS-ng). The work is `bundleForHost` in `@tsengine/cli`; this
 * is the command line the bench and the parity test use.
 *
 *   npm run bundle -- <entry.ts> <out.js>
 */
import { bundleForHost } from "@tsengine/cli";

const [entry, out] = process.argv.slice(2);
if (entry === undefined || out === undefined) {
  console.error("usage: npm run bundle -- <entry.ts> <out.js>");
  process.exit(2);
}
try {
  const { bytes } = await bundleForHost(entry, out);
  console.log(`bundled ${entry} -> ${out} (${(bytes / 1024).toFixed(0)} KB)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
