import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EMPTY_CATALOG_FILTERS } from "../lib/catalogFilters";
import CatalogFilterFields from "./CatalogFilterFields";

/**
 * Полная шторка «Фильтры» — все параметры сразу (макет 25а).
 * Показывается только на мобайле/планшете (≥901px — сайдбар CatalogFilterSidebar).
 *
 * Рендерится через portal в body: иначе на iOS Safari fixed ломается внутри
 * `.catalog-mobile-filters-row { overflow-x: auto }`.
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
  const [mounted, setMounted] = useState(false);
  const ignoreCloseUntilRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // iOS: тот же тап, что открыл шторку, может «провалиться» в overlay и сразу закрыть её.
    ignoreCloseUntilRef.current = Date.now() + 400;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRubFromDraft(draft.rubFrom ? String(Math.round(draft.rubFrom)) : "");
    setRubToDraft(draft.rubTo ? String(Math.round(draft.rubTo)) : "");
  }, [open, draft.rubFrom, draft.rubTo]);

  if (!open || !mounted || typeof document === "undefined") return null;

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

  function maybeCloseFromOverlay(e) {
    if (e.target !== e.currentTarget) return;
    if (Date.now() < ignoreCloseUntilRef.current) return;
    onClose();
  }

  return createPortal(
    <div className="catalog-filter-sheet-overlay" onClick={maybeCloseFromOverlay}>
      <div
        className="catalog-filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Фильтры"
        onClick={(e) => e.stopPropagation()}
      >
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
    </div>,
    document.body
  );
}
