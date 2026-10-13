# Demoscene Museum

Reverse-engineering old demoscene intros and rebuilding them as readable,
interactive Python — the content pipeline for a virtual demoscene museum.

## What this repo is

A demoscene RE project: DOS/Windows intros are decompiled with real tools
(IDA Pro, Ghidra, Reko), understood, then re-implemented in annotated Python
that a museum website can present to visitors.

**Hard rules of the project**

1. **Never read the shipped `.asm` source.** Everything must be recovered by
   decompiling the shipped binary. Reading the original source is cheating.
2. **Use the real tools.** No hand-rolled disassembler or ad-hoc byte-dumping as
   a substitute for IDA / Ghidra / Reko.
3. **Never state a number as fact unless it was read this session.** Anything
   inherited from a previous note is UNVERIFIED until re-checked.

## Current work

| Room | Demo | Status |
|---|---|---|
| `rooms/tube` | `TUBE.COM` — 256-byte intro by *baze* / 3SC, Syndeecate 2001 | disassembly ✅ · **Reko decompile ✅** · Python port ❌ |

## Toolchain

| Tool | Version | Role |
|---|---|---|
| IDA Professional | 9.0 | 16-bit disassembler (base `0x10000`, entry `0x10100`) |
| Ghidra | 12.1.4 | second-opinion disassembler |
| Reko | 0.12.5 | **the working decompiler** for DOS `.COM` |
| REA (`rea-agents`) | 6.4.0 | MCP agent that drives IDA |
| Python | 3.12.10 | ports and tooling |

### Why Reko
- **Hex-Rays cannot decompile 16-bit functions.** Not an FPU issue, no setting
  changes it. So IDA's pseudocode is unavailable for DOS `.COM`.
- **Ghidra's C decompiler fails** on this target (`0xffffffff` from the x87 FPU
  stack).
- **Reko handles it** and produced clean C output.

## Layout

```
docs/     project status, expert correspondence, tool notes
rooms/    one folder per demo (art-piece)
tools/    our own scripts (bridge patch, A/B harness)
```

## Key findings so far (TUBE.COM)

- sha256 `4dcc125e28fcc24947209f5e0ff851b8455c8fa96fec01106516307831e05ed0`
- IDA bases a DOS `.COM` at `0x10000` → entry is **`0x10100`**, not `0x100`, not `0x0`
- 119 instructions — **IDA and Ghidra agree exactly**
- x87-heavy: `FADD`, `FILD`, `FIMUL`, `FSINCOS`, `FPATAN`, `FSQRT`
- constants recovered from the binary (segment offsets):
  - `0x1F8` float32 `0.02380378730595112` — angle step **and** texture scale
  - `0x1D2` word `160` — eye distance
  - `0xFC` ASCII `baze` — signature
