#!/usr/bin/env python3
"""从 contract.yaml 生成三端协议产物。

    python3 tools/gen.py          # 生成
    python3 tools/gen.py --check  # 只校验产物是否与契约一致，CI 用

产物：
    generated/nascent_protocol.h   固件（Arduino C++）
    generated/protocol.dart        对照用 Dart（不再投放到控制端）
    generated/protocol.js          浏览器控制端
    generated/protocol.py          FastAPI 后端（pydantic v2）
    schemas/*.json                 JSON Schema 2020-12

不依赖第三方库。装了 PyYAML 就用 PyYAML，没装则用内置的受限子集解析器。
所有读写强制 UTF-8，否则中文注释在 Windows 中文环境下会解码失败。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
CONTRACT = ROOT / "contract.yaml"
GENERATED = ROOT / "generated"
SCHEMAS = ROOT / "schemas"

BANNER = "本文件由 protocol/tools/gen.py 从 contract.yaml 生成，请勿手改。"

CTYPE_SIZE = {
    "uint8_t": 1,
    "int8_t": 1,
    "uint16_t": 2,
    "int16_t": 2,
    "uint32_t": 4,
    "int32_t": 4,
}


# ---------------------------------------------------------------------------
# 受限 YAML 子集解析
# ---------------------------------------------------------------------------
def _strip_comment(line: str) -> str:
    out, in_quote = [], False
    for i, ch in enumerate(line):
        if ch == '"':
            in_quote = not in_quote
        if ch == "#" and not in_quote and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(tok: str):
    tok = tok.strip()
    if not tok:
        return None
    if tok[0] == '"' and tok[-1] == '"' and len(tok) >= 2:
        return tok[1:-1]
    low = tok.lower()
    if low in ("null", "~"):
        return None
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(tok)
    except ValueError:
        pass
    try:
        return float(tok)
    except ValueError:
        pass
    return tok


def _split_top(text: str) -> list[str]:
    """按顶层逗号切分，忽略 [] {} 与引号内部的逗号。"""
    parts, buf, depth, in_quote = [], [], 0, False
    for ch in text:
        if ch == '"':
            in_quote = not in_quote
        if not in_quote:
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
            elif ch == "," and depth == 0:
                parts.append("".join(buf))
                buf = []
                continue
        buf.append(ch)
    if "".join(buf).strip():
        parts.append("".join(buf))
    return parts


def _flow(text: str):
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return [_flow(p) for p in _split_top(text[1:-1])]
    if text.startswith("{") and text.endswith("}"):
        out = {}
        for part in _split_top(text[1:-1]):
            if ":" not in part:
                continue
            k, v = part.split(":", 1)
            out[k.strip()] = _flow(v)
        return out
    return _scalar(text)


def _mini_yaml(text: str):
    """把 "- " 后的内容视为缩进 +2 的普通行，列表项因此与其兄弟键自然对齐。

    每行记为 (内容缩进, 内容, 横杠缩进 或 None)。
    """
    rows: list[tuple[int, str, int | None]] = []
    for raw in text.splitlines():
        body = _strip_comment(raw)
        if not body.strip():
            continue
        indent = len(body) - len(body.lstrip(" "))
        content = body.strip()
        if content == "-":
            rows.append((indent + 2, "", indent))
        elif content.startswith("- "):
            rows.append((indent + 2, content[2:].strip(), indent))
        else:
            rows.append((indent, content, None))

    def parse(idx: int, indent: int):
        if rows[idx][2] is not None:
            dash = rows[idx][2]
            items = []
            while idx < len(rows) and rows[idx][0] == indent and rows[idx][2] == dash:
                start = idx
                idx += 1
                while idx < len(rows) and (
                    rows[idx][0] > indent or (rows[idx][0] == indent and rows[idx][2] is None)
                ):
                    idx += 1
                chunk = rows[start:idx]
                head = chunk[0][1]
                if head.startswith("{") or head.startswith("["):
                    items.append(_flow(head))
                elif len(chunk) == 1 and ":" not in head:
                    items.append(_scalar(head))
                else:
                    saved = rows[start]
                    rows[start] = (saved[0], saved[1], None)
                    items.append(parse(start, indent)[0])
                    rows[start] = saved
            return items, idx

        node = {}
        while idx < len(rows) and rows[idx][0] == indent and rows[idx][2] is None:
            line = rows[idx][1]
            if ":" not in line:
                raise ValueError(f"无法解析的行: {line}")
            key, rest = line.split(":", 1)
            key, rest = key.strip(), rest.strip()
            idx += 1
            if rest:
                node[key] = _flow(rest)
            elif idx < len(rows) and rows[idx][0] > indent:
                node[key], idx = parse(idx, rows[idx][0])
            else:
                node[key] = None
        return node, idx

    return parse(0, rows[0][0])[0]


def load_contract() -> dict:
    text = CONTRACT.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except ImportError:
        return _mini_yaml(text)


# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------
def pascal(name: str) -> str:
    return "".join(p.capitalize() for p in name.split("_"))


def camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(p.capitalize() for p in tail)


def parse_type(spec: str):
    """把 contract 里的类型串拆成 (kind, arg)。"""
    if spec.startswith("enum:"):
        return "enum", spec[5:]
    if spec.startswith("obj:"):
        return "obj", spec[4:]
    if spec.startswith("list:obj:"):
        return "list_obj", spec[9:]
    if spec.startswith("list:"):
        return "list", spec[5:]
    return spec, None


def frame_size(header_fields, fields) -> int:
    return sum(CTYPE_SIZE[f["ctype"]] for f in list(header_fields) + list(fields))


# ---------------------------------------------------------------------------
# C 头文件
# ---------------------------------------------------------------------------
def gen_c(c: dict) -> str:
    L = [
        "// " + BANNER,
        f"// contract version: {c['version']}",
        "",
        "#pragma once",
        "",
        "#include <stdint.h>",
        "#include <stddef.h>",
        "",
        f'#define NL_PROTO_VERSION "{c["version"]}"',
        "",
        "// ---- 常量 ----",
    ]
    for k, v in c["constants"].items():
        L.append(f"#define NL_{k} ({v})")

    if c.get("ble"):
        L += ["", "// ---- BLE GATT 标识 ----"]
        for k, v in c["ble"].items():
            lit = f'"{v}"' if isinstance(v, str) else f"({v})"
            L.append(f"#define NL_BLE_{k.upper()} {lit}")

    if c.get("wifi"):
        L += ["", "// ---- WiFi 备用通道 ----"]
        for k, v in c["wifi"].items():
            lit = f'"{v}"' if isinstance(v, str) else f"({v})"
            L.append(f"#define NL_WIFI_{k.upper()} {lit}")

    L += ["", "// ---- 枚举（序号即线序，0 号为最安全取值）----"]
    for ename, values in c["enums"].items():
        L.append(f"typedef enum {{")
        for i, v in enumerate(values):
            L.append(f"    NL_{ename.upper()}_{v.upper()} = {i},")
        L.append(f"    NL_{ename.upper()}_COUNT = {len(values)}")
        L.append(f"}} nl_{ename}_t;")
        L.append("")
        L.append(f"static const char *const NL_{ename.upper()}_NAMES[] = {{")
        L.append("    " + ", ".join(f'"{v}"' for v in values))
        L.append("};")
        L.append("")
        L.append(f"static inline const char *nl_{ename}_name(uint8_t v) {{")
        L.append(f"    return v < NL_{ename.upper()}_COUNT ? NL_{ename.upper()}_NAMES[v] : \"?\";")
        L.append("}")
        L.append("")

    L += [
        "// ---- 档位表 ----",
        "typedef struct {",
        "    uint8_t level;",
        "    uint8_t duty_pct;",
        "    uint8_t pattern;",
        "    uint8_t lit;",
        "    uint8_t r, g, b;",
        "} nl_level_row_t;",
        "",
        "static const nl_level_row_t NL_LEVEL_TABLE[] = {",
    ]
    for row in c["levels"]:
        L.append(
            f"    {{{row['level']}, {row['duty_pct']}, NL_PATTERN_{row['pattern'].upper()}, "
            f"{row['lit']}, {row['r']}, {row['g']}, {row['b']}}}, // {row['semantic']}"
        )
    L += [
        "};",
        "",
        "static inline const nl_level_row_t *nl_level_row(uint8_t level) {",
        "    if (level < NL_LEVEL_MIN || level > NL_LEVEL_MAX) return 0;",
        "    return &NL_LEVEL_TABLE[level - NL_LEVEL_MIN];",
        "}",
        "",
        "// ---- LED 模式层与覆盖层 ----",
        "typedef struct {",
        "    uint8_t key;",
        "    uint8_t r, g, b;",
        "    uint8_t priority;",
        "    const char *anim;",
        "} nl_led_row_t;",
        "",
        "static const nl_led_row_t NL_LED_MODE_TABLE[] = {",
    ]
    for row in c["led_modes"]:
        L.append(
            f"    {{NL_MODE_{row['mode'].upper()}, {row['r']}, {row['g']}, {row['b']}, 0, "
            f'"{row["anim"]}"}}, // {row["label"]}'
        )
    L += ["};", "", "static const nl_led_row_t NL_LED_OVERRIDE_TABLE[] = {"]
    for row in c["led_overrides"]:
        L.append(
            f"    {{NL_LED_STATE_{row['state'].upper()}, {row['r']}, {row['g']}, {row['b']}, "
            f'{row["priority"]}, "{row["anim"]}"}}, // {row["label"]}'
        )
    L += ["};", ""]

    hdr = c["wire_header"]["fields"]
    L += ["// ---- 固件内部帧（packed，定长）----", "#pragma pack(push, 1)", "", "typedef struct {"]
    for f in hdr:
        L.append(f"    {f['ctype']} {f['name']};")
    L += ["} nl_wire_header_t;", ""]

    for frame in c["wire_frames"]:
        L.append(f"// {frame['doc']}")
        L.append("typedef struct {")
        L.append("    nl_wire_header_t hdr;")
        for f in frame["fields"]:
            doc = f"  // {f['doc']}" if f.get("doc") else ""
            L.append(f"    {f['ctype']} {f['name']};{doc}")
        L.append(f"}} nl_{frame['name']}_t;")
        L.append("")

    L += ["#pragma pack(pop)", ""]

    hdr_size = sum(CTYPE_SIZE[f["ctype"]] for f in hdr)
    L += ["#ifdef __cplusplus", f'static_assert(sizeof(nl_wire_header_t) == {hdr_size}, "wire header packing");']
    for frame in c["wire_frames"]:
        size = frame_size(hdr, frame["fields"])
        L.append(f'static_assert(sizeof(nl_{frame["name"]}_t) == {size}, "{frame["name"]} packing");')
    L += ["#endif", ""]

    L += [
        "// ---- 帧头填充与校验 ----",
        "static inline void nl_wire_header_init(nl_wire_header_t *h, uint8_t type, uint16_t seq) {",
        "    h->magic = NL_PROTO_MAGIC;",
        "    h->version_major = NL_VERSION_MAJOR;",
        "    h->version_minor = NL_VERSION_MINOR;",
        "    h->frame_type = type;",
        "    h->seq = seq;",
        "    h->reserved = 0;",
        "}",
        "",
        "static inline int nl_wire_header_valid(const nl_wire_header_t *h) {",
        "    return h->magic == NL_PROTO_MAGIC && h->version_major == NL_VERSION_MAJOR;",
        "}",
        "",
        "// 强度封顶：任何路径设档都必须过这一关。",
        "static inline uint8_t nl_clamp_level(int level) {",
        "    if (level < NL_LEVEL_MIN) return NL_LEVEL_MIN;",
        "    if (level > NL_LEVEL_MAX) return NL_LEVEL_MAX;",
        "    return (uint8_t)level;",
        "}",
        "",
    ]
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------
# Dart
# ---------------------------------------------------------------------------
DART_TYPE = {"int": "int", "float": "double", "str": "String", "bool": "bool"}


def dart_enum(name: str) -> str:
    """Dart 枚举一律加 Nl 前缀：contract 里的 pattern 会撞 dart:core 的 Pattern。"""
    return "Nl" + pascal(name)


def dart_type(spec: str, nullable: bool) -> str:
    kind, arg = parse_type(spec)
    if kind in DART_TYPE:
        base = DART_TYPE[kind]
    elif kind == "enum":
        base = dart_enum(arg)
    elif kind == "obj":
        base = arg
    elif kind == "list":
        base = f"List<{DART_TYPE[arg]}>"
    elif kind == "list_obj":
        base = f"List<{arg}>"
    else:
        raise ValueError(spec)
    return base + ("?" if nullable else "")


def dart_from_json(spec: str, expr: str, nullable: bool) -> str:
    kind, arg = parse_type(spec)
    if kind == "int":
        core = f"({expr} as num).toInt()"
    elif kind == "float":
        core = f"({expr} as num).toDouble()"
    elif kind in ("str", "bool"):
        core = f"{expr} as {DART_TYPE[kind]}"
    elif kind == "enum":
        core = f"{dart_enum(arg)}.fromWireName({expr} as String)"
    elif kind == "obj":
        core = f"{arg}.fromJson({expr} as Map<String, dynamic>)"
    elif kind == "list":
        cast = "toInt()" if arg == "int" else "toDouble()"
        core = (
            f"({expr} as List).map((e) => (e as num).{cast}).toList()"
            if arg in ("int", "float")
            else f"({expr} as List).map((e) => e as String).toList()"
        )
    elif kind == "list_obj":
        core = f"({expr} as List).map((e) => {arg}.fromJson(e as Map<String, dynamic>)).toList()"
    else:
        raise ValueError(spec)
    return f"{expr} == null ? null : {core}" if nullable else core


def dart_to_json(spec: str, expr: str, nullable: bool) -> str:
    kind, arg = parse_type(spec)
    q = "?." if nullable else "."
    if kind in ("int", "float", "str", "bool", "list"):
        return expr
    if kind == "enum":
        return f"{expr}{q}wireName"
    if kind == "obj":
        return f"{expr}{q}toJson()"
    if kind == "list_obj":
        return f"{expr}{q}map((e) => e.toJson()).toList()"
    raise ValueError(spec)


def gen_dart(c: dict) -> str:
    L = ["// " + BANNER, f"// contract version: {c['version']}", "", "class NlConst {", "  NlConst._();", f"  static const String protoVersion = '{c['version']}';"]
    for k, v in c["constants"].items():
        L.append(f"  static const int {camel(k.lower())} = {v};")
    L += ["}", ""]

    for section, cls_name in (("ble", "NlBle"), ("wifi", "NlWifi")):
        if not c.get(section):
            continue
        L += [f"class {cls_name} {{", f"  {cls_name}._();"]
        for k, v in c[section].items():
            if isinstance(v, str):
                L.append(f"  static const String {camel(k)} = '{v}';")
            else:
                L.append(f"  static const int {camel(k)} = {v};")
        L += ["}", ""]

    for ename, values in c["enums"].items():
        cls = dart_enum(ename)
        L.append(f"enum {cls} {{")
        L.append("  " + ", ".join(camel(v) for v in values) + ";")
        L += [
            "",
            f"  static const List<String> _wire = [{', '.join(repr(v) for v in values)}];",
            "  String get wireName => _wire[index];",
            f"  static {cls} fromWire(int i) => (i >= 0 && i < _wire.length) ? {cls}.values[i] : {cls}.values.first;",
            f"  static {cls} fromWireName(String? n) {{",
            "    final i = _wire.indexOf(n ?? '');",
            f"    return i < 0 ? {cls}.values.first : {cls}.values[i];",
            "  }",
            "}",
            "",
        ]

    L += [
        "class NlLevelRow {",
        "  final int level, dutyPct, lit, r, g, b;",
        "  final NlPattern pattern;",
        "  final String semantic;",
        "  const NlLevelRow(this.level, this.dutyPct, this.pattern, this.lit, this.r, this.g, this.b, this.semantic);",
        "}",
        "",
        "const List<NlLevelRow> kLevelTable = [",
    ]
    for row in c["levels"]:
        L.append(
            f"  NlLevelRow({row['level']}, {row['duty_pct']}, NlPattern.{camel(row['pattern'])}, "
            f"{row['lit']}, {row['r']}, {row['g']}, {row['b']}, '{row['semantic']}'),"
        )
    L += ["];", ""]

    for obj in list(c["json_objects"]) + list(c["json_messages"]):
        name = obj["name"]
        fields = obj["fields"]
        if obj.get("direction"):
            L.append(f"/// {obj['direction']}")
        L.append(f"class {name} {{")
        for f in fields:
            if f.get("doc"):
                L.append(f"  /// {f['doc']}")
            L.append(f"  final {dart_type(f['type'], f.get('nullable', False))} {camel(f['name'])};")
        L.append(f"  const {name}({{")
        for f in fields:
            req = "" if f.get("nullable", False) else "required "
            L.append(f"    {req}this.{camel(f['name'])},")
        L.append("  });")
        L.append("")
        L.append(f"  factory {name}.fromJson(Map<String, dynamic> j) => {name}(")
        for f in fields:
            L.append(
                f"    {camel(f['name'])}: {dart_from_json(f['type'], f'''j['{f['name']}']''', f.get('nullable', False))},"
            )
        L.append("  );")
        L.append("")
        L.append("  Map<String, dynamic> toJson() => {")
        for f in fields:
            L.append(
                f"    '{f['name']}': {dart_to_json(f['type'], camel(f['name']), f.get('nullable', False))},"
            )
        L.append("  };")
        L.append("}")
        L.append("")

    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------
# Python (pydantic v2)
# ---------------------------------------------------------------------------
PY_TYPE = {"int": "int", "float": "float", "str": "str", "bool": "bool"}


def py_type(spec: str, nullable: bool) -> str:
    kind, arg = parse_type(spec)
    if kind in PY_TYPE:
        base = PY_TYPE[kind]
    elif kind == "enum":
        base = pascal(arg)
    elif kind == "obj":
        base = arg
    elif kind == "list":
        base = f"list[{PY_TYPE[arg]}]"
    elif kind == "list_obj":
        base = f"list[{arg}]"
    else:
        raise ValueError(spec)
    return f"{base} | None" if nullable else base


def gen_py(c: dict) -> str:
    L = [
        '"""' + BANNER,
        "",
        f"contract version: {c['version']}",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "from enum import Enum",
        "",
        "from pydantic import BaseModel",
        "",
        f'PROTO_VERSION = "{c["version"]}"',
        "",
        "",
        "class NlConst:",
    ]
    for k, v in c["constants"].items():
        L.append(f"    {k} = {v}")
    L += ["", ""]

    for section, cls_name, doc in (
        ("ble", "Ble", "BLE GATT 标识，固件与 App 共用。"),
        ("wifi", "Wifi", "WiFi 备用通道的端口、路径与 mDNS 主机名。"),
    ):
        if not c.get(section):
            continue
        L.append(f"class {cls_name}:")
        L.append(f'    """{doc}"""')
        L.append("")
        for k, v in c[section].items():
            lit = f'"{v}"' if isinstance(v, str) else str(v)
            L.append(f"    {k.upper()} = {lit}")
        L += ["", ""]

    for ename, values in c["enums"].items():
        L.append(f"class {pascal(ename)}(str, Enum):")
        for v in values:
            L.append(f'    {v.upper()} = "{v}"')
        L.append("")
        L.append("    @property")
        L.append("    def wire(self) -> int:")
        L.append(f"        return list({pascal(ename)}).index(self)")
        L.append("")
        L.append("    @classmethod")
        L.append(f"    def from_wire(cls, i: int) -> \"{pascal(ename)}\":")
        L.append("        members = list(cls)")
        L.append("        return members[i] if 0 <= i < len(members) else members[0]")
        L += ["", ""]

    L += ["LEVEL_TABLE = ("]
    for row in c["levels"]:
        L.append(
            f'    {{"level": {row["level"]}, "duty_pct": {row["duty_pct"]}, '
            f'"pattern": Pattern.{row["pattern"].upper()}, "lit": {row["lit"]}, '
            f'"rgb": ({row["r"]}, {row["g"]}, {row["b"]}), "semantic": "{row["semantic"]}"}},'
        )
    L += [")", "", ""]

    for obj in list(c["json_objects"]) + list(c["json_messages"]):
        L.append(f"class {obj['name']}(BaseModel):")
        if obj.get("direction"):
            L.append(f'    """{obj["direction"]}"""')
            L.append("")
        for f in obj["fields"]:
            default = " = None" if f.get("nullable", False) else ""
            comment = f"  # {f['doc']}" if f.get("doc") else ""
            L.append(f"    {f['name']}: {py_type(f['type'], f.get('nullable', False))}{default}{comment}")
        L += ["", ""]

    return "\n".join(L).rstrip() + "\n"


