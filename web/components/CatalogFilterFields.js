import { useMemo } from "react";

import { FUEL_TYPE_OPTIONS, HP_TO_OPTIONS } from "../lib/catalogFilters";
import SiteSelectDropdown from "./SiteSelectDropdown";

const PRICE_SLIDER_MIN = 500_000;
const PRICE_SLIDER_MAX = 10_000_000;
const PRICE_SLIDER_STEP = 50_000;

function clampPrice(n) {
  return Math.min(PRICE_SLIDER_MAX, Math.max(PRICE_SLIDER_MIN, n));
}

function formatThousands(digits) {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Поля полного набора фильтров каталога — общее тело для мобильной шторки
 * (CatalogFilterSheet) и десктоп-сайдбара (CatalogFilterSidebar).
 */
export default function CatalogFilterFields({
  draft,
  onChangeDraft,
  brands = [],
  models = [],
  generations = [],
  rubFromDraft,
  setRubFromDraft,
  rubToDraft,
  setRubToDraft,
  showBrandModel = true,
}) {
  const patch = (partial) => onChangeDraft({ ...draft, ...partial });

  const sliderFrom = useMemo(
    () => clampPrice(rubFromDraft ? Number(rubFromDraft) : PRICE_SLIDER_MIN),
    [rubFromDraft]
  );
  const sliderTo = useMemo(
    () => clampPrice(rubToDraft ? Number(rubToDraft) : PRICE_SLIDER_MAX),
    [rubToDraft]
  );

  return (
    <>
      {showBrandModel ? (
        <>
          <div className="catalog-filter-sheet__field">
            <SiteSelectDropdown
              className="site-dropdown--block"
              label="Марка"
              placeholder="Любая"
              searchable
              value={draft.brandId ? String(draft.brandId) : ""}
              onChange={(v) => patch({ brandId: v ? Number(v) : null, modelId: null, generationId: null })}
              options={[
                { value: "", label: "Любая" },
                ...brands.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
            />
          </div>

          <div className="catalog-filter-sheet__field">
            <SiteSelectDropdown
              className="site-dropdown--block"
              label="Модель"
              placeholder={draft.brandId ? "Любая" : "Сначала марка"}
              searchable
              disabled={!draft.brandId}
              value={draft.modelId ? String(draft.modelId) : ""}
              onChange={(v) => patch({ modelId: v ? Number(v) : null })}
              options={[
                { value: "", label: "Любая" },
                ...models.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
            />
          </div>

          {draft.modelId && generations.length > 0 ? (
            <div className="catalog-filter-sheet__field">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="Поколение"
                placeholder="Любое"
                searchable
                value={draft.generationId ? String(draft.generationId) : ""}
                onChange={(v) => patch({ generationId: v ? Number(v) : null })}
                options={[
                  { value: "", label: "Любое" },
                  ...generations.map((g) => ({
                    value: String(g.id),
                    label: `${g.name}${g.listings_count > 0 ? ` · ${g.listings_count}` : ""}`,
                  })),
                ]}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="catalog-filter-sheet__field">
        <p className="catalog-filter-sheet__label">Цена под ключ, ₽</p>
        <div className="catalog-filter-sheet__range">
          <input
            className="input catalog-filter-sheet__price-input"
            inputMode="numeric"
            placeholder="от"
            value={formatThousands(rubFromDraft)}
            onChange={(e) => setRubFromDraft(e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="input catalog-filter-sheet__price-input"
            inputMode="numeric"
            placeholder="до"
            value={formatThousands(rubToDraft)}
            onChange={(e) => setRubToDraft(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
        <div className="catalog-price-slider">
          <input
            type="range"
            className="catalog-price-slider__input catalog-price-slider__input--from"
            min={PRICE_SLIDER_MIN}
            max={PRICE_SLIDER_MAX}
            step={PRICE_SLIDER_STEP}
            value={sliderFrom}
            onChange={(e) => {
              const v = Math.min(Number(e.target.value), sliderTo - PRICE_SLIDER_STEP);
              setRubFromDraft(String(v));
            }}
          />
          <input
            type="range"
            className="catalog-price-slider__input catalog-price-slider__input--to"
            min={PRICE_SLIDER_MIN}
            max={PRICE_SLIDER_MAX}
            step={PRICE_SLIDER_STEP}
            value={sliderTo}
            onChange={(e) => {
              const v = Math.max(Number(e.target.value), sliderFrom + PRICE_SLIDER_STEP);
              setRubToDraft(String(v));
            }}
          />
          <div className="catalog-price-slider__track">
            <div
              className="catalog-price-slider__track-fill"
              style={{
                left: `${((sliderFrom - PRICE_SLIDER_MIN) / (PRICE_SLIDER_MAX - PRICE_SLIDER_MIN)) * 100}%`,
                right: `${100 - ((sliderTo - PRICE_SLIDER_MIN) / (PRICE_SLIDER_MAX - PRICE_SLIDER_MIN)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="catalog-filter-sheet__field">
        <div className="catalog-filter-sheet__range">
          <label className="catalog-filter-sheet__mini-field">
            <span className="catalog-filter-sheet__label">Год от</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="от"
              value={draft.yearFrom ? String(draft.yearFrom) : ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                patch({ yearFrom: v ? Number(v) : null });
              }}
            />
          </label>
          <label className="catalog-filter-sheet__mini-field">
            <span className="catalog-filter-sheet__label">до</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="до"
              value={draft.yearTo ? String(draft.yearTo) : ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                patch({ yearTo: v ? Number(v) : null });
              }}
            />
          </label>
        </div>
      </div>

      <div className="catalog-filter-sheet__field">
        <SiteSelectDropdown
          className="site-dropdown--block"
          label="Мощность, л.с."
          placeholder="Любая"
          value={draft.hpTo ? String(draft.hpTo) : ""}
          onChange={(v) => patch({ hpTo: v ? Number(v) : null })}
          options={[{ value: "", label: "Любая" }, ...HP_TO_OPTIONS]}
        />
      </div>

      <div className="catalog-filter-sheet__field">
        <p className="catalog-filter-sheet__label">Тип топлива</p>
        <div className="catalog-segmented">
          {FUEL_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`catalog-segmented__opt${draft.fuelType === opt.value ? " catalog-segmented__opt--on" : ""}`}
              onClick={() => patch({ fuelType: draft.fuelType === opt.value ? null : opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

    </>
  );
}
