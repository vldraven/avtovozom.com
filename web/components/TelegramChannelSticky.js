import { TELEGRAM_CHANNEL_CTA, TELEGRAM_CHANNEL_URL } from "../lib/telegramChannel";
import TelegramChannelIcon from "./TelegramChannelIcon";

export default function TelegramChannelSticky() {
  return (
    <a
      href={TELEGRAM_CHANNEL_URL}
      className="telegram-channel-sticky"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="telegram-channel-sticky__icon" aria-hidden>
        <TelegramChannelIcon size={22} />
      </span>
      <span className="telegram-channel-sticky__text">{TELEGRAM_CHANNEL_CTA}</span>
    </a>
  );
}
