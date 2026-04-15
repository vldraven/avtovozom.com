#!/usr/bin/env python3
"""
Чтение CSV коэффициентов утильсбора (колонки «Ставка» для 0–3 и 3–5 лет) и вывод JSON
для вставки в админку (util_ice_power_stairs / util_ev_power_stairs с under_3 / from_3).

Файлы в корне проекта:
  Коэффициенты УС для физлиц.csv
  Коэффициенты УС для юридических лиц.csv

Пример:
  python3 scripts/import_util_coefficients_csv.py \\
     --input "Коэффициенты УС для физлиц.csv" \\
     --schedule-key 2026-01 --individual \\
     -o /tmp/util_individual.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


def norm_num(s: str) -> float | None:
    if not s:
        return None
    s = str(s).replace("\ufeff", "").strip().strip('"')
    s = s.replace("\u00a0", "").replace(" ", "")
    s = re.sub(r",+", ",", s)
    s = s.replace(",", ".")
    if not s or s == ".":
        return None
    return float(s)


def parse_ls_upper(ls: str) -> int:
    ls = (ls or "").strip().lower().replace("\u00a0", " ")
    ls = re.sub(r",+", ",", ls)
    if not ls:
        return 999_999
    if ls.startswith("до "):
        rest = ls[3:].strip().replace(",", ".")
        try:
            return int(round(float(rest.split()[0])))
        except (ValueError, IndexError):
            return 999_999
    if ls.startswith("от ") or ls.startswith("более "):
        return 999_999
    if "-" in ls:
        parts = re.split(r"[-–]", ls, maxsplit=1)
        right = parts[-1].strip().replace(",", ".").replace(" ", "")
        try:
            return int(round(float(right)))
        except ValueError:
            return 999_999
    return 999_999


def ice_band_from_section_line(cell0: str) -> str | None:
    sl = cell0.lower().replace("ъ", "ь")
    if "3.5" in sl and "выше" in sl:
        return "3501"
    if re.search(r"3[.,]0\s*[-–]\s*3[.,]5", sl):
        return "3500"
    if re.search(r"2[.,]0\s*[-–]\s*3[.,]0", sl):
        return "3000"
    if re.search(r"1[.,]0\s*[-–]\s*2[.,]0", sl):
        return "2000"
    return None


def split_row(line: str) -> list[str]:
    parts = line.rstrip("\n\r").split(";")
    return [p.strip().strip('"') for p in parts]


def detect_k_columns(header_cells: list[str]) -> tuple[int, int] | None:
    """
    Возвращает индексы колонок K для 0-3 и 3-5 лет.
    Поддерживает:
      - старый формат: ...; Ставка; 0-3 лет; Ставка; 3-5 лет
      - новый формат: ...; Ставка 0-3; Ставка 3-5
    """
    if not header_cells:
        return None
    lowered = [c.lower().replace("ё", "е").strip() for c in header_cells]
    i_u3: int | None = None
    i_o3: int | None = None
    for i, c in enumerate(lowered):
        if i_u3 is None and ("0-3" in c or "0–3" in c):
            # В старом формате рядом слева стоит "Ставка"
            i_u3 = i - 1 if i > 0 and "ставка" in lowered[i - 1] else i
        if i_o3 is None and ("3-5" in c or "3–5" in c):
            i_o3 = i - 1 if i > 0 and "ставка" in lowered[i - 1] else i
    if i_u3 is None or i_o3 is None:
        return None
    return int(i_u3), int(i_o3)


def parse_util_csv(path: Path) -> tuple[list[list[Any]], list[list[Any]], dict[str, list[list[Any]]], dict[str, list[list[Any]]]]:
    text = path.read_text(encoding="utf-8-sig")
    ev_u3: list[list[Any]] = []
    ev_o3: list[list[Any]] = []
    ice_u3: dict[str, list[list[Any]]] = {}
    ice_o3: dict[str, list[list[Any]]] = {}
    current: str | None = None
    k_col_u3 = 2
    k_col_o3 = 4

    for raw in text.splitlines():
        cells = split_row(raw)
        if not any(x.strip() for x in cells):
            continue
        c0 = (cells[0] or "").strip()
        cl = c0.lower()
        if cl.startswith("квт"):
            detected = detect_k_columns(cells)
            if detected:
                k_col_u3, k_col_o3 = detected
            continue
        if "ев " in cl or cl.startswith("ev "):
            current = "ev"
            continue
        band = ice_band_from_section_line(c0)
        if band:
            current = f"ice:{band}"
            ice_u3.setdefault(band, [])
            ice_o3.setdefault(band, [])
            continue
        if current is None:
            continue
        if len(cells) <= max(k_col_u3, k_col_o3):
            continue
        k_u3, k_o3 = norm_num(cells[k_col_u3]), norm_num(cells[k_col_o3])
        if k_u3 is None or k_o3 is None:
            continue
        hp = parse_ls_upper(cells[1])
        row_u3 = [hp, round(k_u3, 6)]
        row_o3 = [hp, round(k_o3, 6)]

        if current == "ev":
            ev_u3.append(row_u3)
            ev_o3.append(row_o3)
        elif current.startswith("ice:"):
            b = current.split(":", 1)[1]
            ice_u3.setdefault(b, []).append(row_u3)
            ice_o3.setdefault(b, []).append(row_o3)

    def sort_stairs(rows: list[list[Any]]) -> list[list[Any]]:
        return sorted(rows, key=lambda r: int(r[0]))

    ev_u3 = sort_stairs(ev_u3)
    ev_o3 = sort_stairs(ev_o3)
    for b in ice_u3:
        ice_u3[b] = sort_stairs(ice_u3[b])
        ice_o3[b] = sort_stairs(ice_o3[b])
    return ev_u3, ev_o3, ice_u3, ice_o3


def build_payload(
    *,
    schedule_key: str,
    individual: bool,
    ev_u3: list[list[Any]],
    ev_o3: list[list[Any]],
    ice_u3: dict[str, list[list[Any]]],
    ice_o3: dict[str, list[list[Any]]],
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "version": 1,
        "util_ice_coeff_schedule": schedule_key,
        "util_recycling_base_rub": 20_000,
        "util_ice_power_stairs": {
            schedule_key: {
                "under_3": {k: v for k, v in ice_u3.items() if v},
                "from_3": {k: v for k, v in ice_o3.items() if v},
            }
        },
        "util_ev_power_stairs": {schedule_key: {"under_3": ev_u3, "from_3": ev_o3}},
    }
    if individual:
        out["description"] = (
            "Из CSV (0–3 / 3–5 лет). Полосы только из файла; отсутствующие объёмы подставятся из встроенного графика при расчёте."
        )
        out["util_hp_threshold"] = 160
        out["util_under_3_le_hp"] = 3400
        out["util_over_3_le_hp"] = 5200
        out["util_ev_preferential_hp_max"] = 80
    else:
        out["description"] = "Из CSV (0–3 / 3–5 лет) для юрлица."
        out["util_electric_coeff_schedule"] = schedule_key
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", "-i", type=Path, required=True, help="Путь к CSV")
    ap.add_argument("--schedule-key", default="2026-01", help="Ключ расписания в JSON")
    ap.add_argument("--individual", action="store_true", help="Поля льгот физлица")
    ap.add_argument("-o", "--output", type=Path, help="Записать JSON в файл")
    args = ap.parse_args()
    if not args.input.is_file():
        print(f"Нет файла: {args.input}", file=sys.stderr)
        return 1

    ev_u3, ev_o3, ice_u3, ice_o3 = parse_util_csv(args.input)
    payload = build_payload(
        schedule_key=args.schedule_key,
        individual=args.individual,
        ev_u3=ev_u3,
        ev_o3=ev_o3,
        ice_u3=ice_u3,
        ice_o3=ice_o3,
    )
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(raw, encoding="utf-8")
        print(f"Записано: {args.output}", file=sys.stderr)
    else:
        print(raw)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
