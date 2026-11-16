"""Regenerate 1x/2x artwork and a coordinate-accurate installer proof."""
import io
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
assets = root / 'apps/web/src/fork/assets'
font = TTFont(assets / 'space-grotesk-medium.woff2')
font.flavor = None
font_bytes = io.BytesIO()
font.save(font_bytes)
for scale in (1, 2):
    image = Image.new('RGB', (640 * scale, 420 * scale), '#111315')
    draw = ImageDraw.Draw(image)
    def text(x, y, value, size, color):
        draw.text((x * scale, y * scale), value,
                  font=ImageFont.truetype(io.BytesIO(font_bytes.getvalue()), size * scale),
                  fill=color, anchor='mt')
    text(320, 40, 'Tiller', 34, '#f2f0eb')
    text(320, 94, 'Drag Tiller to Applications', 20, '#b8bdc4')
    # Finder draws icon labels in black on a custom background, so they need a light panel.
    draw.rounded_rectangle([(56 * scale, 150 * scale), (584 * scale, 332 * scale)], radius=18 * scale, fill='#eceee8')
    draw.line([(286 * scale, 230 * scale), (354 * scale, 230 * scale)], fill='#55704e', width=3 * scale)
    draw.line([(342 * scale, 218 * scale), (354 * scale, 230 * scale), (342 * scale, 242 * scale)], fill='#55704e', width=3 * scale)
    text(320, 365, 'Your agents. Your workflow.', 14, '#7c858c')
    image.save(out / f'background{ "@2x" if scale == 2 else "" }.png')
    if scale == 2:
        icon = Image.open(assets / 'tiller-app-icon.png').convert('RGBA').resize((96 * scale, 96 * scale))
        image.paste(icon, ((180 - 48) * scale, (230 - 48) * scale), icon)
        folder = Image.open('/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns').convert('RGBA').resize((96 * scale, 96 * scale))
        image.paste(folder, ((460 - 48) * scale, (230 - 48) * scale), folder)
        text(180, 289, 'Tiller', 13, '#000000')
        text(460, 289, 'Applications', 13, '#000000')
        image.save(out / 'installer-proof.png')
