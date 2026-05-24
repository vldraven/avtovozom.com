import { TELEGRAM_CHANNEL_URL } from "../lib/telegramChannel";
import TelegramChannelIcon from "./TelegramChannelIcon";

export default function TelegramChannelHeaderLink() {
  return (
    <a
      href={TELEGRAM_CHANNEL_URL}
      className="site-header-telegram"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Telegram-канал avtovozom"
      title="Telegram-канал"
    >
      <TelegramChannelIcon size={18} />
    </a>
  );
}
