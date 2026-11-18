import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = [
    (138, 'riva', 'Riva', 'staff'),
    (30, 'nova-s', 'Nova S', 'staff'),
    (2426, 'avance', 'Avance', 'staff'),
    (3409, 'estetica', 'Estetica', 'staff'),
    (5666, 'alto', 'Alto', 'executive'),
    (21722, 'corner', 'Corner', 'executive'),
    (8201, 'capital', 'Capital', 'executive'),
    (27191, 'bentley', 'Bentley', 'executive'),
]
PRODUCT_TYPES = {'tables', 'pedestals', 'cabinets', 'shelving'}
# These products are assigned to Capital in the source but have Bern in their titles.
AMBIGUOUS_PRODUCTS = {92594, 92619, 205657}


def main():
    catalog = json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))
    categories = {entry['id']: entry for entry in catalog['categories']}
    selected = {identifier for identifier, *_ in COLLECTIONS}

    def series_of(identifier):
        while identifier in categories:
            if identifier in selected:
                return identifier
            identifier = categories[identifier]['parent']
        return None

    membership = {identifier: series_of(identifier) for identifier in categories}
    products = {identifier: [] for identifier in selected}
    for row in catalog['items']:
        identifier, name, sku, price, upper, image, category_ids, _, _, _, kind, dimensions, role = row
        if role != 'furniture' or kind not in PRODUCT_TYPES or identifier in AMBIGUOUS_PRODUCTS:
            continue
        for series in {membership.get(category) for category in category_ids} - {None}:
            products[series].append({
                'id': identifier, 'name': name, 'sku': sku, 'price': price,
                'upper': upper, 'image': image, 'type': kind, 'dimensions': dimensions
            })

    series_data = [
        {'id': slug, 'name': name, 'segment': section, 'category': categories[identifier]['slug'],
         'items': products[identifier]}
        for identifier, slug, name, section in COLLECTIONS
    ]
    target = ROOT / 'collections-demo/collections.json'
    target.write_text(json.dumps(series_data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    for series in series_data:
        print(f"{series['name']}: {len(series['items'])}")


if __name__ == '__main__':
    main()
