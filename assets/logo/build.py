"""Writes every Wattamax logo SVG into assets/, plus the link preview image."""
from pathlib import Path

import cairosvg

from icon import icon
from wordmark import wordmark, tt_alone

OUT = Path(__file__).parent.parent


def inner(svg):
    """The drawing of one of our SVGs, without its <svg> and <title> lines."""
    return "".join(svg.splitlines(keepends=True)[2:-1])


def preview(icon_svg, wordmark_svg, w=1200, h=630, size=160):
    """Link preview (og:image): the light icon and the wordmark, centred on the site's background."""
    ratio = float(wordmark_svg.split('viewBox="0 0 ')[1].split()[0]) / 100
    height = size * 0.45
    left = (w - size - 40 - height * ratio) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">\n<rect width="{w}" height="{h}" fill="#F5F5F7"/>\n'
            f'<svg x="{left}" y="{(h - size) / 2}" width="{size}" height="{size}" viewBox="0 0 100 100">\n{inner(icon_svg)}</svg>\n'
            f'<svg x="{left + size + 40}" y="{(h - height) / 2}" width="{height * ratio}" height="{height}" viewBox="0 0 {ratio * 100} 100">\n'
            f'{inner(wordmark_svg)}</svg>\n</svg>\n')


files = {"wattamax-tt.svg": tt_alone()}
files |= {f"wattamax-icon{suffix}.svg": svg for suffix, svg in icon().items()}
files |= {f"wattamax-wordmark{suffix}.svg": svg for suffix, svg in wordmark().items()}
for name, svg in files.items():
    (OUT / name).write_text(svg)
    print(OUT / name)

cairosvg.svg2png(bytestring=preview(files["wattamax-icon-light.svg"], files["wattamax-wordmark.svg"]).encode(),
                 write_to=str(OUT / "wattamax-og.png"))
print(OUT / "wattamax-og.png")
