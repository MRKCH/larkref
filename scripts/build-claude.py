"""Build the installable Claude Desktop MCP bundle from the shared server."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
source = root / "plugins" / "larkref"
dest = root / "dist" / "larkref.mcpb"
files = ("manifest.json", "server.mjs", "claude-picker.mjs", "code-picker.mjs",
         "project-index.mjs", "index-files.mjs", "index-storage.mjs", "context.mjs",
         "base.mjs", "cli.mjs", "assets/feishu.png")

dest.parent.mkdir(exist_ok=True)
with TemporaryDirectory(dir=dest.parent) as scratch:
    staged = Path(scratch) / dest.name
    with ZipFile(staged, "w", ZIP_DEFLATED) as bundle:
        for name in files:
            bundle.write(source / name, name)
    staged.replace(dest)
print(dest)
