import { useCallback, useEffect, useMemo, useState } from "react";

const ICE_BANDS = [
  { key: "1000", label: "до 1000 см³" },
  { key: "2000", label: "1001–2000 см³" },
  { key: "3000", label: "2001–3000 см³" },
  { key: "3500", label: "3001–3500 см³" },
  { key: "3501", label: "свыше 3500 см³" },
];

function parseJson(raw) {
  const s = (raw || "").trim();
  if (!s) return { ok: true, data: null, error: null };
  try {
    const data = JSON.parse(s);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, data: null, error: "Ожидается JSON-объект." };
    }
    return { ok: true, data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: e.message || "Невалидный JSON" };
  }
}

function stringifyPayload(data) {
  return JSON.stringify(data, null, 2);
}

function isNestedIce(schedVal) {
  return (
    schedVal &&
    typeof schedVal === "object" &&
    !Array.isArray(schedVal) &&
    Object.prototype.hasOwnProperty.call(schedVal, "under_3") &&
    Object.prototype.hasOwnProperty.call(schedVal, "from_3") &&
    typeof schedVal.under_3 === "object" &&
    typeof schedVal.from_3 === "object"
  );
}

function isNestedEv(schedVal) {
  return (
    schedVal &&
    typeof schedVal === "object" &&
    !Array.isArray(schedVal) &&
    Object.prototype.hasOwnProperty.call(schedVal, "under_3") &&
    Object.prototype.hasOwnProperty.call(schedVal, "from_3") &&
    Array.isArray(schedVal.under_3) &&
    Array.isArray(schedVal.from_3)
  );
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Удаляет пустые полосы и пустые ступени, чтобы JSON не раздувался. */
function pruneIceBands(bands) {
  const out = {};
  for (const k of Object.keys(bands || {})) {
    const rows = bands[k];
    if (Array.isArray(rows) && rows.length) out[k] = rows;
  }
  return out;
}

function IceBandTable({ title, rows, onChange, columnLabel }) {
  const safe = Array.isArray(rows) ? rows : [];

  const updateRow = (idx, field, val) => {
    const next = safe.map((r, i) => {
      if (i !== idx) return [...r];
      const copy = [...r];
      const num = field === "hp" ? parseInt(String(val).replace(/\s/g, ""), 10) : parseFloat(String(val).replace(",", ".").replace(/\s/g, ""));
      if (field === "hp") copy[0] = Number.isFinite(num) ? num : 0;
      else copy[1] = Number.isFinite(num) ? num : 0;
      return copy;
    });
    onChange(next);
  };

  const addRow = () => {
    const lastHp = safe.length ? Number(safe[safe.length - 1][0]) : 100;
    onChange([...safe, [lastHp + 10, 0]]);
  };

  const removeRow = (idx) => {
    onChange(safe.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
          + строка
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="admin-util-table">
          <thead>
            <tr>
              <th>л.с. до</th>
              <th>{columnLabel}</th>
              <th style={{ width: 56 }} />
            </tr>
          </thead>
          <tbody>
            {safe.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted" style={{ padding: "0.5rem" }}>
                  нет строк
                </td>
              </tr>
            ) : (
              safe.map((r, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="number"
                      className="input input--table"
                      value={r[0]}
                      onChange={(e) => updateRow(idx, "hp", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input input--table"
                      value={r[1]}
                      onChange={(e) => updateRow(idx, "k", e.target.value)}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(idx)} title="Удалить">
                      ×
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EvStairsEditor({ rowsU3, rowsO3, onChangeU3, onChangeO3, nested }) {
  if (nested) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <IceBandTable title="0–3 лет" rows={rowsU3} onChange={onChangeU3} columnLabel="K" />
        <IceBandTable title="3–5 лет" rows={rowsO3} onChange={onChangeO3} columnLabel="K" />
      </div>
    );
  }
  return <IceBandTable title="По мощности" rows={rowsU3} onChange={onChangeU3} columnLabel="K" />;
}

export default function AdminUtilCoeffEditor({ value, onChange, mode }) {
  const [jsonError, setJsonError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [iceNested, setIceNested] = useState(true);
  const [evNested, setEvNested] = useState(true);

  const parsed = useMemo(() => parseJson(value), [value]);

  useEffect(() => {
    const p = parseJson(value);
    if (!p.ok || !p.data) return;
    const sched = p.data.util_ice_coeff_schedule || "2026-01";
    const iceVal = p.data.util_ice_power_stairs && p.data.util_ice_power_stairs[sched];
    setIceNested(!iceVal || isNestedIce(iceVal));
    const evSched = p.data.util_electric_coeff_schedule || sched;
    const evVal = p.data.util_ev_power_stairs && p.data.util_ev_power_stairs[evSched];
    setEvNested(!evVal || isNestedEv(evVal));
  }, [value]);

  const commit = useCallback(
    (data) => {
      setJsonError(null);
      try {
        onChange(stringifyPayload(data));
      } catch (e) {
        setJsonError(e.message || "Ошибка сериализации");
      }
    },
    [onChange]
  );

  const updateScalar = (key, val, num) => {
    if (!parsed.ok || !parsed.data) return;
    const next = deepClone(parsed.data);
    if (num) {
      const n = parseFloat(String(val).replace(",", "."));
      next[key] = Number.isFinite(n) ? n : next[key];
    } else {
      next[key] = val;
    }
    commit(next);
  };

  const setIceNestedMode = (nested) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const schedIce = data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ice_power_stairs) data.util_ice_power_stairs = {};
    let cur = data.util_ice_power_stairs[schedIce];
    if (nested) {
      if (!isNestedIce(cur)) {
        const flat = cur && typeof cur === "object" ? { ...cur } : {};
        data.util_ice_power_stairs[schedIce] = {
          under_3: JSON.parse(JSON.stringify(flat)),
          from_3: JSON.parse(JSON.stringify(flat)),
        };
      }
    } else {
      if (isNestedIce(cur)) {
        data.util_ice_power_stairs[schedIce] = JSON.parse(JSON.stringify(cur.under_3 || {}));
      }
    }
    setIceNested(nested);
    commit(data);
  };

  const setEvNestedMode = (nested) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const sched = data.util_electric_coeff_schedule || data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ev_power_stairs) data.util_ev_power_stairs = {};
    if (!data.util_ev_power_stairs[sched]) {
      data.util_ev_power_stairs[sched] = nested ? { under_3: [], from_3: [] } : [];
    }
    let cur = data.util_ev_power_stairs[sched];
    if (nested) {
      if (!isNestedEv(cur)) {
        const flat = Array.isArray(cur) ? [...cur] : [];
        data.util_ev_power_stairs[sched] = { under_3: [...flat], from_3: [...flat] };
      }
    } else {
      if (isNestedEv(cur)) {
        data.util_ev_power_stairs[sched] = [...(cur.under_3 || [])];
      }
    }
    setEvNested(nested);
    commit(data);
  };

  const updateIceBand = (bandKey, which, rows) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const schedIce = data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ice_power_stairs) data.util_ice_power_stairs = {};
    if (!data.util_ice_power_stairs[schedIce]) {
      data.util_ice_power_stairs[schedIce] = iceNested ? { under_3: {}, from_3: {} } : {};
    }
    const schedVal = data.util_ice_power_stairs[schedIce];
    if (isNestedIce(schedVal)) {
      if (which === "u3") schedVal.under_3[bandKey] = rows;
      else schedVal.from_3[bandKey] = rows;
    } else {
      schedVal[bandKey] = rows;
    }
    data.util_ice_power_stairs[schedIce] = isNestedIce(schedVal)
      ? {
          under_3: pruneIceBands(schedVal.under_3),
          from_3: pruneIceBands(schedVal.from_3),
        }
      : pruneIceBands(schedVal);
    commit(data);
  };

  const addIceBand = (bandKey) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const schedIce = data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ice_power_stairs) data.util_ice_power_stairs = {};
    if (!data.util_ice_power_stairs[schedIce]) {
      data.util_ice_power_stairs[schedIce] = iceNested ? { under_3: {}, from_3: {} } : {};
    }
    const schedVal = data.util_ice_power_stairs[schedIce];
    const template = [[160, 0]];
    if (isNestedIce(schedVal)) {
      if (!schedVal.under_3[bandKey]) schedVal.under_3[bandKey] = [...template];
      if (!schedVal.from_3[bandKey]) schedVal.from_3[bandKey] = [...template];
    } else {
      if (!schedVal[bandKey]) schedVal[bandKey] = [...template];
    }
    commit(data);
  };

  const removeIceBand = (bandKey) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const schedIce = data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ice_power_stairs?.[schedIce]) return;
    const schedVal = data.util_ice_power_stairs[schedIce];
    if (isNestedIce(schedVal)) {
      delete schedVal.under_3[bandKey];
      delete schedVal.from_3[bandKey];
    } else {
      delete schedVal[bandKey];
    }
    commit(data);
  };

  const updateEvStairs = (which, rows) => {
    if (!parsed.ok || !parsed.data) return;
    const data = deepClone(parsed.data);
    const sched = data.util_electric_coeff_schedule || data.util_ice_coeff_schedule || "2026-01";
    if (!data.util_ev_power_stairs) data.util_ev_power_stairs = {};
    if (!data.util_ev_power_stairs[sched]) {
      data.util_ev_power_stairs[sched] = evNested ? { under_3: [], from_3: [] } : [];
    }
    const evVal = data.util_ev_power_stairs[sched];
    if (isNestedEv(evVal)) {
      if (which === "u3") evVal.under_3 = rows;
      else evVal.from_3 = rows;
    } else {
      data.util_ev_power_stairs[sched] = rows;
    }
    commit(data);
  };

  if (!parsed.ok) {
    return (
      <div>
        <div className="alert alert--danger" style={{ marginBottom: "0.75rem" }}>
          JSON: {parsed.error}
        </div>
        <label className="form-label">Исправьте JSON</label>
        <textarea
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85rem" }}
        />
      </div>
    );
  }

  if (!parsed.data) {
    return (
      <p className="muted" style={{ marginBottom: 0 }}>
        Нет сохранённых коэффициентов. Нажмите «Подставить встроенные» над этим блоком или введите данные во вкладке JSON.
      </p>
    );
  }

  const data = parsed.data;
  const schedIce = data.util_ice_coeff_schedule || "2026-01";
  const schedEv = data.util_electric_coeff_schedule || schedIce;
  const iceSchedVal = data.util_ice_power_stairs[schedIce];
  const evSchedVal = data.util_ev_power_stairs[schedEv];

  const bandsPresent = new Set();
  if (iceSchedVal) {
    if (isNestedIce(iceSchedVal)) {
      Object.keys(iceSchedVal.under_3 || {}).forEach((k) => bandsPresent.add(k));
      Object.keys(iceSchedVal.from_3 || {}).forEach((k) => bandsPresent.add(k));
    } else {
      Object.keys(iceSchedVal).forEach((k) => bandsPresent.add(k));
    }
  }

  return (
    <div className="admin-util-editor">
      <div className="panel panel--flat" style={{ marginBottom: "1rem", padding: "0.75rem 0" }}>
        <h3 className="panel-heading-sm" style={{ marginTop: 0 }}>
          База и расписания
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.65rem" }}>
          <label className="form-label">
            Расписание таблиц
            <input
              className="input"
              value={data.util_ice_coeff_schedule ?? ""}
              onChange={(e) => updateScalar("util_ice_coeff_schedule", e.target.value, false)}
            />
          </label>
          <label className="form-label">
            База утильсбора, ₽
            <input
              type="number"
              className="input"
              value={data.util_recycling_base_rub ?? 20000}
              onChange={(e) => updateScalar("util_recycling_base_rub", e.target.value, true)}
            />
          </label>
          {mode === "individual" ? (
            <>
              <label className="form-label">
                Порог мощности ДВС, л.с.
                <input
                  type="number"
                  className="input"
                  value={data.util_hp_threshold ?? 160}
                  onChange={(e) => updateScalar("util_hp_threshold", e.target.value, true)}
                />
              </label>
              <label className="form-label">
                Льгота ДВС (до 3 лет), ₽
                <input
                  type="number"
                  className="input"
                  value={data.util_under_3_le_hp ?? 3400}
                  onChange={(e) => updateScalar("util_under_3_le_hp", e.target.value, true)}
                />
              </label>
              <label className="form-label">
                Льгота ДВС (старше), ₽
                <input
                  type="number"
                  className="input"
                  value={data.util_over_3_le_hp ?? 5200}
                  onChange={(e) => updateScalar("util_over_3_le_hp", e.target.value, true)}
                />
              </label>
              <label className="form-label">
                Порог льготы электро, л.с.
                <input
                  type="number"
                  className="input"
                  value={data.util_ev_preferential_hp_max ?? 80}
                  onChange={(e) => updateScalar("util_ev_preferential_hp_max", e.target.value, true)}
                />
              </label>
            </>
          ) : null}
          <label className="form-label">
            Расписание электро (если отличается)
            <input
              className="input"
              value={data.util_electric_coeff_schedule ?? data.util_ice_coeff_schedule ?? ""}
              onChange={(e) => updateScalar("util_electric_coeff_schedule", e.target.value, false)}
            />
          </label>
        </div>
      </div>

      <div className="panel panel--flat" style={{ marginBottom: "1rem", padding: "0.75rem 0" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <h3 className="panel-heading-sm" style={{ margin: 0 }}>
            Двигатель: объём и мощность («{schedIce}»)
          </h3>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.92rem" }}>
            <input type="checkbox" checked={iceNested} onChange={(e) => setIceNestedMode(e.target.checked)} />
            Колонки 0–3 и 3–5 лет
          </label>
        </div>
        <p className="muted" style={{ fontSize: "0.88rem", marginBottom: "0.65rem" }}>
          Полосы: до 1000 см³ … свыше 3500 см³.
        </p>
        <div style={{ marginBottom: "0.65rem" }}>
          <span className="muted" style={{ marginRight: 8, fontSize: "0.9rem" }}>Добавить:</span>
          {ICE_BANDS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginRight: 6, marginBottom: 6 }}
              disabled={bandsPresent.has(key)}
              onClick={() => addIceBand(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {ICE_BANDS.map(({ key, label }) => {
          if (!bandsPresent.has(key)) return null;
          const nested = iceNested && isNestedIce(iceSchedVal);
          const flat = !nested ? iceSchedVal?.[key] : null;
          const u3 = nested ? iceSchedVal?.under_3?.[key] : null;
          const o3 = nested ? iceSchedVal?.from_3?.[key] : null;
          return (
            <div key={key} style={{ border: "1px solid var(--color-border, #ddd)", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong>{label}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeIceBand(key)}>
                  Удалить полосу
                </button>
              </div>
              {nested ? (
                <div className="admin-util-editor__grid2">
                  <IceBandTable
                    title="0–3 лет"
                    rows={u3}
                    onChange={(rows) => updateIceBand(key, "u3", rows)}
                    columnLabel="K"
                  />
                  <IceBandTable
                    title="3–5 лет"
                    rows={o3}
                    onChange={(rows) => updateIceBand(key, "o3", rows)}
                    columnLabel="K"
                  />
                </div>
              ) : (
                <IceBandTable title="K" rows={flat} onChange={(rows) => updateIceBand(key, "flat", rows)} columnLabel="K" />
              )}
            </div>
          );
        })}
        {bandsPresent.size === 0 ? <p className="muted" style={{ fontSize: "0.9rem" }}>Нет полос — выберите объём выше.</p> : null}
        {!iceSchedVal ? (
          <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.88rem" }}>
            Нет данных для «{schedIce}» — проверьте поле «Расписание таблиц» или добавьте полосу.
          </p>
        ) : null}
      </div>

      <div className="panel panel--flat" style={{ marginBottom: "1rem", padding: "0.75rem 0" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <h3 className="panel-heading-sm" style={{ margin: 0 }}>
            Электромобили («{schedEv}»)
          </h3>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.92rem" }}>
            <input type="checkbox" checked={evNested} onChange={(e) => setEvNestedMode(e.target.checked)} />
            Колонки 0–3 и 3–5 лет
          </label>
        </div>
        <EvStairsEditor
          nested={evNested && isNestedEv(evSchedVal)}
          rowsU3={isNestedEv(evSchedVal) ? evSchedVal.under_3 : Array.isArray(evSchedVal) ? evSchedVal : []}
          rowsO3={isNestedEv(evSchedVal) ? evSchedVal.from_3 : []}
          onChangeU3={(rows) => updateEvStairs("u3", rows)}
          onChangeO3={(rows) => updateEvStairs("o3", rows)}
        />
      </div>

      {jsonError ? <div className="alert alert--danger">{jsonError}</div> : null}

      <button type="button" className="btn btn-secondary btn-sm" style={{ marginBottom: showRaw ? "0.5rem" : 0 }} onClick={() => setShowRaw(!showRaw)}>
        JSON
      </button>
      {showRaw ? (
        <label className="form-label">
          Сырой JSON
          <textarea
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={16}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85rem" }}
          />
        </label>
      ) : null}
    </div>
  );
}
