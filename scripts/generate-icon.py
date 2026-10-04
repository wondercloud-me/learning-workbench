from pathlib import Path
from PIL import Image, ImageDraw
import subprocess

root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
iconset = assets / 'Growth.iconset'
iconset.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((32, 32, 992, 992), radius=208, fill='#2D342E')
draw.rounded_rectangle((188, 615, 420, 699), radius=42, fill='#F5F6F2')
draw.rounded_rectangle((394, 447, 626, 531), radius=42, fill='#F5F6F2')
draw.rounded_rectangle((600, 279, 832, 363), radius=42, fill='#F5F6F2')
draw.rounded_rectangle((370, 495, 454, 681), radius=38, fill='#F5F6F2')
draw.rounded_rectangle((576, 327, 660, 513), radius=38, fill='#F5F6F2')
for points, name in [(16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'), (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'), (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'), (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'), (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png')]:
    image.resize((points, points), Image.Resampling.LANCZOS).save(iconset / name)
image.save(assets / 'icon.png')
tray = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
tray_draw = ImageDraw.Draw(tray)
tray_draw.line([(4, 24), (12, 24), (12, 16), (20, 16), (20, 8), (28, 8)], fill='#000000', width=4, joint='curve')
tray.save(assets / 'tray.png')
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(assets / 'icon.icns')], check=True)
