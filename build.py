"""Generates the pages: one <folder>/index.html per variant page, plus the landing page.

Pages are thin: they share the code in src/ and differ only in title, blurb and which
variants they offer. Add a page here after adding its variant to src/variants.js.

Usage: python3 build.py
"""
import html
import pathlib

ROOT = pathlib.Path(__file__).parent

# folder -> page. `variants` are keys of VARIANTS in src/variants.js; `summary` is the
# line shown on the landing page.
PAGES = {
    'los-alamos': {
        'title': 'Los Alamos Chess',
        'sub': '6×6 chess without bishops, for two players, browser to browser.',
        'summary': '6×6, no bishops',
        'variants': ['losalamos'],
    },
    'cylinder': {
        'title': 'Cylinder Chess',
        'sub': 'Classic 8×8 chess on a board rolled into a cylinder: the a- and h-files are joined.',
        'summary': 'classic 8×8 with the a- and h-files joined',
        'variants': ['cylinder'],
    },
    'random-swap': {
        'title': 'Random Swap Chess',
        'sub': 'Classic 8×8 chess, except the piece you move swaps type with another of your pieces at random.',
        'summary': 'classic 8×8, the piece you move swaps type with another of yours',
        'variants': ['randomswap'],
    },
}


def fill(template, values):
    for key, value in values.items():
        assert template.count(key) >= 1, key
        template = template.replace(key, html.escape(value))
    return template


def main():
    page_tpl = (ROOT / 'src/page.tpl.html').read_text()
    for folder, page in PAGES.items():
        out = ROOT / folder / 'index.html'
        out.parent.mkdir(exist_ok=True)
        out.write_text(fill(page_tpl, {
            '__TITLE__': page['title'], '__SUB__': page['sub'], '__VARIANTS__': ','.join(page['variants']),
        }))
        print('built', out.relative_to(ROOT))

    links = '\n'.join(
        f'    <li><a href="{folder}/">{html.escape(page["title"])}</a> — {html.escape(page["summary"])}</li>'
        for folder, page in PAGES.items())
    home = (ROOT / 'src/home.tpl.html').read_text().replace('__LINKS__', links)
    (ROOT / 'index.html').write_text(home)
    print('built index.html')


if __name__ == '__main__':
    main()
