import { useEffect, useState } from "react";

import { EMPTY_CATALOG_FILTERS } from "../lib/catalogFilters";
import CatalogFilterFields from "./CatalogFilterFields";

/**
 * Полная шторка «Фильтры» — все параметры сразу (макет 25а).
 * Показывается только на мобайле/планшете (≥1024px — постоянный сайдбар CatalogFilterSidebar).
 */
export default function CatalogFilterSheet({
  open,
  onClose,
  brands = [],
  models = [],
  generations = [],
  draft,
  onChangeDraft,
  onApply,
}) {
  const [rubFromDraft, setRubFromDraft] = useState("");
  const [rubToDraft, setRubToDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    setRubFromDraft(draft.rubFrom ? String(Math.round(draft.rubFrom)) : "");
    setRubToDraft(draft.rubTo ? String(Math.round(draft.rubTo)) : "");
  }, [open, draft.rubFrom, draft.rubTo]);

  if (!open) return null;

  function resetAll() {
    onChangeDraft(EMPTY_CATALOG_FILTERS);
    setRubFromDraft("");
    setRubToDraft("");
  }

  function submit() {
    const rf = rubFromDraft ? Number(rubFromDraft) : null;
    const rt = rubToDraft ? Number(rubToDraft) : null;
    const next = { ...draft, rubFrom: rf, rubTo: rt };
    onApply(next);
    onClose();
  }

  return (
    <div
      className="catalog-filter-sheet-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="catalog-filter-sheet" role="dialog" aria-modal="true" aria-label="Фильтры">
        <div className="catalog-filter-sheet__head">
          <h2 className="catalog-filter-sheet__title">Фильтры</h2>
          <button type="button" className="catalog-filter-sheet__reset" onClick={resetAll}>
            Сбросить всё
          </button>
          <button
            type="button"
            className="catalog-filter-sheet__close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="catalog-filter-sheet__body">
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

        <div className="catalog-filter-sheet__foot">
          <button type="button" className="btn btn-primary catalog-filter-sheet__submit" onClick={submit}>
            Показать авто
          </button>
        </div>
      </div>
    </div>
  );
}
