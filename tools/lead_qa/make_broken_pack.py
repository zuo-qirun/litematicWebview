"""构造一个「含坏 JSON」的材质包，验证 pack.py 只跳过坏文件、其余照常烘焙。"""
import zipfile
from pathlib import Path

SRC = Path("tests/_data_pack/red-stone.zip")
DST = Path("tests/_pack_qa/broken-json.zip")
DST.parent.mkdir(parents=True, exist_ok=True)
TARGET = "assets/minecraft/models/block/stone_custom.json"

with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename == TARGET:
            data = b'{"parent": "block/cube_all"}\n}\n'  # 故意多一个右括号
        zout.writestr(info, data)
print("写出", DST, DST.stat().st_size, "字节（坏文件：%s）" % TARGET)
