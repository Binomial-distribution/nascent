"""Generate hackathon BOM/schematic artifacts.

Outputs (same directory):
  schematic.svg
  schematic.png
  bom-and-schematic.pdf

Run from this folder or repo root:
  python hardware/toy-sidecar/docs/render_pdf.py

Needs: reportlab, pillow. Uses Windows 已装中文字体。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent

INK = (22, 22, 22)
CREAM = (244, 241, 234)
RED = (193, 18, 31)
NAVY = (30, 58, 95)
PINK = (253, 236, 236)
WHITE = (255, 255, 255)
GRAY = (85, 85, 85)
LIGHT = (239, 234, 224)

FONT_CANDIDATES = [
    (r"C:\Windows\Fonts\msyh.ttc", 0),
    (r"C:\Windows\Fonts\simhei.ttf", None),
    (r"C:\Windows\Fonts\simsun.ttc", 0),
]


def load_pil_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path, index in FONT_CANDIDATES:
        p = Path(path)
        if not p.exists():
            continue
        try:
            if index is None:
                return ImageFont.truetype(str(p), size)
            return ImageFont.truetype(str(p), size, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


def register_rl_font() -> str:
    for path, sub in FONT_CANDIDATES:
        p = Path(path)
        if not p.exists():
            continue
        try:
            if sub is None:
                pdfmetrics.registerFont(TTFont("CN", str(p)))
            else:
                pdfmetrics.registerFont(TTFont("CN", str(p), subfontIndex=sub))
            return "CN"
        except Exception:
            continue
    return "Helvetica"


def xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_svg() -> Path:
    """Pin-accurate wiring diagram. Encoding is forced UTF-8."""
    out = ROOT / "schematic.svg"
    parts: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000" role="img">',
        "<title>Nascent Love toy-sidecar schematic</title>",
        "<rect width='1600' height='1000' fill='#f4f1ea'/>",
        "<rect x='20' y='20' width='1560' height='960' fill='none' stroke='#161616' stroke-width='2'/>",
        "<rect x='20' y='20' width='1560' height='70' fill='#161616'/>",
        "<text x='40' y='50' fill='#fff' font-size='22' font-weight='700' font-family='Microsoft YaHei, PingFang SC, sans-serif'>NASCENT LOVE  /  toy-sidecar wiring schematic</text>",
        "<text x='40' y='74' fill='#cfcfcf' font-size='12' font-family='Microsoft YaHei, PingFang SC, sans-serif'>binomial  /  protocol 0.3.0-demo  /  matches include/config.h  /  2026-08-29</text>",
        "<text x='1560' y='50' fill='#ffb4b4' font-size='14' font-weight='700' text-anchor='end' font-family='Microsoft YaHei, PingFang SC, sans-serif'>MCU does not drive motors</text>",
        "<text x='1560' y='74' fill='#ffb4b4' font-size='12' text-anchor='end' font-family='Microsoft YaHei, PingFang SC, sans-serif'>Drain 10k keeps key branch at 0.37 mA</text>",
        # MCU
        "<rect x='630' y='200' width='340' height='460' rx='8' fill='#161616'/>",
        "<text x='800' y='240' fill='#fff' font-size='20' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>U1  ESP32-S3-N16R8</text>",
        "<text x='800' y='262' fill='#bbb' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>only board  /  16MB Flash  8MB PSRAM</text>",
        "<text x='800' y='282' fill='#bbb' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>adv Nascent-Toy  /  BLE default, WiFi backup mutex</text>",
        "<line x1='660' y1='296' x2='940' y2='296' stroke='#444'/>",
    ]

    left_pins = [
        (333, "GPIO4   DHT11 DATA"),
        (383, "GPIO1   FSR402 ADC"),
        (433, "GPIO8   I2C SDA"),
        (483, "GPIO9   I2C SCL"),
        (533, "GPIO6   WS2812 DIN"),
    ]
    for y, name in left_pins:
        parts.append(f"<rect x='614' y='{y-7}' width='16' height='14' fill='#fff' stroke='#161616'/>")
        parts.append(
            f"<text x='800' y='{y+4}' fill='#fff' font-size='13' text-anchor='middle' font-family='Consolas, monospace'>{name}</text>"
        )
    parts.append("<rect x='970' y='243' width='16' height='14' fill='#fff' stroke='#161616'/>")
    parts.append("<text x='800' y='628' fill='#fff' font-size='13' text-anchor='middle' font-family='Consolas, monospace'>GPIO7 GATE          GPIO0 BOOT</text>")
    parts.append("<rect x='970' y='618' width='16' height='14' fill='#fff' stroke='#161616'/>")

    def box(x, y, w, h, title, line2, line3, fill="#fff"):
        parts.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' fill='{fill}' stroke='#161616' stroke-width='1.6'/>")
        parts.append(f"<text x='{x+w/2}' y='{y+24}' font-size='14' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>{xml_escape(title)}</text>")
        parts.append(f"<text x='{x+w/2}' y='{y+44}' font-size='12' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>{xml_escape(line2)}</text>")
        parts.append(f"<text x='{x+w/2}' y='{y+64}' font-size='11' fill='#555' text-anchor='middle' font-family='Consolas, monospace'>{xml_escape(line3)}</text>")

    box(48, 120, 220, 90, "U2  DHT11", "toy ambient T/H", "DATA GPIO4  VCC 3V3  R5 4.7k")
    box(48, 250, 220, 100, "U4  FSR402 left", "contact / 1-2 Hz rhythm", "3V3-FSR-GPIO1-R4 10k-GND")
    box(48, 390, 220, 110, "U3  MPU6050", "insert inference / still", "SDA GPIO8  SCL GPIO9  0x68")
    box(48, 540, 220, 100, "U5  WS2812B x8", "mode color + level count", "DIN GPIO6  VDD USB 5V")

    parts += [
        "<rect x='300' y='148' width='86' height='34' fill='#fff' stroke='#161616'/>",
        "<text x='343' y='170' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>R5 4.7k</text>",
        "<line x1='343' y1='148' x2='343' y2='114' stroke='#9b1c1c' stroke-width='2'/>",
        "<line x1='120' y1='114' x2='343' y2='114' stroke='#9b1c1c' stroke-width='2'/>",
        "<text x='220' y='108' fill='#9b1c1c' font-size='11' text-anchor='middle'>3V3</text>",
        "<line x1='343' y1='182' x2='343' y2='200' stroke='#9b1c1c' stroke-width='2'/>",
        "<circle cx='343' cy='200' r='3' fill='#161616'/>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='268,200 420,200 420,333 614,333'/>",
        "<rect x='300' y='360' width='86' height='34' fill='#fff' stroke='#161616'/>",
        "<text x='343' y='382' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>R4 10k</text>",
        "<line x1='343' y1='360' x2='343' y2='338' stroke='#1e3a5f' stroke-width='1.8'/>",
        "<circle cx='343' cy='338' r='3' fill='#161616'/>",
        "<line x1='343' y1='394' x2='343' y2='430' stroke='#161616' stroke-width='2.4'/>",
        "<line x1='328' y1='430' x2='358' y2='430' stroke='#161616' stroke-width='2.4'/>",
        "<line x1='333' y1='438' x2='353' y2='430' stroke='#161616' stroke-width='2'/>",
        "<line x1='120' y1='114' x2='120' y2='250' stroke='#9b1c1c' stroke-width='2'/>",
        "<circle cx='120' cy='114' r='3' fill='#9b1c1c'/>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='268,338 460,338 460,383 614,383'/>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='268,454 500,478 500,433 614,433'/>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='268,496 540,496 540,483 614,483'/>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='268,608 580,608 580,533 614,533'/>",
        "<line x1='80' y1='640' x2='80' y2='668' stroke='#9a3412' stroke-width='2'/>",
        "<text x='90' y='666' fill='#9a3412' font-size='11'>USB 5V</text>",
        # AO3400
        "<rect x='1020' y='118' width='540' height='430' fill='#fdecec' stroke='#c1121f' stroke-width='1.8'/>",
        "<text x='1290' y='144' font-size='15' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>Q1  AO3400A low-side N-MOS (SOT-23 1=G / 2=S / 3=D)</text>",
        "<text x='1290' y='164' fill='#8b0000' font-size='12' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>parallels original key  /  not wired to motors  /  no cap across contacts</text>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='986,250 1040,250 1040,250 1088,250'/>",
        "<rect x='1088' y='232' width='80' height='36' fill='#fff' stroke='#161616'/>",
        "<text x='1128' y='254' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>R1 1k</text>",
        "<line x1='1168' y1='250' x2='1220' y2='250' stroke='#1e3a5f' stroke-width='1.8'/>",
        "<line x1='1220' y1='220' x2='1220' y2='360' stroke='#161616' stroke-width='3'/>",
        "<line x1='1220' y1='250' x2='1260' y2='250' stroke='#161616' stroke-width='2'/>",
        "<polygon points='1246,244 1260,250 1246,256' fill='#161616'/>",
        "<line x1='1260' y1='220' x2='1260' y2='360' stroke='#161616' stroke-width='2.2'/>",
        "<text x='1200' y='246' font-size='11' font-family='Consolas, monospace'>G</text>",
        "<text x='1270' y='214' font-size='11' font-family='Consolas, monospace'>D</text>",
        "<text x='1270' y='376' font-size='11' font-family='Consolas, monospace'>S</text>",
        "<circle cx='1194' cy='250' r='3' fill='#161616'/>",
        "<line x1='1194' y1='250' x2='1194' y2='280' stroke='#1e3a5f' stroke-width='1.8'/>",
        "<rect x='1154' y='280' width='80' height='36' fill='#fff' stroke='#161616'/>",
        "<text x='1194' y='302' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>R2 47k</text>",
        "<line x1='1194' y1='316' x2='1194' y2='400' stroke='#161616' stroke-width='2.4'/>",
        "<text x='1206' y='336' font-size='11' fill='#8b0000' font-family='Microsoft YaHei, sans-serif'>solder first</text>",
        "<line x1='1260' y1='360' x2='1260' y2='400' stroke='#161616' stroke-width='2.4'/>",
        "<line x1='1170' y1='400' x2='1400' y2='400' stroke='#161616' stroke-width='2.4'/>",
        "<line x1='1180' y1='408' x2='1210' y2='400' stroke='#161616' stroke-width='2'/>",
        "<text x='1274' y='394' font-size='11' font-family='Microsoft YaHei, sans-serif'>GND = contact B = battery negative</text>",
        "<line x1='1260' y1='220' x2='1320' y2='220' stroke='#c1121f' stroke-width='2.2'/>",
        "<rect x='1320' y='200' width='90' height='40' fill='#fff' stroke='#c1121f' stroke-width='1.8'/>",
        "<text x='1365' y='218' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>R3 10k</text>",
        "<text x='1365' y='234' fill='#8b0000' font-size='11' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>safety, do not omit</text>",
        "<line x1='1410' y1='220' x2='1470' y2='220' stroke='#c1121f' stroke-width='2.2'/>",
        "<rect x='1470' y='176' width='70' height='250' fill='#fff' stroke='#161616' stroke-width='1.6'/>",
        "<text x='1505' y='200' font-size='13' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>HOST</text>",
        "<text x='1505' y='218' font-size='11' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>OEM board</text>",
        "<text x='1505' y='244' font-size='11' text-anchor='middle' font-family='Consolas, monospace'>A ~3.7V</text>",
        "<line x1='1484' y1='276' x2='1526' y2='276' stroke='#161616'/>",
        "<text x='1505' y='300' font-size='11' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>OEM button</text>",
        "<text x='1505' y='316' font-size='11' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>kept in parallel</text>",
        "<text x='1505' y='348' font-size='11' text-anchor='middle' font-family='Consolas, monospace'>contact B</text>",
        "<text x='1505' y='390' font-size='11' fill='#555' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>common GND</text>",
        "<line x1='1470' y1='348' x2='1400' y2='400' stroke='#161616' stroke-width='2.4'/>",
        "<line x1='1470' y1='244' x2='1410' y2='220' stroke='#c1121f' stroke-width='2.2'/>",
        "<rect x='1470' y='440' width='70' height='90' fill='#fff' stroke='#161616'/>",
        "<text x='1505' y='468' font-size='11' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>3 motors</text>",
        "<text x='1505' y='488' fill='#8b0000' font-size='12' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>OEM driven</text>",
        "<text x='1505' y='508' font-size='11' fill='#555' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>this MCU cannot</text>",
        "<rect x='1020' y='568' width='250' height='120' fill='#fff' stroke='#161616' stroke-width='1.6'/>",
        "<text x='1145' y='594' font-size='14' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>SW1  BOOT key / GPIO0</text>",
        "<text x='1145' y='614' font-size='12' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>on-board, no extra wiring</text>",
        "<text x='1145' y='638' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>short &lt;=600ms = e-stop</text>",
        "<text x='1145' y='658' font-size='12' text-anchor='middle' font-family='Consolas, monospace'>hold 2s = clear latch</text>",
        "<text x='1145' y='676' fill='#8b0000' font-size='12' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>can stop, cannot raise level</text>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='986,625 1004,625 1004,568'/>",
        "<rect x='1020' y='708' width='250' height='80' fill='#fff' stroke='#161616' stroke-width='1.6'/>",
        "<text x='1145' y='734' font-size='14' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>Phone web / Android shell</text>",
        "<text x='1145' y='756' font-size='11' text-anchor='middle' font-family='Consolas, monospace'>BLE GATT default</text>",
        "<text x='1145' y='774' font-size='11' text-anchor='middle' font-family='Consolas, monospace'>WiFi WS backup, runtime mutex</text>",
        "<polyline fill='none' stroke='#1e3a5f' stroke-width='1.8' points='800,660 800,748 1020,748'/>",
        "<rect x='1290' y='568' width='270' height='220' fill='#fff6e8' stroke='#161616' stroke-width='1.4'/>",
        "<text x='1425' y='594' font-size='14' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>Safety (measured 2026-08-28)</text>",
        "<text x='1306' y='620' font-size='12' font-family='Microsoft YaHei, sans-serif'>Contact off-state ~ 3.7 V &gt; 3.3 V</text>",
        "<text x='1306' y='640' font-size='12' font-family='Microsoft YaHei, sans-serif'>CD4066 rejected (would back-feed 3V3)</text>",
        "<text x='1306' y='660' font-size='12' font-family='Microsoft YaHei, sans-serif'>I = 3.7 V / 10 k = 0.37 mA</text>",
        "<text x='1425' y='686' font-size='14' font-weight='700' text-anchor='middle' font-family='Microsoft YaHei, sans-serif'>cannot drive a motor</text>",
        "<text x='1306' y='712' font-size='12' font-family='Microsoft YaHei, sans-serif'>Floating gate: D-S ~200k, false ON</text>",
        "<text x='1306' y='732' font-size='12' font-family='Microsoft YaHei, sans-serif'>Assemble: GND, R2, R1, then D/S flying leads</text>",
        "<text x='1306' y='752' font-size='12' font-family='Microsoft YaHei, sans-serif'>Resume: BOOT hold 2s only. No resume cmd.</text>",
        "<text x='1306' y='772' font-size='12' font-family='Microsoft YaHei, sans-serif'>OEM long-press ~1s = power toggle</text>",
        "<rect x='48' y='668' width='560' height='280' fill='#fff' stroke='#161616' stroke-width='1.4'/>",
        "<text x='64' y='694' font-size='14' font-weight='700' font-family='Microsoft YaHei, sans-serif'>Notes / not on this sheet</text>",
        "<line x1='64' y1='714' x2='120' y2='714' stroke='#9b1c1c' stroke-width='2'/>",
        "<text x='128' y='718' font-size='12'>3V3</text>",
        "<line x1='180' y1='714' x2='236' y2='714' stroke='#9a3412' stroke-width='2'/>",
        "<text x='244' y='718' font-size='12'>5V</text>",
        "<line x1='290' y1='714' x2='346' y2='714' stroke='#161616' stroke-width='2.4'/>",
        "<text x='354' y='718' font-size='12'>GND</text>",
        "<line x1='410' y1='714' x2='466' y2='714' stroke='#1e3a5f' stroke-width='1.8'/>",
        "<text x='474' y='718' font-size='12'>signal</text>",
        "<line x1='64' y1='738' x2='120' y2='738' stroke='#c1121f' stroke-width='2.2'/>",
        "<text x='128' y='742' font-size='12' font-family='Microsoft YaHei, sans-serif'>key branch (R3 current limit)</text>",
        "<text x='64' y='772' font-size='12' font-family='Microsoft YaHei, sans-serif'>1. Demo is one board: sense, LEDs, key emulate, BLE/WiFi. OEM 9-level + 3 motors stay.</text>",
        "<text x='64' y='792' font-size='12' font-family='Microsoft YaHei, sans-serif'>2. OEM long-press ~1s toggles power. Shorted contacts cycle levels only while ON. No boot key-press.</text>",
        "<text x='64' y='812' font-size='12' font-family='Microsoft YaHei, sans-serif'>3. Stop: remote stop or BOOT short. Resume: BOOT hold 2s. Firmware has no resume branch.</text>",
        "<text x='64' y='832' font-size='12' font-family='Microsoft YaHei, sans-serif'>4. Not drawn: NTC x2, e-stop lanyard, I2S mic, FSR right, K10, HW504 (last two deleted).</text>",
        "<text x='64' y='852' font-size='12' font-family='Microsoft YaHei, sans-serif'>5. Pin changes must update include/config.h and hardware/toy-sidecar/README.md together.</text>",
        "<text x='64' y='872' font-size='12' font-family='Microsoft YaHei, sans-serif'>6. BOM: bom.md / bom.csv in this folder. Datasheets: repo datasheets/.</text>",
        "<text x='64' y='892' font-size='12' font-family='Microsoft YaHei, sans-serif'>7. Unplug AO3400A branch and the OEM toy still works from its own button. That is the rollback.</text>",
        "<text x='64' y='922' font-size='13' font-weight='700' font-family='Microsoft YaHei, sans-serif'>Source: measured toy-sidecar wiring, not a concept sketch.</text>",
        "</svg>",
    ]
    out.write_text("\n".join(parts) + "\n", encoding="utf-8")
    return out


def write_png() -> Path:
    """Raster copy for forms that want a image URL."""
    out = ROOT / "schematic.png"
    img = Image.new("RGB", (1600, 1000), CREAM)
    d = ImageDraw.Draw(img)
    title = load_pil_font(22)
    body = load_pil_font(14)
    small = load_pil_font(12)
    mono = load_pil_font(13)
    tiny = load_pil_font(11)

    d.rectangle((20, 20, 1580, 980), outline=INK, width=2)
    d.rectangle((20, 20, 1580, 90), fill=INK)
    d.text((40, 32), "NASCENT LOVE  /  toy-sidecar wiring schematic", font=title, fill=WHITE)
    d.text((40, 62), "binomial  /  0.3.0-demo  /  include/config.h  /  2026-08-29", font=small, fill=(200, 200, 200))
    d.text((1180, 32), "MCU does not drive motors", font=body, fill=(255, 180, 180))
    d.text((1180, 58), "Drain 10k = 0.37 mA", font=small, fill=(255, 180, 180))

    d.rounded_rectangle((630, 200, 970, 660), radius=8, fill=INK)
    d.text((800, 220), "U1  ESP32-S3-N16R8", font=title, fill=WHITE, anchor="ma")
    d.text((800, 252), "only board   Nascent-Toy   BLE / WiFi mutex", font=small, fill=(180, 180, 180), anchor="ma")
    for y, name in [
        (333, "GPIO4  DHT11 DATA"),
        (383, "GPIO1  FSR402 ADC"),
        (433, "GPIO8  I2C SDA"),
        (483, "GPIO9  I2C SCL"),
        (533, "GPIO6  WS2812 DIN"),
        (583, "GPIO7  GATE   GPIO0 BOOT"),
    ]:
        d.rectangle((614, y - 7, 630, y + 7), fill=WHITE, outline=INK)
        d.text((800, y), name, font=mono, fill=WHITE, anchor="mm")
    d.rectangle((970, 243, 986, 257), fill=WHITE, outline=INK)
    d.rectangle((970, 618, 986, 632), fill=WHITE, outline=INK)

    def panel(xy, title_s, l2, l3):
        d.rectangle(xy, fill=WHITE, outline=INK, width=2)
        cx = (xy[0] + xy[2]) / 2
        d.text((cx, xy[1] + 18), title_s, font=body, fill=INK, anchor="ma")
        d.text((cx, xy[1] + 42), l2, font=small, fill=INK, anchor="ma")
        d.text((cx, xy[1] + 64), l3, font=tiny, fill=GRAY, anchor="ma")

    panel((48, 120, 268, 210), "U2  DHT11", "ambient T/H, not NTC fuse", "DATA GPIO4   R5 4.7k to 3V3")
    panel((48, 250, 268, 350), "U4  FSR402 left", "contact / 1-2 Hz rhythm", "3V3-FSR-GPIO1-R4 10k-GND")
    panel((48, 390, 268, 500), "U3  MPU6050", "insert inference, motor sense RO", "SDA GPIO8  SCL GPIO9  0x68")
    panel((48, 540, 268, 640), "U5  WS2812B x8", "mode color + level count", "DIN GPIO6   VDD USB 5V")

    d.rectangle((300, 148, 386, 182), fill=WHITE, outline=INK)
    d.text((343, 165), "R5 4.7k", font=tiny, fill=INK, anchor="mm")
    d.line((343, 148, 343, 114), fill=(155, 28, 28), width=2)
    d.line((120, 114, 343, 114), fill=(155, 28, 28), width=2)
    d.text((220, 100), "3V3", font=tiny, fill=(155, 28, 28), anchor="mm")
    d.line((268, 200, 420, 200), fill=NAVY, width=2)
    d.line((420, 200, 420, 333), fill=NAVY, width=2)
    d.line((420, 333, 614, 333), fill=NAVY, width=2)

    d.rectangle((300, 360, 386, 394), fill=WHITE, outline=INK)
    d.text((343, 377), "R4 10k", font=tiny, fill=INK, anchor="mm")
    d.line((343, 360, 343, 338), fill=NAVY, width=2)
    d.line((343, 394, 343, 430), fill=INK, width=3)
    d.line((328, 430, 358, 430), fill=INK, width=3)
    d.line((268, 338, 460, 338), fill=NAVY, width=2)
    d.line((460, 338, 460, 383), fill=NAVY, width=2)
    d.line((460, 383, 614, 383), fill=NAVY, width=2)
    d.line((120, 114, 120, 250), fill=(155, 28, 28), width=2)

    d.line((268, 454, 500, 454), fill=NAVY, width=2)
    d.line((500, 454, 500, 433), fill=NAVY, width=2)
    d.line((500, 433, 614, 433), fill=NAVY, width=2)
    d.line((268, 496, 540, 496), fill=NAVY, width=2)
    d.line((540, 496, 540, 483), fill=NAVY, width=2)
    d.line((540, 483, 614, 483), fill=NAVY, width=2)
    d.line((268, 608, 580, 608), fill=NAVY, width=2)
    d.line((580, 608, 580, 533), fill=NAVY, width=2)
    d.line((580, 533, 614, 533), fill=NAVY, width=2)
    d.text((90, 666), "USB 5V", font=tiny, fill=(154, 52, 18))

    d.rectangle((1020, 118, 1560, 548), fill=PINK, outline=RED, width=2)
    d.text((1290, 136), "Q1  AO3400A low-side N-MOS  (SOT-23 1=G 2=S 3=D)", font=body, fill=INK, anchor="ma")
    d.text((1290, 158), "parallels OEM key  /  not on motors  /  no capacitor across contacts", font=small, fill=RED, anchor="ma")

    d.line((986, 250, 1088, 250), fill=NAVY, width=2)
    d.rectangle((1088, 232, 1168, 268), fill=WHITE, outline=INK)
    d.text((1128, 250), "R1 1k", font=tiny, fill=INK, anchor="mm")
    d.line((1168, 250, 1220, 250), fill=NAVY, width=2)
    d.line((1220, 220, 1220, 360), fill=INK, width=3)
    d.line((1220, 250, 1260, 250), fill=INK, width=2)
    d.polygon([(1246, 244), (1260, 250), (1246, 256)], fill=INK)
    d.line((1260, 220, 1260, 360), fill=INK, width=2)
    d.text((1204, 236), "G", font=tiny, fill=INK)
    d.text((1270, 214), "D", font=tiny, fill=INK)
    d.text((1270, 372), "S", font=tiny, fill=INK)
    d.ellipse((1191, 247, 1197, 253), fill=INK)
    d.line((1194, 250, 1194, 280), fill=NAVY, width=2)
    d.rectangle((1154, 280, 1234, 316), fill=WHITE, outline=INK)
    d.text((1194, 298), "R2 47k", font=tiny, fill=INK, anchor="mm")
    d.line((1194, 316, 1194, 400), fill=INK, width=3)
    d.text((1210, 330), "solder first", font=tiny, fill=RED)
    d.line((1260, 360, 1260, 400), fill=INK, width=3)
    d.line((1170, 400, 1400, 400), fill=INK, width=3)
    d.text((1274, 384), "GND = contact B = battery negative", font=tiny, fill=INK)
    d.line((1260, 220, 1320, 220), fill=RED, width=3)
    d.rectangle((1320, 200, 1410, 240), fill=WHITE, outline=RED, width=2)
    d.text((1365, 212), "R3 10k", font=tiny, fill=INK, anchor="mm")
    d.text((1365, 228), "safety", font=tiny, fill=RED, anchor="mm")
    d.line((1410, 220, 1470, 220), fill=RED, width=3)

    d.rectangle((1470, 176, 1540, 426), fill=WHITE, outline=INK, width=2)
    d.text((1505, 196), "HOST", font=body, fill=INK, anchor="ma")
    d.text((1505, 218), "OEM board", font=tiny, fill=INK, anchor="ma")
    d.text((1505, 244), "A ~3.7V", font=tiny, fill=INK, anchor="ma")
    d.line((1484, 276, 1526, 276), fill=INK, width=1)
    d.text((1505, 300), "OEM button", font=tiny, fill=INK, anchor="ma")
    d.text((1505, 318), "kept parallel", font=tiny, fill=INK, anchor="ma")
    d.text((1505, 348), "contact B", font=tiny, fill=INK, anchor="ma")
    d.line((1470, 244, 1410, 220), fill=RED, width=2)
    d.line((1470, 348, 1400, 400), fill=INK, width=3)
    d.rectangle((1470, 440, 1540, 530), fill=WHITE, outline=INK)
    d.text((1505, 468), "3 motors", font=tiny, fill=INK, anchor="ma")
    d.text((1505, 490), "OEM driven", font=small, fill=RED, anchor="ma")
    d.text((1505, 510), "MCU cannot", font=tiny, fill=GRAY, anchor="ma")

    d.rectangle((1020, 568, 1270, 688), fill=WHITE, outline=INK, width=2)
    d.text((1145, 590), "SW1  BOOT / GPIO0", font=body, fill=INK, anchor="ma")
    d.text((1145, 614), "on-board, no extra wire", font=small, fill=INK, anchor="ma")
    d.text((1145, 638), "short <=600ms = e-stop", font=tiny, fill=INK, anchor="ma")
    d.text((1145, 658), "hold 2s = clear latch", font=tiny, fill=INK, anchor="ma")
    d.text((1145, 676), "can stop, cannot raise level", font=tiny, fill=RED, anchor="ma")
    d.line((986, 625, 1004, 625), fill=NAVY, width=2)
    d.line((1004, 625, 1004, 568), fill=NAVY, width=2)

    d.rectangle((1020, 708, 1270, 788), fill=WHITE, outline=INK, width=2)
    d.text((1145, 732), "Phone web / Android", font=body, fill=INK, anchor="ma")
    d.text((1145, 754), "BLE GATT default", font=tiny, fill=INK, anchor="ma")
    d.text((1145, 772), "WiFi WS backup, mutex", font=tiny, fill=INK, anchor="ma")
    d.line((800, 660, 800, 748), fill=NAVY, width=2)
    d.line((800, 748, 1020, 748), fill=NAVY, width=2)

    d.rectangle((1290, 568, 1560, 788), fill=(255, 246, 232), outline=INK, width=2)
    d.text((1425, 590), "Safety (measured 2026-08-28)", font=body, fill=INK, anchor="ma")
    for i, line in enumerate(
        [
            "Contact off-state ~ 3.7 V > 3.3 V",
            "CD4066 rejected (back-feeds 3V3)",
            "I = 3.7 V / 10 k = 0.37 mA",
            "Physically cannot drive a motor",
            "Floating gate ~200k, false ON",
            "Assemble: GND, R2, R1, then D/S leads",
            "Resume: BOOT hold 2s. No resume cmd.",
        ]
    ):
        d.text((1306, 616 + i * 22), line, font=tiny, fill=INK)

    d.rectangle((48, 668, 608, 948), fill=WHITE, outline=INK, width=2)
    d.text((64, 688), "Notes / not on this sheet", font=body, fill=INK)
    notes = [
        "1. One-board demo: sense, LEDs, key emulate, BLE/WiFi. OEM 9-level + 3 motors stay.",
        "2. OEM long-press ~1s toggles power. Short cycles levels only while ON.",
        "3. Stop: remote stop or BOOT short. Resume only BOOT hold 2s. No resume in firmware.",
        "4. Not drawn: NTC x2, e-stop lanyard, I2S mic, FSR right, K10, HW504 (deleted).",
        "5. Pin changes must update include/config.h and toy-sidecar/README.md together.",
        "6. BOM: bom.md / bom.csv. Datasheets: repo datasheets/.",
        "7. Unplug AO3400A and the OEM toy still works from its own button.",
        "Source: measured toy-sidecar wiring, not a concept sketch.",
    ]
    for i, line in enumerate(notes):
        d.text((64, 720 + i * 24), line, font=tiny, fill=INK)

    img.save(out, "PNG")
    return out


def page_bom(c: canvas.Canvas, font: str) -> None:
    w, h = landscape(A4)
    c.setFillColor(HexColor("#f4f1ea"))
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(HexColor("#161616"))
    c.rect(0, h - 18 * mm, w, 18 * mm, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont(font, 13)
    c.drawString(14 * mm, h - 8 * mm, "NASCENT LOVE  /  verification BOM  /  toy-sidecar")
    c.setFont(font, 9)
    c.drawRightString(w - 14 * mm, h - 8 * mm, "SHEET 1/2")
    c.setFillColor(HexColor("#c1121f"))
    c.drawRightString(w - 14 * mm, h - 14 * mm, "MCU does not drive motors  /  drain 10k = 0.37 mA")

    c.setFillColor(HexColor("#161616"))
    c.setFont(font, 10)
    c.drawString(
        14 * mm,
        h - 28 * mm,
        "Team binomial  /  protocol 0.3.0-demo  /  CNY reference prices 2026-08, electronics ~108, OEM toy not included.",
    )

    rows = [
        ("Ref", "Qty", "Part", "Use / constraint", "CNY"),
        ("U1", "1", "ESP32-S3-N16R8 DevKit", "Only MCU. Adv Nascent-Toy. Does not drive motors", "48.00"),
        ("U2", "1", "DHT11", "GPIO4. Ambient T/H, not contact fuse", "4.00"),
        ("U3", "1", "MPU6050 / GY-521", "I2C GPIO8/9 @0x68. Insert inference; motor sense RO", "9.00"),
        ("U4", "1", "FSR402", "GPIO1 ADC. No climax detect. Right unpopulated", "22.00"),
        ("U5", "1", "WS2812B x8", "GPIO6. 5V. Level = lit count", "10.00"),
        ("Q1", "1", "AO3400A N-MOS SOT-23", "Parallel OEM key. 1=G 2=S 3=D", "0.80"),
        ("R1", "1", "1k 1/8W", "GPIO7 series to gate", "0.05"),
        ("R2", "1", "47k 1/8W", "Gate pulldown. Solder before flying leads", "0.05"),
        ("R3", "1", "10k 1/8W", "Drain limit. Safety part, do not omit/reduce", "0.05"),
        ("R4", "1", "10k 1/8W", "FSR pulldown", "0.05"),
        ("R5", "1", "4.7k 1/8W", "DHT11 pullup; omit if module has it", "0.05"),
        ("W1", "1", "flying leads", "OEM key contacts. Not on breadboard", "6.00"),
        ("J1", "1", "USB-C cable", "Power and flash", "8.00"),
        ("SW1", "1", "BOOT GPIO0", "On-board. Short=e-stop, hold 2s=clear latch", "0"),
        ("HOST", "1", "OEM toy", "OEM MCU + button + 3 motors. Not in purchase total", "-"),
    ]
    col_x = [14 * mm, 32 * mm, 48 * mm, 118 * mm, 252 * mm]
    row_h = 7.2 * mm
    y = h - 36 * mm
    for i, row in enumerate(rows):
        if i == 0:
            c.setFillColor(HexColor("#161616"))
            c.rect(14 * mm, y - 5.2 * mm, w - 28 * mm, row_h, fill=1, stroke=0)
            c.setFillColor(white)
        else:
            c.setFillColor(HexColor("#efeae0") if i % 2 == 0 else white)
            c.rect(14 * mm, y - 5.2 * mm, w - 28 * mm, row_h, fill=1, stroke=0)
            c.setFillColor(HexColor("#c1121f") if row[0] == "R3" else HexColor("#161616"))
        c.setFont(font, 8)
        for j, cell in enumerate(row):
            c.drawString(col_x[j] + 1.2 * mm, y - 2.6 * mm, cell)
        y -= row_h

    y -= 5 * mm
    c.setFillColor(HexColor("#161616"))
    c.setFont(font, 9)
    c.drawString(14 * mm, y, "Not populated this demo: NTC x2, FSR right, e-stop lanyard, I2S mic. HW504 / K10 deleted.")
    y -= 5 * mm
    c.drawString(14 * mm, y, "Pins: GPIO4 DHT11, GPIO1 FSR, GPIO8/9 MPU, GPIO6 LED, GPIO7 AO3400 gate, GPIO0 BOOT.")
    y -= 5 * mm
    c.drawString(14 * mm, y, "CSV: bom.csv    Schematic: schematic.svg / schematic.png and sheet 2 of this PDF.")
    c.showPage()


def page_schematic(c: canvas.Canvas, font: str) -> None:
    w, h = landscape(A4)
    c.setFillColor(HexColor("#f4f1ea"))
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(HexColor("#161616"))
    c.rect(0, h - 18 * mm, w, 18 * mm, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont(font, 13)
    c.drawString(14 * mm, h - 8 * mm, "NASCENT LOVE  /  wiring schematic  /  toy-sidecar")
    c.setFont(font, 9)
    c.drawRightString(w - 14 * mm, h - 8 * mm, "SHEET 2/2")
    c.setFillColor(HexColor("#c1121f"))
    c.drawRightString(w - 14 * mm, h - 14 * mm, "MCU does not drive motors  /  drain 10k = 0.37 mA")

    def box(x, y, bw, bh, fill=white, stroke=HexColor("#161616"), sw=1):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.setLineWidth(sw)
        c.roundRect(x, y, bw, bh, 3, fill=1, stroke=1)

    def lab(x, y, text, size=8, color=HexColor("#161616"), align="left"):
        c.setFillColor(color)
        c.setFont(font, size)
        if align == "center":
            c.drawCentredString(x, y, text)
        else:
            c.drawString(x, y, text)

    box(108 * mm, 58 * mm, 72 * mm, 92 * mm, fill=HexColor("#161616"))
    lab(144 * mm, 140 * mm, "U1 ESP32-S3-N16R8", 9, white, "center")
    lab(144 * mm, 134 * mm, "only board   Nascent-Toy", 7, HexColor("#cccccc"), "center")
    for py, name in [
        (128, "GPIO4  DHT11"),
        (118, "GPIO1  FSR_L"),
        (108, "GPIO8  SDA"),
        (98, "GPIO9  SCL"),
        (88, "GPIO6  LED"),
        (78, "GPIO7  GATE"),
        (68, "GPIO0  BOOT"),
    ]:
        c.setFillColor(white)
        c.rect(108 * mm - 3 * mm, py * mm - 1.5 * mm, 3 * mm, 3 * mm, fill=1, stroke=0)
        lab(144 * mm, py * mm - 1 * mm, name, 7, white, "center")

    sensors = [
        (18, 128, "U2 DHT11", "ambient T/H  GPIO4", "R5 4.7k pullup to 3V3"),
        (18, 102, "U4 FSR402 left", "contact/rhythm  GPIO1", "R4 10k pulldown"),
        (18, 76, "U3 MPU6050", "insert inference  0x68", "motor sense read-only"),
        (18, 50, "U5 WS2812B x8", "LEDs GPIO6", "VDD USB 5V"),
    ]
    for x, y, t, s, n in sensors:
        box(x * mm, y * mm, 52 * mm, 22 * mm)
        lab((x + 26) * mm, (y + 15) * mm, t, 8, HexColor("#161616"), "center")
        lab((x + 26) * mm, (y + 9) * mm, s, 7, HexColor("#1e3a5f"), "center")
        lab((x + 26) * mm, (y + 3.5) * mm, n, 6.5, HexColor("#555555"), "center")

    c.setStrokeColor(HexColor("#1e3a5f"))
    c.setLineWidth(1.2)
    c.line(70 * mm, 139 * mm, 105 * mm, 128 * mm)
    c.line(70 * mm, 113 * mm, 105 * mm, 118 * mm)
    c.line(70 * mm, 87 * mm, 105 * mm, 108 * mm)
    c.line(70 * mm, 61 * mm, 105 * mm, 88 * mm)

    box(190 * mm, 78 * mm, 90 * mm, 78 * mm, fill=HexColor("#fdecec"), stroke=HexColor("#c1121f"), sw=1.4)
    lab(235 * mm, 148 * mm, "Q1 AO3400A low-side N-MOS", 8, HexColor("#161616"), "center")
    lab(235 * mm, 142 * mm, "key emulate only, not motors", 7, HexColor("#c1121f"), "center")
    lab(200 * mm, 128 * mm, "GPIO7 - R1 1k - G", 7)
    lab(200 * mm, 121 * mm, "G also R2 47k to GND (solder first)", 7)
    lab(200 * mm, 114 * mm, "D - R3 10k - OEM contact A ~3.7V", 7, HexColor("#c1121f"))
    lab(200 * mm, 107 * mm, "S - contact B + battery neg + ESP GND", 7)
    lab(200 * mm, 98 * mm, "OEM button kept in parallel", 7)
    lab(200 * mm, 90 * mm, "Imax = 3.7V / 10k = 0.37 mA", 8, HexColor("#c1121f"))
    lab(235 * mm, 84 * mm, "physically cannot drive a motor", 8, HexColor("#c1121f"), "center")

    c.setStrokeColor(HexColor("#1e3a5f"))
    c.line(180 * mm, 78 * mm, 190 * mm, 128 * mm)

    box(190 * mm, 48 * mm, 42 * mm, 24 * mm)
    lab(211 * mm, 64 * mm, "HOST OEM board", 8, HexColor("#161616"), "center")
    lab(211 * mm, 56 * mm, "9-level logic stays", 7, HexColor("#555555"), "center")
    box(238 * mm, 48 * mm, 42 * mm, 24 * mm)
    lab(259 * mm, 64 * mm, "3 OEM motors", 8, HexColor("#161616"), "center")
    lab(259 * mm, 56 * mm, "OEM driven, MCU cannot", 7, HexColor("#c1121f"), "center")

    box(190 * mm, 22 * mm, 42 * mm, 24 * mm)
    lab(211 * mm, 38 * mm, "SW1 BOOT GPIO0", 8, HexColor("#161616"), "center")
    lab(211 * mm, 31 * mm, "short=stop / hold=unlatch", 7, HexColor("#c1121f"), "center")
    box(238 * mm, 22 * mm, 42 * mm, 24 * mm)
    lab(259 * mm, 38 * mm, "Phone BLE / WiFi", 8, HexColor("#161616"), "center")
    lab(259 * mm, 31 * mm, "runtime mutex, no resume", 7, HexColor("#1e3a5f"), "center")

    c.setStrokeColor(HexColor("#1e3a5f"))
    c.line(180 * mm, 68 * mm, 190 * mm, 34 * mm)
    c.line(144 * mm, 58 * mm, 144 * mm, 34 * mm)
    c.line(144 * mm, 34 * mm, 190 * mm, 34 * mm)

    box(18 * mm, 18 * mm, 84 * mm, 26 * mm)
    lab(22 * mm, 38 * mm, "Assemble: common GND, R2 pulldown, R1 gate, then D/S flying leads. Not on breadboard.", 7)
    lab(22 * mm, 32 * mm, "Stop: remote stop or BOOT short. Resume: BOOT hold 2s. Firmware has no resume.", 7)
    lab(22 * mm, 26 * mm, "Not drawn: NTC x2, e-stop lanyard, I2S mic, FSR right, K10, HW504.", 7)
    lab(22 * mm, 22 * mm, "Source: measured toy-sidecar wiring. Pin changes update config.h + README.", 7)
    c.showPage()


def write_pdf() -> Path:
    out = ROOT / "bom-and-schematic.pdf"
    font = register_rl_font()
    c = canvas.Canvas(str(out), pagesize=landscape(A4))
    c.setTitle("Nascent Love verification BOM and schematic")
    c.setAuthor("binomial")
    page_bom(c, font)
    page_schematic(c, font)
    c.save()
    return out


def main() -> None:
    svg = write_svg()
    png = write_png()
    pdf = write_pdf()
    print(svg)
    print(png)
    print(pdf)


if __name__ == "__main__":
    main()
