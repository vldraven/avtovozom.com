/** JSON-LD FAQPage для /faq. */

export function faqPageJsonLd(items = []) {
  const published = (items || []).filter((item) => item?.question && item?.answer);
  if (!published.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: published.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
