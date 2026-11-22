"""Builds each variant page into its own folder as a single self-contained index.html.
Usage: python3 build.py"""
import json, pathlib

ROOT = pathlib.Path(__file__).parent
# folder name -> page settings. `variants` are keys of VARIANTS in src/engine.js.
PAGES = {
    'los-alamos': {
        'title': 'Los Alamos Chess',
        'sub': '6×6 chess without bishops, for two players, browser to browser.',
        'variants': ['losalamos'],
    },
    'random-swap': {
        'title': 'Random Swap Chess',
        'sub': 'Classic 8×8 chess, except the piece you move swaps type with another of your pieces at random.',
        'variants': ['randomswap'],
    },
}

tpl = (ROOT / 'src/index.tpl.html').read_text()
code = {
    '/*__PEERJS__*/': (ROOT / 'vendor/peerjs-1.5.5.min.js').read_text(),
    '/*__ENGINE__*/': (ROOT / 'src/engine.js').read_text(),
    '/*__APP__*/': (ROOT / 'src/app.js').read_text(),
}
for folder, page in PAGES.items():
    html = tpl.replace('__TITLE__', page['title']).replace('__SUB__', page['sub'])
    html = html.replace('__VARIANTS__', json.dumps(page['variants']))
    for mark, src in code.items():
        assert '</script' not in src and html.count(mark) == 1, mark
        html = html.replace(mark, src)
    out = ROOT / folder / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print('built', out.relative_to(ROOT), len(html), 'bytes')
