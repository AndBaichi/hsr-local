"""从 Windows 的 .ani 鼠标指针里抽出首帧，做成前端可用的 32×32 PNG（v2.16）

## 为什么不是直接把 .ani 放进 CSS

`cursor: url(...)` 只认静态图；Chromium 不解码 `.ani`（连 `.cur` 支持也随平台而定）。
所以这里把每个 `.ani` 的第一帧（48×48，32 位带 alpha）抽出来，按 32×32 缩放成 PNG，
并把帧头里的热点按同一比例缩放，交给 `src/lib/cursorTheme.ts` 写进 CSS。

## 用法

    python scripts/extract-cursor-theme.py <主题目录> <输出目录>

主题目录里应有 arrow/beam/busy/cross/link/move/nesw/no/ns/nwse/we/working 这 12 个
`.ani`（Silver Wolf 主题的命名）。输出目录通常是 `src/assets/cursors/`。

脚本只读取、不修改源目录；生成结果提交进仓库，构建时不需要原始主题包。
"""

from __future__ import annotations

import io
import os
import struct
import sys

from PIL import Image

# 源文件名 → 输出名（与 CSS 里的 cursor 语义一一对应）
ROLES = ["arrow", "beam", "busy", "cross", "link", "move", "nesw", "no", "ns", "nwse", "we", "working"]

TARGET_SIZE = 32


def ani_frames(path: str) -> list[bytes]:
    """解析 RIFF/ACON，返回每个 `fram` 里 `icon` 块的原始字节（即 CUR 文件）。"""
    data = open(path, "rb").read()
    if data[:4] != b"RIFF" or data[8:12] != b"ACON":
        raise ValueError(f"不是 ANI 文件: {path}")
    frames: list[bytes] = []
    offset = 12
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        body = offset + 8
        if chunk_id == b"LIST" and data[body : body + 4] == b"fram":
            sub = body + 4
            end = body + size
            while sub + 8 <= end:
                sub_id = data[sub : sub + 4]
                sub_size = struct.unpack_from("<I", data, sub + 4)[0]
                if sub_id == b"icon":
                    frames.append(data[sub + 8 : sub + 8 + sub_size])
                sub += 8 + sub_size + (sub_size % 2)
        offset = body + size + (size % 2)
    return frames


def cur_header(blob: bytes) -> tuple[int, int, int, int]:
    """读 CUR 头，返回 (宽, 高, hotspotX, hotspotY)。"""
    # ICONDIR: reserved(2) type(2) count(2)
    # ICONDIRENTRY: width(1) height(1) colors(1) reserved(1) hotX(2) hotY(2) size(4) offset(4)
    width, height, _colors, _reserved, hotspot_x, hotspot_y, _size, _offset = struct.unpack_from(
        "<BBBBHHII", blob, 6
    )
    return width or 256, height or 256, hotspot_x, hotspot_y


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("用法: python scripts/extract-cursor-theme.py <主题目录> <输出目录>")
    source_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    for role in ROLES:
        path = os.path.join(source_dir, f"{role}.ani")
        frames = ani_frames(path)
        if not frames:
            raise SystemExit(f"{path} 里没有帧")
        blob = frames[0]
        width, height, hotspot_x, hotspot_y = cur_header(blob)
        image = Image.open(io.BytesIO(blob)).convert("RGBA")
        scale = TARGET_SIZE / max(image.width, image.height)
        resized = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )
        resized.save(os.path.join(out_dir, f"{role}.png"), optimize=True)
        hotspot = (round(hotspot_x * scale), round(hotspot_y * scale))
        print(
            f"{role}: {width}x{height} frame0 → {resized.width}x{resized.height} "
            f"hotspot {hotspot} (from {hotspot_x},{hotspot_y})"
        )


if __name__ == "__main__":
    main()
