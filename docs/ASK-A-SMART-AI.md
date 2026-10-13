# TASK FOR A STRONG AI MODEL

I need a rigorous, evidence-based answer to one narrow technical question. I am not
looking for a guess or a plausible-sounding plan. Every claim you make must be
traceable to the versions, file paths and error strings quoted below. If something
is uncertain, say "unknown" and tell me how to test it.

**Do not tell me something works unless you can show me the command that proves it.**
I have been misled by an AI before and I will check your work.

================================================================================
## 1. THE QUESTION
================================================================================

**How do I get the IDA Pro 9 decompiler (Hex-Rays) working through the REA MCP
server on Windows, given that `ida-pro-mcp` 1.4.0's `server_generated.py` fails
output-schema validation?**

Specifically I want to know, in priority order:

1. Why does `ida_pro_mcp.server_generated.py` raise
   `Output validation error: None is not of type 'string'` when
   `disassemble_function` returns a payload that appears to satisfy its declared
   `DisassemblyFunction` TypedDict? (See §5 — I have already dumped the exact
   runtime payload and the exact TypedDict definition. Please reconcile them.)
2. Is this a known upstream bug in `ida-pro-mcp` 1.4.0, and is there a fixed
   release? If so, which version, and does it stay compatible with REA's
   `compatibility_profile: "legacy-1.4"` requirement?
3. What is the *safest, least invasive* fix? I am a Windows user and I do NOT want
   my Python installation silently corrupted. Please rank the options and state
   the risk of each:
   a. Upgrade / downgrade / pin `ida-pro-mcp`.
   b. Patch `server_generated.py` (and, if generated, the generator) in place.
   c. Write a separate MCP stdio shim/proxy server that bypasses the broken output
      validation and speaks JSON-RPC to IDA directly, then point REA at it.
   d. Point REA straight at IDA's own HTTP endpoint (no Python bridge at all).
   e. Something better that I have not thought of.
4. Separately: **Hex-Rays decompilation itself times out** on this specific target
   (>60s, no response) because the function is dense 8087 FPU code. Even if the
   output-schema bug is fixed, will decompilation succeed? If not, what is the
   correct way to get usable pseudocode for 16-bit DOS 256-byte intros? Note that
   Ghidra's C decompiler *also* fails on this target (see §6), so I need a plan
   that does not depend on either decompiler succeeding.

================================================================================
## 2. MY GOAL AND WHY (please optimise for this, not for elegance)
================================================================================

I am reverse-engineering old demoscene intros (256-byte DOS `.COM` files, later
4k/64k DOS `.EXE`, later Windows PE) so I can (a) document how each program works
and (b) write a faithful Python port that a museum website can show to visitors.

**Decompilation is the entire point.** A raw hex dump or an instruction listing
alone is NOT the deliverable. I need to understand the *algorithm* — the camera
maths, the plasma generator, the palette ramp — and express it in readable,
annotated Python. So "just read the assembly" is not an acceptable answer, and so
is "the decompiler does not support FPU, give up".

**Hard constraint from the user (me): never read the shipped `.asm` source file.**
The whole exercise is decompiling the shipped `.COM` binary. Reading `TUBE.ASM`
would be cheating. Any answer that reaches for the original source is wrong.

**Second constraint: use the real tools.** Do not propose hand-rolling a
disassembler or decoding constants with a Python script as a substitute for IDA /
Ghidra. (An earlier AI did exactly that and was rightly called out.)

================================================================================
## 3. EXACT SYSTEM SETUP — every item below was verified by me today
================================================================================

HOST
- Windows 11, build 10.0.26200.8246 (user `nir_s`)
- IMPORTANT AND DELIBERATE: the machine-level registry value
  `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path`
  **does not exist** (it was deleted, not truncated). Consequence: `C:\Windows\System32`
  is not on `%PATH%`, so bare `reg`/`where`/`findstr` do not resolve. The user has
  **refused** to repair this. DO NOT propose repairing PATH, installing anything
  machine-wide, or editing the registry. Always use absolute paths.

