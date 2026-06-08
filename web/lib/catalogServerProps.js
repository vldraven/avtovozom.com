import {
  buildCatalogCarsQuery,
  catalogFetchKey,
  isCarDetailSegments,
  resolveCatalogTree,
  segmentsFromSlugParam,
} from "./catalogResolve";
import { getServerApiBase } from "./serverApiUrl";

const VALID_SORTS = new Set(["date_desc", "date_asc", "price_asc", "price_desc"]);

export async function fetchCatalogPageProps({ params, query }) {
  const segments = segmentsFromSlugParam(params?.slug ?? null);

  if (isCarDetailSegments(segments)) {
    return {
      props: {
        initialPayload: {
          mode: "detail",
          segments,
          carId: String(segments[2]),
          pathBrandSlug: segments[0],
          pathModelSlug: segments[1],
        },
      },
    };
  }

  const rawSort = Array.isArray(query?.sort) ? query.sort[0] : query?.sort;
  const listSort =
    rawSort && VALID_SORTS.has(String(rawSort)) ? String(rawSort) : "date_desc";

  const api = getServerApiBase();
  let tree = [];
  try {
    const treeRes = await fetch(`${api}/catalog/tree`, {
      headers: { Accept: "application/json" },
    });
    if (treeRes.ok) tree = await treeRes.json();
  } catch {
    tree = [];
  }

  const resolved = resolveCatalogTree(segments, tree);
  let cars = [];
  let total = 0;

  const carsQuery = buildCatalogCarsQuery(resolved, listSort);
  if (carsQuery) {
    try {
      const carsRes = await fetch(`${api}/cars?${carsQuery.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (carsRes.ok) {
        const data = await carsRes.json();
        cars = data.items || [];
        total = Number(data.total) || 0;
      }
    } catch {
      cars = [];
      total = 0;
    }
  }

  return {
    props: {
      initialPayload: {
        mode: "list",
        segments,
        listSort,
        tree,
        cars,
        total,
        fetchKey: catalogFetchKey(segments, listSort),
      },
    },
  };
}
