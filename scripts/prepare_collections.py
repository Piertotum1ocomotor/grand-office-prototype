import argparse
from collections import Counter
from html import unescape
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://grand-office59.ru'
UPLOADS = ORIGIN + '/wp-content/uploads/'
SECTIONS = {
    28: ('Мебель для персонала', (29, 21819, 4312)),
    4812: ('Кабинеты руководителей', (4813, 5940, 4819)),
    5117: ('Переговорные', (22505, 22506, 22507)),
    9846: ('Ресепшен', (9846,)),
    11032: ('Мебель для гостиниц и отелей', (11032,)),
    10829: ('Офисные перегородки', (10829,)),
}
CLASS_NAMES = {
    29: 'Эконом', 21819: 'Бизнес', 4312: 'Премиум',
    4813: 'Эконом', 5940: 'Бизнес', 4819: 'Премиум',
    22505: 'Эконом', 22506: 'Бизнес', 22507: 'Премиум',
}
CATEGORY_COVER = re.compile(
    r'<a href="([^"]+)" class="category-image"[^>]*>\s*<img\b([^>]*)',
    re.I,
)


def category_page(category, categories, source_dir):
    if source_dir:
        return (source_dir / f'{category["id"]}.html').read_text(encoding='utf-8')
    slugs = []
    while category:
        slugs.insert(0, category['slug'])
        category = categories.get(category['parent'])
    url = ORIGIN + '/product-category/' + '/'.join(slugs) + '/'
    with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as response:
        return response.read().decode('utf-8')


def collect_entries(tier, categories, source_dir, counts, types):
    children = {unquote(c['slug']): c['id'] for c in categories.values() if c['parent'] == tier}
    page = category_page(categories[tier], categories, source_dir)
    result = {}
    for link, attrs in CATEGORY_COVER.findall(page):
        slug = unquote(urlsplit(unescape(link)).path.rstrip('/').rsplit('/', 1)[-1])
        identifier = children.get(slug)
        if identifier is None or identifier in result:
            continue
        image = re.search(r'\bsrc="([^"]+)"', attrs)
        image_url = unescape(image[1]) if image else ''
        cover = image_url.removeprefix(UPLOADS) if image_url.startswith(UPLOADS) else ''
        result[identifier] = [identifier, cover, counts[identifier], sorted(types.get(identifier, ()))]
    missing = children.values() - result.keys()
    if missing:
        raise ValueError(f'Категории с отсутствующими карточками в разделе {tier}: {sorted(missing)}')
    return list(result.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, help='Saved public category pages named by category ID')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))
    categories = {entry['id']: entry for entry in catalog['categories']}
    tiers = {tier for _, groups in SECTIONS.values() for tier in groups}
    candidates = {c['id'] for c in categories.values() if c['parent'] in tiers}
    counts = Counter()
    types = {}
    for row in catalog['items']:
        ancestry = set()
        for identifier in row[6]:
            while identifier in categories and identifier not in ancestry:
                ancestry.add(identifier)
                identifier = categories[identifier]['parent']
        for identifier in ancestry & candidates:
            counts[identifier] += 1
            if row[10] and row[12] == 'furniture':
                types.setdefault(identifier, set()).add(row[10])

    sections = [
        {'id': identifier, 'name': title, 'groups': [
            {'id': tier, 'label': CLASS_NAMES.get(tier, ''), 'items': collect_entries(
                tier, categories, args.source_dir, counts, types
            )} for tier in groups
        ]} for identifier, (title, groups) in SECTIONS.items()
    ]
    target = ROOT / 'data/collections.json'
    target.write_text(json.dumps(sections, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    for section in sections:
        print(section['name'], sum(len(group['items']) for group in section['groups']))


if __name__ == '__main__':
    main()
