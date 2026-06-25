/** SEO title + meta description для страниц каталога. */

export function catalogSeoCopy({ unknownSlug, brand, model, generation }) {
  if (unknownSlug) {
    return {
      title: "Раздел не найден — avtovozom",
      desc: "Проверьте адрес каталога или вернитесь к списку марок.",
    };
  }
  if (generation && brand && model) {
    return {
      title: `${brand.name} ${model.name} ${generation.name} — авто из Китая | avtovozom`,
      desc: `${brand.name} ${model.name}, ${generation.name}: объявления с ценой в ¥ и расчётом под ключ до РФ. Выберите авто и закажите доставку.`,
    };
  }
  if (model && brand) {
    return {
      title: `${brand.name} ${model.name} — купить из Китая | avtovozom`,
      desc: `Каталог ${brand.name} ${model.name}: цены в ¥, пробег, комплектации. Доставка и растаможка под ключ — смотрите объявления онлайн.`,
    };
  }
  if (brand) {
    return {
      title: `${brand.name} из Китая — цены и доставка в РФ | avtovozom`,
      desc: `${brand.name} из Китая: модели, цены и доставка под ключ до России. Сравните объявления и закажите расчёт стоимости.`,
    };
  }
  return {
    title: "Каталог автомобилей из Китая | avtovozom",
    desc: "Каталог авто из Китая и Кореи: марки, модели, цены в ¥ и ориентир под ключ до РФ. Выберите автомобиль и оставьте заявку на расчёт.",
  };
}

export function catalogCanonicalPath(segments) {
  if (segments == null || segments.length === 0) return "/catalog";
  return `/catalog/${segments.join("/")}`;
}

export function catalogBreadcrumbItems({ brand, model, generation }) {
  const items = [{ label: "Главная", href: "/" }];
  if (brand) items.push({ label: brand.name, href: `/catalog/${brand.slug}` });
  if (model) items.push({ label: model.name, href: `/catalog/${brand.slug}/${model.slug}` });
  if (generation) {
    items.push({
      label: generation.name,
      href: `/catalog/${brand.slug}/${model.slug}/${generation.slug}`,
    });
  }
  return items;
}

/** Видимый SEO-текст под H1 на страницах каталога (уникальный контент для краулера). */
export function catalogPageIntro({ brand, model, generation, total }) {
  const countHint =
    typeof total === "number" && total > 0
      ? ` Сейчас в каталоге ${total} ${total === 1 ? "объявление" : total < 5 ? "объявления" : "объявлений"}.`
      : "";

  if (generation && brand && model) {
    return `${brand.name} ${model.name}, ${generation.name} — объявления с ценой в юанях и ориентиром под ключ до РФ. Сравните пробег, комплектации и оставьте заявку на расчёт доставки.${countHint}`;
  }
  if (model && brand) {
    return `Каталог ${brand.name} ${model.name} из Китая: актуальные предложения с фото, пробегом и ценой в ¥. Поможем с проверкой, покупкой и доставкой автомобиля до вашего города.${countHint}`;
  }
  if (brand) {
    return `${brand.name} из Китая — модели, цены и доставка под ключ до России. Выберите модель в каталоге или оставьте заявку на подбор.${countHint}`;
  }
  return `Каталог автомобилей из Китая и Кореи: марки, модели, цены в ¥ и ориентир стоимости под ключ до РФ. Выберите авто или закажите индивидуальный подбор.${countHint}`;
}