TOOL VERSIONS (all verified today)
- **IDA Professional 9.0** — `C:\Program Files\IDA Professional 9.0\`
  - `ida.exe` (GUI) and `idat.exe` (headless) both present. No license check done.
- **Ghidra 12.1.4 PUBLIC** — `C:\tools\ghidra_12.1.4_PUBLIC`
  - Java: Eclipse Temurin **21.0.12.1+1 LTS**
    (`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\java.exe`)
  - `JAVA_HOME` and `GHIDRA_INSTALL_DIR` are set in the MCP server env.
- **Python 3.12.10** (64-bit) — `C:\Users\nir_s\AppData\Local\Programs\Python\Python312\python.exe`
  - `mcp` (MCP SDK) **1.30.0**, `mcp_types` **2.3.0**
  - `ida_pro_mcp` **1.4.0** (`ida_pro_mcp-1.4.0.dist-info`)
    installed at
    `...\Python312\Lib\site-packages\ida_pro_mcp\`
    containing: `__init__.py`, `__main__.py`, `idalib_server.py`,
    `mcp-plugin.py`, `server.py`, `server_generated.py`
  - NOTE: `serverInfo` from this bridge reports `{"name":"ida-pro-mcp","version":"1.30.0"}`.
    That "1.30.0" is the **MCP SDK version leaking through FastMCP**, NOT the
    ida-pro-mcp version. The real package version is **1.4.0**. Please be careful.
- **Node v26.7.0** — `C:\Program Files\nodejs\node.exe`
- **REA (`rea-agents` npm package) 6.4.0**
  - `C:\Users\nir_s\AppData\Roaming\npm\node_modules\rea-agents\`
  - `rea doctor` reports `skill: installed_version "37", state: stale`
- opencode 1.19.0, launched from a plain Windows Command Prompt.

IDA MCP PLUGIN
- Installed at
  `C:\Users\nir_s\AppData\Roaming\Hex-Rays\IDA Pro\plugins\mcp-plugin.py`
  (74,573 bytes)
- It serves **JSON-RPC 2.0 over HTTP POST to `/mcp`** on `127.0.0.1:13337`.
  A `GET /` returns `HTTP 501 Unsupported method` — that is expected, not a fault.
- Registered methods include: `get_metadata`, `list_functions`,
  `get_function_by_name`, `get_function_by_address`, `decompile_function`,
  `disassemble_function`, `get_callers`, `get_callees`, `get_xrefs_to`,
  `list_strings`, `list_imports`, `patch_address_assembles`,
  `read_memory_bytes`, `set_comment`, `rename_function`, etc.

REA REGISTRATION FILE (`C:\tools\rea\ida-mcp.json`), verbatim:
```json
{
  "command": "C:\\Users\\ir_s\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
  "args": [
    "C:\\Users\\ir_s\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\ida_pro_mcp\\server.py",
    "--ida-rpc",
    "http://127.0.0.1:13337"
  ]
}
```
Passed to the REA MCP server as env var `REA_IDA_MCP_CONFIG`.

HOW REA TALKS TO IDA (read from REA's own source, not guessed)
- REA package files that matter:
  - `dist\ida\IdaSessionClient.js` — defines the REQUIRED tool set.
  - `dist\ida\IdaOperationRunner.js` — the actual call sequence.
  - `dist\ida\IdaProtocolValues.js` — the zod schemas REA validates against.
  - `dist\ida\IdaMcpConnection.js` — transport + `decodeIdaToolResult()`.
  - `dist\ida\IdaConfiguration.js` — registration schema.
- REA supports **two** profiles, chosen by `mode` in the registration:
  - `mode: "attached"`  → requires these 10 tools (`legacyTools`):
    `get_metadata`, `list_functions`, `list_strings`, `get_function_by_name`,
    `get_function_by_address`, `decompile_function`, `disassemble_function`,
    `get_callers`, `get_callees`, `get_xrefs_to`
  - `mode: "headless"` → requires `idb_open`, `idb_list`, `idb_close`,
    `server_health`, `list_funcs`, `lookup_funcs`, `find_regex`, `decompile`,
    `disasm`, `callees`, `xrefs_to`
- We are running `mode: "attached"`, and REA reports
  `compatibility_profile: "legacy-1.4"` — so REA 6.4.0 expects ida-pro-mcp 1.4.x.
  **Version pairing looks correct; this is not a version-mismatch problem.**
- `IdaConfiguration.js` also accepts `type: "http"` with a `url` pointing at a
  loopback http/https endpoint — i.e. REA can theoretically bypass the Python
  bridge entirely. Is that viable with IDA's plugin? (IDA's plugin speaks raw
  JSON-RPC, not the MCP `tools/list` / `tools/call` methods, so I suspect not —
  please confirm.)
- `timeoutMs` default is 300000 (5 minutes). So my 60s HTTP timeout was MY probe's
  limit, not REA's. Keep this in mind when judging §6.

HOW REA DECODES A TOOL RESULT (`IdaMcpConnection.js`, `decodeIdaToolResult`):
- if `result.isError === true` → throws "IDA MCP tool failed: <text>"
- else if `result.structuredContent !== undefined` → uses that
- else requires exactly ONE text block and tries `JSON.parse` on it.
So a valid single text block containing JSON is acceptable to REA. This is
important for option (c) in §1: my shim does NOT have to produce
`structuredContent`, a single JSON text block is enough.

================================================================================
## 4. THE TARGET
================================================================================

- File: `C:\DEMOS\dos256b\tube\TUBE.COM`
- 256 bytes, DOS `.COM`
- sha256 `4dcc125e28fcc24947209f5e0ff851b8455c8fa96fec01106516307831e05ed0`
- Attribution: 256-byte intro by *baze* / 3SC, Syndeecate 2001. Confirmed by the
  author to actually run in DOSBox.
- **IDA loads it at base `0x10000`**, so:
  - entry / single function: address **`0x10100`**, name `start`, size `0xfb`
  - 119 instructions reported by IDA's `disassemble_function`
  - Ghidra (headless, `x86:LE:16:Real Mode`) reports 251 instructions covering
    the same 0xfb bytes
  - `get_metadata` reports `base "0x0"`, `size "0x100"`, `filesize "0x100"`,
    `md5 8d65b45f090dc07e88c9a275a76de9c4`, `crc32 0xd317264a`
- NOTE the address trap: IDA wants `0x10100`, **not** `0x100` and **not** `0x0`.
- The function is dense 16-bit real-mode code that uses the **8087 FPU**
  heavily (`FADD`, `FILD`, `FIMUL`, `FSINCOS`, `FPATAN`, `FSQRT`).
- Data verified from the raw bytes (for context only): a float32
  `0.02380378730595112` and a word `41` at file offset `0xF8`, a word `160` at
  `0xD2`, and the ASCII string `baze` at `0xFC`.

================================================================================
## 5. THE EXACT BUG — reproduce this from the facts I give you
================================================================================

**Command that fails** (driving `ida_pro_mcp\server.py` over stdio MCP, calling
the `disassemble_function` tool with `{"start_address": "0x10100"}`):

```json
{"jsonrpc":"2.0","id":9,"result":{
  "content":[{"type":"text","text":"Output validation error: None is not of type 'string'"}],
  "isError":true}}
