"""一次性分析脚本（临时）：用 pypinyin 为「首字母索引」生成汉字→拼音首字母表。

产物：/tmp/hsr-index/zh-initials.json（{ 字母: "字字字..." }）
      /tmp/hsr-index/zh-polyphone.json（首字多音清单，供人工裁决）

不属于构建链，验证完即可移入 `_attic/`。
"""

import json
from pypinyin import lazy_pinyin, pinyin, Style

SRC = "/tmp/hsr-index/zh.json"

with open(SRC, encoding="utf-8") as fp:
    chars = json.load(fp)

table = {}
poly = {}
skipped = []

for ch in chars:
    if not ("\u4e00" <= ch <= "\u9fff"):
        skipped.append(ch)
        continue
    letters = lazy_pinyin(ch, style=Style.FIRST_LETTER, errors="ignore")
    if not letters or not letters[0]:
        skipped.append(ch)
        continue
    letter = letters[0].lower()
    if not ("a" <= letter <= "z"):
        skipped.append(ch)
        continue
    table.setdefault(letter, []).append(ch)
    # 多音字：一次给出多个读音的，记下来人工判断（首字读音直接影响分组）
    readings = pinyin(ch, style=Style.FIRST_LETTER, heteronym=True, errors="ignore")
    if readings and len(set(readings[0])) > 1:
        poly[ch] = sorted(set(r.lower() for r in readings[0]))

out = {letter: "".join(sorted(set(chars_list))) for letter, chars_list in sorted(table.items())}
with open("/tmp/hsr-index/zh-initials.json", "w", encoding="utf-8") as fp:
    json.dump(out, fp, ensure_ascii=False, indent=1)
with open("/tmp/hsr-index/zh-polyphone.json", "w", encoding="utf-8") as fp:
    json.dump(poly, fp, ensure_ascii=False, indent=1)

total = sum(len(v) for v in out.values())
print("覆盖汉字:", total, "| 字母组:", len(out), "| 跳过:", "".join(skipped))
print("各组字数:", {k: len(v) for k, v in out.items()})
print("多音首字:", json.dumps(poly, ensure_ascii=False))
