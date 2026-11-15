import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";

import { packVscode } from "../../../tools/pack-vscode.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = mkdtempSync(join(tmpdir(), "tse-vsix-"));
after(() => rmSync(out, { recursive: true, force: true }));

/** Every file of a zip, by name, read through its central directory, with each CRC checked. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "an end of central directory");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30);
    const comment = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const raw = archive.subarray(dataAt, dataAt + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(crc32(data) >>> 0, crc >>> 0, `${name}'s CRC`);
    files.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

describe("the VS Code extension's .vsix", () => {
  it("holds the extension's files and a manifest that names it, and is the same for the same files", () => {
    const path = packVscode(out);
    const files = unzip(readFileSync(path));
    assert.deepEqual(
      [...files.keys()],
      ["[Content_Types].xml", "extension.vsixmanifest", "extension/package.json", "extension/extension.js", "extension/README.md"]
    );
    const manifest = JSON.parse(readFileSync(join(repo, "editors/vscode/package.json"), "utf8")) as {
      name: string;
      version: string;
      publisher: string;
    };
    assert.equal(path, join(out, `tse-vscode-${manifest.version}.vsix`));
    assert.deepEqual(files.get("extension/extension.js"), readFileSync(join(repo, "editors/vscode/extension.js")));
    assert.match(
      files.get("extension.vsixmanifest")!.toString(),
      new RegExp(`<Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}" />`)
    );
    const first = readFileSync(path);
    assert.deepEqual(readFileSync(packVscode(out)), first);
  });
});