```

**The very same request straight to IDA's JSON-RPC endpoint succeeds.** Verified:
POST `http://127.0.0.1:13337/mcp` with
`{"jsonrpc":"2.0","id":1,"method":"disassemble_function","params":["0x10100"]}`
returns a good payload, byte-for-byte:

```
top-level keys : ['name', 'start_ea', 'stack_frame', 'lines']
name           : 'start'
start_ea       : '0x10100'
stack_frame    : [{'name': '__return_address', 'offset': '0x0', 'size': '0x2', 'type': '_UNKNOWN *'}]
len(lines)     : 119
lines[0]       : {'address': '0x10100', 'instruction': 'mov al, 13h', 'segment': 'seg000'}
```

**The declared return type** in
`site-packages\ida_pro_mcp\server_generated.py`, lines 52–75 verbatim:

```python
class DisassemblyLine(TypedDict):
    segment: NotRequired[str]
    address: str
    label: NotRequired[str]
    instruction: str
    comments: NotRequired[list[str]]

class Argument(TypedDict):
    name: str
    type: str

class StackFrameVariable(TypedDict):
    name: str
    offset: str
    size: str
    type: str

class DisassemblyFunction(TypedDict):
    name: str
    start_ea: str
    return_type: NotRequired[str]
    arguments: NotRequired[list[Argument]]
    stack_frame: list[StackFrameVariable]
    lines: list[DisassemblyLine]
```