# ---------------------------------------------------------------------------
# JavaScript (ES module，浏览器控制端)
# ---------------------------------------------------------------------------
def js_enum(name: str) -> str:
    return "Nl" + pascal(name)


def js_lit(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def js_from_json(spec: str, expr: str, nullable: bool) -> str:
    kind, arg = parse_type(spec)
    if kind in ("int", "float"):
        core = f"Number({expr})"
    elif kind == "str":
        core = f"String({expr})"
    elif kind == "bool":
        core = f"Boolean({expr})"
    elif kind == "enum":
        core = f"{js_enum(arg)}.fromWireName({expr})"
    elif kind == "obj":
        core = f"{arg}.fromJson({expr})"
    elif kind == "list":
        inner = "Number(e)" if arg in ("int", "float") else "String(e)"
        core = f"({expr}).map((e) => {inner})"
    elif kind == "list_obj":
        core = f"({expr}).map((e) => {arg}.fromJson(e))"
    else:
        raise ValueError(spec)
    return f"{expr} == null ? null : {core}" if nullable else core


def js_to_json(spec: str, expr: str, nullable: bool) -> str:
    kind, _arg = parse_type(spec)
    if kind in ("int", "float", "str", "bool", "list", "enum"):
        return expr
    if kind == "obj":
        return f"{expr}{ '?.' if nullable else '.' }toJson()"
    if kind == "list_obj":
        mapper = "?.map" if nullable else ".map"
        return f"{expr}{mapper}((e) => e.toJson())"
    raise ValueError(spec)


def gen_js(c: dict) -> str:
    L = [
        "// " + BANNER,
        f"// contract version: {c['version']}",
        "",
        "export const NlConst = Object.freeze({",
        f"  protoVersion: {js_lit(c['version'])},",
    ]
    for k, v in c["constants"].items():
        L.append(f"  {camel(k.lower())}: {v},")
    L += ["});", ""]

    for section, cls_name in (("ble", "NlBle"), ("wifi", "NlWifi")):
        if not c.get(section):
            continue
        L.append(f"export const {cls_name} = Object.freeze({{")
        for k, v in c[section].items():
            key = camel(k)
            L.append(f"  {key}: {js_lit(v) if isinstance(v, str) else v},")
        L += ["});", ""]

    for ename, values in c["enums"].items():
        cls = js_enum(ename)
        L.append(f"export const {cls} = Object.freeze((() => {{")
        L.append(f"  const values = [{', '.join(js_lit(v) for v in values)}];")
        L.append("  return {")
        for v in values:
            L.append(f"    {v.upper()}: {js_lit(v)},")
        L += [
            "    values,",
            "    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },",
            "    fromWireName(n) {",
            "      const i = values.indexOf(n ?? '');",
            "      return i < 0 ? values[0] : values[i];",
            "    },",
            "  };",
            "})());",
            "",
        ]

    L += ["export const kLevelTable = Object.freeze(["]
    for row in c["levels"]:
        L.append(
            "  Object.freeze({"
            f" level: {row['level']}, dutyPct: {row['duty_pct']},"
            f" pattern: {js_enum('pattern')}.{row['pattern'].upper()},"
            f" lit: {row['lit']}, r: {row['r']}, g: {row['g']}, b: {row['b']},"
            f" semantic: {js_lit(row['semantic'])} "
            "}),"
        )
    L += ["]);", ""]

    for obj in list(c["json_objects"]) + list(c["json_messages"]):
        name = obj["name"]
        fields = obj["fields"]
        if obj.get("direction"):
            L.append(f"/** {obj['direction']} */")
        L.append(f"export class {name} {{")
        L.append("  constructor({")
        for f in fields:
            default = " = null" if f.get("nullable", False) else ""
            L.append(f"    {camel(f['name'])}{default},")
        L.append("  }) {")
        for f in fields:
            L.append(f"    this.{camel(f['name'])} = {camel(f['name'])};")
        L.append("  }")
        L.append("")
        L.append(f"  static fromJson(j) {{")
        L.append(f"    return new {name}({{")
        for f in fields:
            if f.get("doc"):
                L.append(f"      // {f['doc']}")
            L.append(
                f"      {camel(f['name'])}: {js_from_json(f['type'], f'''j[{js_lit(f['name'])}]''', f.get('nullable', False))},"
            )
        L.append("    });")
        L.append("  }")
        L.append("")
        L.append("  toJson() {")
        L.append("    return {")
        for f in fields:
            L.append(
                f"      {js_lit(f['name'])}: {js_to_json(f['type'], 'this.' + camel(f['name']), f.get('nullable', False))},"
            )
        L.append("    };")
        L.append("  }")
        L.append("}")
        L.append("")

    return "\n".join(L).rstrip() + "\n"


# ---------------------------------------------------------------------------
# JSON Schema
# ---------------------------------------------------------------------------
JSON_PRIM = {"int": "integer", "float": "number", "str": "string", "bool": "boolean"}


def schema_for(spec: str, nullable: bool, enums: dict, objects: dict):
    kind, arg = parse_type(spec)
    if kind in JSON_PRIM:
        node = {"type": JSON_PRIM[kind]}
    elif kind == "enum":
        node = {"type": "string", "enum": list(enums[arg])}
    elif kind == "obj":
        node = {"$ref": f"#/$defs/{arg}"}
    elif kind == "list":
        node = {"type": "array", "items": {"type": JSON_PRIM[arg]}}
    elif kind == "list_obj":
        node = {"type": "array", "items": {"$ref": f"#/$defs/{arg}"}}
    else:
        raise ValueError(spec)
    if nullable:
        return {"anyOf": [node, {"type": "null"}]}
    return node


def object_schema(obj, enums, objects):
    props, required = {}, []
    for f in obj["fields"]:
        node = schema_for(f["type"], f.get("nullable", False), enums, objects)
        if f.get("doc"):
            node = dict(node)
            node["description"] = f["doc"]
        props[f["name"]] = node
        if not f.get("nullable", False):
            required.append(f["name"])
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


def gen_schemas(c: dict) -> dict[str, str]:
    enums = c["enums"]
    objects = {o["name"]: o for o in c["json_objects"]}
    out = {}
    for msg in c["json_messages"]:
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": f"https://nascent.local/protocol/{msg['file']}.json",
            "title": msg["name"],
            "description": f"{msg['direction']} | contract {c['version']} | {BANNER}",
            "$defs": {name: object_schema(o, enums, objects) for name, o in objects.items()},
        }
        schema.update(object_schema(msg, enums, objects))
        out[f"{msg['file']}.json"] = json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
    return out


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写盘")
    args = ap.parse_args()

    c = load_contract()
    dart, js, py = gen_dart(c), gen_js(c), gen_py(c)
    artifacts = {
        GENERATED / "nascent_protocol.h": gen_c(c),
        GENERATED / "protocol.dart": dart,
        GENERATED / "protocol.js": js,
        GENERATED / "protocol.py": py,
    }
    for name, body in gen_schemas(c).items():
        artifacts[SCHEMAS / name] = body

    # 固件用 -I 直接吃 generated/，但浏览器和 Python 的模块解析都不喜欢
    # 跳出各自的包根去引用文件。与其让两端各写一段路径 hack，
    # 不如在这里把同一份内容投放到位——反正它们都是生成物，不是手写代码。
    for dest, body in (
        (REPO / "software/app/js/protocol.js", js),
        (REPO / "software/backend/app/protocol.py", py),
    ):
        artifacts[dest] = body

    stale = []
    for path, body in artifacts.items():
        if not path.exists() or path.read_text(encoding="utf-8") != body:
            stale.append(path)

    if args.check:
        if stale:
            for p in stale:
                print(f"过期: {p.relative_to(REPO)}", file=sys.stderr)
            print("\ncontract.yaml 与产物不一致，请运行 python3 tools/gen.py", file=sys.stderr)
            return 1
        print(f"协议产物与 contract.yaml 一致（{c['version']}）")
        return 0

    for path, body in artifacts.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8", newline="\n")
    print(f"已生成 {len(artifacts)} 个文件，contract {c['version']}")
    for path in sorted(artifacts):
        print(f"  {path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
