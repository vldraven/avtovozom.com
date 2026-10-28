import LeadForm from "./LeadForm";

const CHAT_TELEGRAM_URL = "https://t.me/clientsavtovozom";
const CHAT_MAX_URL =
  "https://max.ru/u/f9LHodD0cOKvUR81LIWDgPfStnerHFJffpjQ3VOvm9gFjiKYPzt2eTGW1QY";

/** Сетевой сбой fetch в браузере приходит как «Failed to fetch». */
export function chatSendErrorMessage(err, fallback = "Не удалось отправить") {
  const raw = String(err?.message || "").trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return "Нет связи с сервером. Попробуйте ещё раз чуть позже.";
  }
  return raw || fallback;
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#229ED9"
        d="M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.6 1.1 12c-1.1-.3-1.1-1.1.2-1.6L20.5 3c.9-.3 1.7.2 1.4 1.3Z"
      />
    </svg>
  );
}

function MaxBubbleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15.5v-10Z"
        stroke="#5b4cf0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Последний свой текст в переписке — для комментария заявки. */
export function latestOwnMessageText(messages, { guest = false, userId = null } = {}) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.message_type === "system" || message.message_type === "assistant") {
      continue;
    }
    const mine = guest ? message.sender_user_id == null : userId != null && message.sender_user_id === userId;
    if (!mine) continue;
    const text = String(message.text || "").trim();
    if (text) return text;
  }
  return "";
}

export function ChatQuickActions({ onConsult }) {
  return (
    <div className="chat-quick-actions" role="group" aria-label="Быстрые действия">
      <button
        type="button"
        className="chat-quick-actions__btn chat-quick-actions__btn--primary"
        onClick={onConsult}
      >
        <PhoneIcon />
        Консультация
      </button>
      <a
        className="chat-quick-actions__btn chat-quick-actions__btn--link"
        href={CHAT_TELEGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <TelegramIcon />
        Написать в Telegram
      </a>
      <a
        className="chat-quick-actions__btn chat-quick-actions__btn--link"
        href={CHAT_MAX_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MaxBubbleIcon />
        Написать в Max
      </a>
    </div>
  );
}

export function ChatConsultPanel({ initialComment = "", onBack }) {
  return (
    <div className="chat-consult">
      <button type="button" className="chat-consult__back" onClick={onBack}>
        <span className="chat-consult__back-mark" aria-hidden>
          ‹
        </span>
        Назад в чат
      </button>
      <div className="chat-consult__body">
        <LeadForm
          key={initialComment}
          id="chat-consult-lead"
          title="Консультация"
          lead="Опишите желаемый автомобиль — мы свяжемся и подготовим расчёт под ключ до РФ."
          initialComment={initialComment}
          className="chat-consult__form"
        />
      </div>
    </div>
  );
}