**The tool wrapper**, `server_generated.py` lines 176–179 verbatim:

```python
@mcp.tool()
def disassemble_function(start_address: Annotated[str, Field(description='Address of the function to disassemble')]) -> DisassemblyFunction:
    """Get assembly code for a function (API-compatible with older IDA builds)"""
    return make_jsonrpc_request('disassemble_function', start_address)
```

**The bridge's JSON-RPC client**, `server.py` lines 20–57, verbatim:

```python
def make_jsonrpc_request(method: str, *params):
    """Make a JSON-RPC request to the IDA plugin"""
    global jsonrpc_request_id, ida_host, ida_port
    conn = http.client.HTTPConnection(ida_host, ida_port)
    request = {"jsonrpc": "2.0", "method": method, "params": list(params), "id": jsonrpc_request_id}
    jsonrpc_request_id += 1
    try:
        conn.request("POST", "/mcp", json.dumps(request), {"Content-Type": "application/json"})
        response = conn.getresponse()
        data = json.loads(response.read().decode())
        if "error" in data:
            ...raise Exception(pretty)
        result = data["result"]
        if result is None:
            result = "success"
        return result
    ...
```

**My question about this specific evidence:** the payload satisfies every field
in `DisassemblyFunction` as far as I can tell, yet pydantic reports
`None is not of type 'string'`. My hypotheses, none of them verified:
 (a) FastMCP is validating against a *generated JSON Schema* in which
     `return_type`/`arguments` were NOT emitted as optional, so the absent keys
     become `None` and fail the `str` type;
 (b) `server_generated.py` is code-generated from the plugin file, so editing it
     by hand will be silently overwritten — is there a generator script, and is
     the real fix upstream in the generator or the plugin?
 (c) something about `TypedDict` + FastMCP output-schema construction in
     `mcp` 1.30.0 specifically.

Please tell me which, and how to confirm it on this machine with a command.

**Also note:** `decompile_function` is declared `-> str` (line 172) and REA parses
it with `z.string().nullable()`. So that one may fail for the mirror-image reason.

================================================================================
## 6. WHAT ALREADY WORKS — do not ask me to re-verify these
================================================================================

REA → IDA, `mode: attached`, verified working today:
- `open_binary` (format `dos-com`) → sha256 matches
- `search_procedures(pattern="start")` → `[{"address":"0x10100","value":"start"}]`
- `procedure_address("0x10100")` → `"0x10100"`
  (internally calls `get_function_by_address` then `get_function_by_name`; both
  return `{"address":"0x10100","name":"start","size":"0xfb"}`)
- `search_strings(pattern="baze")` → `[]` (valid: IDA defines no string objects
  in a raw `.COM`; an empty result is not proof of absence)
- `binary_session` metadata before/after checks pass, sha256 always matches

REA → IDA, verified FAILING today:
- `procedure_assembly("0x10100")` → `unreadable_output` / `execution_failure`
- `procedure_pseudo_code("0x10100")` → `unreadable_output` / `execution_failure`
  (also fails at `0x100` and at `0x0`)
- REA's own error text: "Analysis returned an unreadable result. Retry once; if it
  continues, run `rea doctor`." — `rea doctor` reports **nothing** about IDA.

