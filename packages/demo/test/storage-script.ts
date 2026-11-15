/**
 * Writes, reads and removes saved-data entries through the host's backend and prints what it saw as one line of JSON. It runs under
 * the Rust host (QuickJS-ng) with TSE_DATA_DIR set; `parity.test.ts` checks the output. (Under Node the same calls are
 * `NodeBackend.storage`, tested in player-node's native.test.ts against the same library.)
 */
import { hostBackend } from "@tsengine/player";

const storage = hostBackend().storage;
if (storage === undefined) throw new Error("the host has no storage");
const seen: unknown[] = [];
seen.push(storage.open("parity-game"));
seen.push(storage.read("save"));
seen.push(storage.write("save", '{"version":1,"data":"héllo ✓"}'));
seen.push(storage.read("save"));
seen.push(storage.write("save", "two"));
seen.push(storage.read("save"));
seen.push(storage.write("a/b", "x"));
seen.push(storage.read("a/b"));
storage.remove("save");
seen.push(storage.read("save"));
seen.push(storage.open("../bad"));
console.log(JSON.stringify(seen));
