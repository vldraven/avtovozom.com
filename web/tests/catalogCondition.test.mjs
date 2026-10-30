import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Import the existing browser module without changing the Next.js package module type.
const source = await readFile(new URL('../lib/catalogFilters.js', import.meta.url), 'utf8');
const f = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const condition of [true, false, null]) {
  test(`condition ${condition} survives URL/API round trip with other filters`, () => {
    const filters = { ...f.EMPTY_CATALOG_FILTERS, isNew: condition, yearFrom: 2025, brandId: 7 };
    const query = f.catalogFiltersToQuery(filters);
    const parsed = f.parseFiltersFromQuery(query);
    assert.equal(parsed.isNew, condition);
    assert.equal(parsed.yearFrom, 2025);
    assert.equal(parsed.brandId, 7);
    const api = f.appendFiltersToSearchParams(new URLSearchParams(), parsed);
    assert.equal(api.get('is_new'), condition == null ? null : String(condition));
    assert.equal(api.get('year_from'), '2025');
  });
}

test('false is active, has a separate cache key, and redirects legacy home links', () => {
  const all = f.parseFiltersFromQuery({});
  const used = f.parseFiltersFromQuery({ is_new: 'false' });
  assert.equal(f.hasActiveCatalogFilters(used), true);
  assert.equal(f.filtersAreEqual(all, used), false);
  assert.equal(f.homeHasListingQuery({ is_new: 'false' }), true);
  const keys = [{}, { is_new: 'true' }, { is_new: 'false' }].map(f.catalogFilterKeyFromQuery);
  assert.equal(new Set(keys).size, 3);
  assert.equal(f.hasActiveCatalogFilters(f.EMPTY_CATALOG_FILTERS), false);
  assert.equal(f.catalogFiltersToQuery(f.EMPTY_CATALOG_FILTERS).is_new, undefined);
});

test('invalid conditions fall back to all; repeated query uses first value', () => {
  assert.equal(f.parseFiltersFromQuery({ is_new: 'invalid' }).isNew, null);
  assert.equal(f.parseFiltersFromQuery({ is_new: ['false', 'true'] }).isNew, false);
});