OTHER PROVIDERS (already ruled out, do not revisit)
- REA → Ghidra on Windows refuses non-PE targets:
  `"Windows Ghidra P0 accepts PE targets only"` — so REA cannot use Ghidra for
  DOS `.COM` on this host at all.
- Hopper: `unsupported_host` on win32.
- JEB: not running (`fetch failed` on 127.0.0.1:8425).

Ghidra headless CLI **does** work and produced a complete disassembly
(`C:\Users\nir_s\tube\listing.txt`), but its **C decompiler fails**:
`Offset must be between 0x0 and 0x10ffef, got 0xffffffff instead!` — the same
8087 FPU problem. Working invocation and three hard-won traps (the language id is
`x86:LE:16:Real Mode`, a `.COM` analyses from offset **0**, and the function body
must be carved explicitly or the disassembler runs into trailing data and dies):

```
"C:\tools\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat" ^
  "C:\Users\nir_s\tube\ghidra" tubeX ^
  -import "C:\DEMOS\dos256b\tube\TUBE.COM" ^
  -loader BinaryLoader ^
  -processor "x86:LE:16:Real Mode" ^
  -scriptPath "C:\Users\nir_s\tube\ghidra" ^
  -preScript  SetEntry.java 0 ^
  -postScript DecompileAll.java "C:\Users\nir_s\tube\decompiled.c" 0 F4
```

IDA GUI operating notes (I verified these the hard way):
- **Edit ▸ Plugins is GREYED OUT until a file is loaded.** With no database open
  there is no plugin menu, which is why the MCP plugin was silently not running
  for several days and made REA look broken.
- Correct sequence: File ▸ Open → pick the `.COM` → accept the MS-DOS loader →
  Edit ▸ Plugins ▸ *ida-pro-mcp*. Then `127.0.0.1:13337` appears as LISTENING.

Direct JSON-RPC to IDA currently works for:
`get_metadata`, `get_entry_points`, `disassemble_function`, `get_function_by_address`,
`get_function_by_name`, `list_functions`, `list_strings`, `get_callees`, `get_xrefs_to`,
and (slowly) `decompile_function`.
Confirmed NOT present as method names: `decompile`, `disassemble`, `xrefs_to`,
`lookup_funcs` — those are the *modern* headless profile's names, not this plugin's.

================================================================================
## 7. WHAT I NEED BACK FROM YOU
================================================================================

A. The root cause of `Output validation error: None is not of type 'string'`,
   with the exact file+line and the reasoning that uses the payload in §5.
B. Whether upstream `ida-pro-mcp` has a fix, and whether any fixed version still
   satisfies REA 6.4.0's `legacy-1.4` profile. If the newest release breaks the
   legacy profile, say so plainly.
C. A ranked set of fixes with, for each: what changes on disk, whether it needs an
   opencode/REA restart, whether it is reversible, and what could break.
   Remember I must not modify the machine PATH, the registry, or anything outside
   project folders without explicit permission, and `pip install -U` is NOT
   automatically acceptable.
D. A concrete, copy-pasteable plan for making **Hex-Rays pseudocode actually
   return** for 8087-heavy 16-bit real-mode code, given that Ghidra's decompiler
   also fails. Options I want considered: IDA headless `idat.exe` with a Hex-Rays
   batch script, `idalib` (I notice `site-packages\ida_pro_mcp\idalib_server.py`
   exists — what is it for?), raising/changing decompiler timeout settings,
   `ida_hexrays` API options such as disabling FPU-aware analysis, and using
   IDA's *analysis* plus a separate pseudocode path.
E. If the honest answer is "no decompiler will handle this target; here is the
   best-practice manual decompilation workflow instead", then say exactly that —
   but tell me what tooling (IDA pseudocode window, Lumina, a different
   decompiler such as RetDec/r2, or hand-annotation) you would use to make manual
   decompilation rigorous and repeatable, given my constraints in §2.

**Absolute requirement:** label anything you have not personally verified as
"UNVERIFIED". I would much rather read "I believe X, test it with command Y" than
a confident paragraph built on a guess. A previous assistant cost me a day by
stating unverified figures as fact.