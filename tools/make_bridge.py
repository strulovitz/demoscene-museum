import pathlib
import shutil

PY_DIR = pathlib.Path(r"C:\Users\nir_s\AppData\Local\Programs\Python\Python312\Lib\site-packages\ida_pro_mcp")
PLUGIN = pathlib.Path(r"C:\Users\nir_s\AppData\Roaming\Hex-Rays\IDA Pro\plugins\mcp-plugin.py")
DST = pathlib.Path(r"C:\tools\rea\ida-bridge")

src = PY_DIR / "server.py"
plugin = PLUGIN
DST.mkdir(parents=True, exist_ok=True)

# The bridge regenerates code from the PLUGIN it parses, so copy the plugin
# that IDA actually runs into the bridge folder alongside the patched server.
shutil.copy2(plugin, DST / "mcp-plugin.py")
print("copied plugin ->", DST / "mcp-plugin.py")

text = src.read_text(encoding="utf-8")
anchor = 'exec(compile(code, GENERATED_PY, "exec"))'
assert text.count(anchor) == 1, "anchor not found exactly once - STOP, report back, do not improvise"

patch = (
    'code = code.replace("@mcp.tool()\\ndef disassemble_function(", '
    '"@mcp.tool(structured_output=False)\\ndef disassemble_function(")\n'
    'assert "structured_output=False" in code, "patch did not apply"\n'
)

(DST / "server.py").write_text(text.replace(anchor, patch + anchor), encoding="utf-8")
print("wrote patched server ->", DST / "server.py")
print("ok")