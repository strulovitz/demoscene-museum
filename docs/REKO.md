# REKO — install & use plan (for TUBE.COM / DOS .COM)

Written 2026-10-13. Facts below came from Reko's own GitHub docs, verified today
by web search. Anything I could not verify is marked UNVERIFIED.

## WHY WE NEED IT
Hex-Rays (IDA's decompiler) **does not support 16-bit functions**. That is a hard
product limitation, not a bug and not a timeout. Ghidra's C decompiler also fails
on this target. So for DOS 256-byte `.COM` intros we need a third decompiler.
Reko is free, open source, and documents a DOS `.COM` mode.

## WHAT REKO IS (verified)
- Free/open-source binary decompiler, project `uxmal/reko`, GPL-2.0.
- Latest release seen today: **0.12.4**.
- Ships BOTH a Windows GUI and a command-line client (`reko.exe`).
- Windows install is an **MSI installer**.

## HOW TO GET IT
1. Go to the official releases page: `https://github.com/uxmal/reko/releases`
2. Download the **64-bit x86 Windows MSI** (latest 0.12.4).
3. Run the MSI. It installs to:
   `C:\Program Files\jklSoft\Reko`
   and creates a Start Menu shortcut "Reko decompiler".
4. **Prerequisite:** a .NET runtime. Reko's README says .NET 9.0; the NuGet
   runtime package for 0.12.4 targets .NET 8.0. UNVERIFIED which one the MSI
   actually needs — the MSI may be self-contained. If it complains, install
   .NET from `https://dotnet.microsoft.com/download/dotnet/8.0` or 9.0.

### ⚠️ IMPORTANT ON THIS MACHINE
This host's machine-level `Path` registry value **does not exist**, so
`C:\Windows\System32` is not on PATH and `reko.exe` will **NOT** resolve by name.
Always call it by absolute path:

```
"C:\Program Files\jklSoft\Reko\reko.exe" decompile <options> TUBE.COM
```

Nir has deliberately refused any PATH repair. Do not propose one.

### ❓ CONSENT
Installing an MSI under Program Files is a **machine-wide install**. Nir's
standing rule is: do not modify the system without explicit permission.
**Ask Nir before downloading/installing.** He asked for *instructions* only.

## HOW TO USE IT ON TUBE.COM
Command form (from the expert answer, to be tried first):
```
"C:\Program Files\jklSoft\Reko\reko.exe" decompile --arch x86-real-16 --env ms-dos --base 0C00:0100 "C:\DEMOS\dos256b\tube\TUBE.COM"
```
Alternative generic raw-loader form (verified syntax from Reko's CLI docs):
```
reko decompile --loader raw --arch x86 --base 0C00:0100 --entry 0C00:0100 TUBE.COM
```
Also useful while learning: `reko dasm <file>` (disassemble only),
`reko dump <file>` (dump to stdout), `reko --help` (list loaders/arches/envs).

Output files land next to the input by default — which would write into
`C:\DEMOS\...`. **Nir's rule: all generated output goes to `C:\DEMOS\_WORK\`.**
So copy TUBE.COM to `C:\DEMOS\_WORK\reko\TUBE.COM` first and run Reko there.

## WHAT SUCCESS LOOKS LIKE
A `.c` file containing a `main`-ish function with the VGA setup, the palette ramp,
the FPU texture/raycast maths and the blit loop, in readable C.

**If Reko also chokes on the 8087 FPU**, then the honest fallback is
tool-assisted manual decompilation:
- IDA disassembly is the source of truth (use REA's `procedure_assembly` once the
  bridge fix is live, or the IDA GUI).
- Use `set_comment` on every FPU instruction to record the x87 stack (ST0–ST7).
- Use `rename_function` / labels for loops.
- Validate dynamically in **DOSBox-X's debugger** (breakpoint at CS:0100, step,
  compare FPU registers + memory against the comments).
- Acceptance test for the Python port: capture frame N in DOSBox-X and the same
  frame from the port, compare **pixel by pixel**.

## STILL OPEN / UNVERIFIED
- Does Reko handle x87/FPU well on this file? UNKNOWN.
- Where exactly does Reko write output, and can it be redirected? UNKNOWN.
- Does `--env ms-dos` exist in 0.12.4? UNVERIFIED — check `reko --help`.
- Is the MSI self-contained w.r.t. .NET? UNVERIFIED.

## SUGGESTED NEXT STEP (needs Nir's OK)
1. Nir downloads + installs Reko 0.12.4 (MSI).
2. Copy TUBE.COM into `C:\DEMOS\_WORK\reko\`.
3. Run the `--loader raw --arch x86` command above; inspect the C output.
4. If good: this becomes the museum's "decompiled code" exhibit layer.