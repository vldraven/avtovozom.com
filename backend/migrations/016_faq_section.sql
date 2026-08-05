-- Раздел FAQ для фильтрации на сайте и в админке.

ALTER TABLE faq_items ADD COLUMN IF NOT EXISTS section VARCHAR(32) NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS ix_faq_items_section ON faq_items (section);

-- Классификация существующих записей по тексту (один раз при миграции).
UPDATE faq_items
SET section = CASE
  WHEN question ~* 'китай|китае|китая|юан|che168|cny|из китая' OR answer ~* 'китай|китае|китая|юан|che168|cny|из китая' THEN 'china'
  WHEN question ~* 'коре|hyundai|kia|genesis|из кореи' OR answer ~* 'коре|hyundai|kia|genesis|из кореи' THEN 'korea'
  WHEN question ~* 'тамож|растамож|утиль|эптс|брокер|пошлин' OR answer ~* 'тамож|растамож|утиль|эптс|брокер|пошлин' THEN 'customs'
  WHEN question ~* 'оплат|договор|предоплат|реквизит|валют|счёт|счет' OR answer ~* 'оплат|договор|предоплат|реквизит|валют|счёт|счет' THEN 'payment'
  WHEN question ~* 'гарант|сервис|битый|проверк|осмотр|диагност|отчёт|отчет' OR answer ~* 'гарант|сервис|битый|проверк|осмотр|диагност|отчёт|отчет' THEN 'warranty'
  ELSE 'general'
END
WHERE section = 'general';
