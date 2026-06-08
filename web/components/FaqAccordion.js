import { useCallback, useState } from "react";

/**
 * @param {{ items: { id?: number, question: string, answer: string }[] }} props
 */
export default function FaqAccordion({ items }) {
  const [openId, setOpenId] = useState(null);

  const toggle = useCallback((id) => {
    setOpenId((prev) => (prev === id ? null : id));
  }, []);

  if (!items?.length) {
    return <p className="muted">Пока нет опубликованных вопросов.</p>;
  }

  return (
    <div className="faq-accordion" role="list">
      {items.map((item, index) => {
        const id = item.id ?? index;
        const isOpen = openId === id;
        const panelId = `faq-panel-${id}`;
        const buttonId = `faq-trigger-${id}`;

        return (
          <article key={id} className="faq-accordion__item" role="listitem">
            <button
              type="button"
              id={buttonId}
              className={`faq-accordion__trigger${isOpen ? " is-open" : ""}`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(id)}
            >
              <span className="faq-accordion__question">{item.question}</span>
              <span className="faq-accordion__chevron" aria-hidden />
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className={`faq-accordion__panel${isOpen ? " is-open" : ""}`}
              hidden={!isOpen}
            >
              <p className="faq-accordion__answer">{item.answer}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
