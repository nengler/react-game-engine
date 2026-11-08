import type { HandlerHookIR, TypeIR } from "./types.ts";

const number: TypeIR = { kind: "Primitive", name: "number" };

export interface HandlerSignature {
  /** The runtime method the hook overrides. */
  readonly method: string;
  /** Canonical parameters the runtime passes. A handler may declare a prefix of them under its own names. */
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
}

/** Shared by the transform (parameter types) and the generator (override signatures). */
export const HANDLER_SIGNATURES: Readonly<Record<HandlerHookIR["kind"], HandlerSignature>> = {
  OnUpdate: { method: "onUpdate", params: [{ name: "dt", type: number }] },
  OnInput: { method: "onInput", params: [{ name: "input", type: { kind: "Named", name: "InputState" } }] },
};
