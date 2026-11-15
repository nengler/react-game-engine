#!/usr/bin/env node
/** The language server on stdin and stdout, for an editor's LSP client: `tse lsp`, or `node main.ts` directly. */
import { startServer } from "./server.ts";

startServer(process.stdin, process.stdout);
