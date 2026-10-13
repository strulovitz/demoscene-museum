import asyncio
import json
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

PY = r"C:\Users\nir_s\AppData\Local\Programs\Python\Python312\python.exe"


async def main(server_py):
    p = StdioServerParameters(command=PY, args=[server_py, "--ida-rpc", "http://127.0.0.1:13337"])
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = {t.name: t for t in (await s.list_tools()).tools}
            print("tools found:", len(tools))
            t = tools.get("disassemble_function")
            if t is None:
                print("disassemble_function MISSING")
                return
            sch = t.outputSchema
            print("outputSchema:", None if sch is None else json.dumps(sch["properties"].get("return_type")))
            res = await s.call_tool("disassemble_function", {"start_address": "0x10100"})
            print("isError:", res.isError, "| blocks:", len(res.content), "| structured:", res.structuredContent is not None)
            print("text[0:400]:", res.content[0].text[:400] if res.content else "<none>")


asyncio.run(main(sys.argv[1]))