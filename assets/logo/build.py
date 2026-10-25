"""Writes every Wattamax logo SVG into assets/."""
from pathlib import Path

from icon import icon
from wordmark import wordmark, tt_alone

OUT = Path(__file__).parent.parent

files = {"wattamax-tt.svg": tt_alone()}
files |= {f"wattamax-icon{suffix}.svg": svg for suffix, svg in icon().items()}
files |= {f"wattamax-wordmark{suffix}.svg": svg for suffix, svg in wordmark().items()}
for name, svg in files.items():
    (OUT / name).write_text(svg)
    print(OUT / name)
