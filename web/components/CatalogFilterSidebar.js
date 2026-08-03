import Link from "next/link";
import { useEffect, useState } from "react";

import { EMPTY_CATALOG_FILTERS } from "../lib/catalogFilters";
import CatalogFilterFields from "./CatalogFilterFields";

/**
 * Постоянно видимая панель фильтров на десктопе (макет 33).
 */
export default function CatalogFilterSidebar({
  draft,
  onChangeDraft,
  onApply,
  brands = [],
  models = [],
  generations = [],
  total,
}) {
  const [rubFromDraft, setRubFromDraft] = useState(draft.rubFrom ? String(Math.round(draft.rubFrom)) : "");
  const [rubToDraft, setRubToDraft] = useState(draft.rubTo ? String(Math.round(draft.rubTo)) : "");

  useEffect(() => {
    setRubFromDraft(draft.rubFrom ? String(Math.round(draft.rubFrom)) : "");
    setRubToDraft(draft.rubTo ? String(Math.round(draft.rubTo)) : "");
  }, [draft.rubFrom, draft.rubTo]);

  function resetAll() {
    onChangeDraft(EMPTY_CATALOG_FILTERS);
    setRubFromDraft("");
    setRubToDraft("");
    onApply(EMPTY_CATALOG_FILTERS);
  }

  function submit() {
    const rf = rubFromDraft ? Number(rubFromDraft) : null;
    const rt = rubToDraft ? Number(rubToDraft) : null;
    onApply({ ...draft, rubFrom: rf, rubTo: rt });
  }

  return (
    <div className="catalog-filter-sidebar">
      <div className="catalog-filter-sidebar__head">
        <p className="catalog-filter-sidebar__title">Фильтры</p>
        <button type="button" className="catalog-filter-sheet__reset" onClick={resetAll}>
          Сбросить
        </button>
      </div>

      <div className="catalog-filter-sidebar__body">
        <CatalogFilterFields
          draft={draft}
          onChangeDraft={onChangeDraft}
          brands={brands}
          models={models}
          generations={generations}
          rubFromDraft={rubFromDraft}
          setRubFromDraft={setRubFromDraft}
          rubToDraft={rubToDraft}
          setRubToDraft={setRubToDraft}
        />
      </div>

      <button type="button" className="btn btn-primary catalog-filter-sidebar__submit" onClick={submit}>
        {total ? `Показать ${Number(total).toLocaleString("ru-RU")} авто` : "Показать авто"}
      </button>

      <div className="catalog-filter-sidebar__promo">
        <p className="catalog-filter-sidebar__promo-title">Не нашли нужное?</p>
        <p className="catalog-filter-sidebar__promo-text">
          Оставьте заявку — подберём под бюджет и пришлём смету под ключ.
        </p>
        <Link href="/request-quote" className="btn btn-primary catalog-filter-sidebar__promo-btn">
          Заявка на подбор
        </Link>
      </div>
    </div>
  );
}
