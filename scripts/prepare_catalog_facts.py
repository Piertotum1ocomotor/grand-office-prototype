"""Build corrections and verified colour choices from the original product records."""
from collections import defaultdict
from decimal import Decimal
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / 'data'
UNIT = r'(?:мм|mm|см|cm|м|m)(?!(?![xх])[^\W\d_])'
NUMBER = r'\d{1,4}(?:[.,]\d+)?'
AXIS = rf'({NUMBER})(?:\s*[-–—]\s*({NUMBER}))?\s*({UNIT})?'
TRIPLE = re.compile(rf'(?<![\w.,]){AXIS}\s*[xх×*]\s*{AXIS}\s*[xх×*]\s*{AXIS}', re.I)
AXIS_VALUE = re.compile(AXIS, re.I)
SIZE_LABEL = re.compile(
    r'(?:габаритные\s+размеры(?:\s+изделия)?|(?:габариты|размеры)\s+изделия|габариты|размеры)'
    r'\s*(?:\((?:ш|г|в|\s|[xх×*.,]){2,18}\))?\s*[:—–-]\s*', re.I
)
AXIS_LABEL = re.compile(rf'(ширина|глубина|высота)(?:\s*[,(/]?\s*({UNIT})\)?)?', re.I)
MULTIPLIERS = {'мм': 1, 'mm': 1, 'см': 10, 'cm': 10, 'м': 1000, 'm': 1000}
MINIMUM = {
    'chairs': (250, 220, 350),
    'tables': (170, 170, 280),
    'cabinets': (170, 130, 220),
    'pedestals': (150, 140, 120),
    'shelving': (150, 120, 160),
    'sofas': (380, 270, 280),
}
PARTS = re.compile(
    r'\b(?:соединител[ьи]?[яь]?|[сc]оединительных элементов|перемычк[аи]|ручк[аи]|'
    r'проставк[аи]|полкодержател\w*|задн(?:яя|ий)\s+(?:стенка|щит)|'
    r'накладк[аи]|комплект\s+замок|ящик\s+для\s+зеркала|'
    r'стойка\s+(?:ms\s+hard|\(накладка\)))', re.I
)
FURNITURE = re.compile(
    r'\b(?:стол(?:ы|ик(?:и)?)?|кресл[оа]|стул(?:ья)?|шкаф[ы]?|гардероб[ы]?|'
    r'тумб[аы]|стеллаж[и]?|диван[ы]?|кровать|сейф[ы]?)\b', re.I
)


def measured(axis, default_unit):
    value, end, unit = axis
    if end:
        return None
    value = Decimal(value.replace(',', '.')) * MULTIPLIERS.get((unit or default_unit).casefold(), 1)
    return int(round(value)) if 0 < value <= 10000 else None


def parsed_sizes(name, description):
    for title in SIZE_LABEL.finditer(description):
        match = TRIPLE.match(description, title.end())
        if match:
            return match
    return TRIPLE.search(name)


def sizes_for(row, detail, kind):
    floor = MINIMUM.get(row[10], (1, 1, 1)) if kind == 'furniture' else (1, 1, 1)
    original = row[11] or [None, None, None]
    result = [value if value and minimum <= value <= 10000 else None
              for value, minimum in zip(original, floor)]
    axes_found = [None, None, None]
    match = parsed_sizes(row[1], detail[3])
    if match:
        piece = match.groups()
        with_units = any(piece[i] for i in (2, 5, 8))
        default = piece[-1] or 'мм'
        axes_found = [measured(piece[i:i+3], default) for i in (0, 3, 6)]
        for i, value in enumerate(axes_found):
            if value is not None and value >= floor[i]:
                result[i] = value
            elif with_units or (not value and piece[i*3+1]):
                result[i] = None
    labels = ['ширина', 'глубина', 'высота']
    for label, value in detail[1]:
        attr = AXIS_LABEL.fullmatch(label.casefold().strip())
        scalar = AXIS_VALUE.fullmatch(value.strip())
        if not attr or not scalar:
            continue
        i = labels.index(attr[1])
        mm = measured(scalar.groups(), attr[2] or 'мм')
        if mm is None or mm < floor[i]:
            continue
        confirmed = axes_found[i]
        if confirmed and confirmed >= floor[i] and abs(mm-confirmed) > 2:
            result[i] = None
        else:
            result[i] = max(mm, confirmed or 0)
    return result if any(value is not None for value in result) else None


def key_finish(value):
    return re.sub(r'\s*/\s*', '/', ' '.join(value.casefold().replace('ё', 'е').split()))


def finishes_for(detail):
    colours = []
    for attribute, value in detail[1]:
        if attribute.casefold().strip() in ('цвет', 'цвет изделия', 'отделка'):
            colours.extend(re.split(r'[,;]', value))
    colours = {key_finish(c): c.strip() for c in colours if c.strip()}
    options = detail[2]
    if options:
        return {key: opt[1] for opt in options if (key := key_finish(opt[1])) in colours}
    return colours if len(colours) == 1 else {}


def main():
    catalog = json.loads((ROOT / 'catalog.json').read_text())
    sections = json.loads((ROOT / 'collections.json').read_text())
    series = {item[0] for department in sections for group in department['groups'] for item in group['items']}
    parents = {category['id']: category['parent'] for category in catalog['categories']}
    shards = {}
    dimensions, parts, finish_keys, colour_labels = {}, [], {}, {}
    section_finishes = defaultdict(set)
    category_types = defaultdict(set)
    affected_types = set()
    for row in catalog['items']:
        identifier, name = row[:2]
        shard = identifier//1000
        if shard not in shards:
            shards[shard] = json.loads((ROOT / 'products' / f'{shard}.json').read_text())
        detail = shards[shard][str(identifier)]
        kind = row[12]
        part = PARTS.search(name)
        noun = FURNITURE.search(name)
        if kind == 'furniture' and part and (not noun or part.start() < noun.start()):
            parts.append(identifier)
            if row[10]:
                affected_types.add(row[10])
            kind = 'parts'
        parsed = sizes_for(row, detail, kind)
        if parsed != row[11]:
            dimensions[identifier] = parsed
        if kind != 'furniture':
            continue
        scopes = set()
        for ident in row[6]:
            while ident in parents and ident not in scopes:
                scopes.add(ident)
                ident = parents[ident]
        if row[10]:
            for ident in scopes:
                category_types[ident].add(row[10])
        collections = scopes & series
        if not collections:
            continue
        colours = finishes_for(detail)
        if colours:
            colour_labels.update(colours)
            finish_keys[identifier] = list(colours)
            for collection in collections:
                section_finishes[collection].update(colours)
    keys = sorted(colour_labels)
    index = {key: i for i, key in enumerate(keys)}
    encoded = {
        'dimensions': dimensions,
        'parts': parts,
        'affectedTypes': sorted(affected_types),
        'categoryTypes': {identifier: sorted(values) for identifier, values in sorted(category_types.items())},
        'finishes': [colour_labels[key] for key in keys],
        'productFinishes': {identifier: sorted(index[key] for key in values) for identifier, values in finish_keys.items()},
        'collectionFinishes': {identifier: sorted(index[key] for key in values) for identifier, values in section_finishes.items()},
    }
    (ROOT / 'catalog-facts.json').write_text(json.dumps(encoded, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(len(dimensions), 'dimension corrections;', len(parts), 'parts;', len(finish_keys), 'products with verified finishes')


if __name__ == '__main__':
    main()
