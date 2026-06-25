/**
 * Файл-подтверждение ключа IndexNow.
 * Поисковики (Яндекс/Bing) скачивают его, чтобы убедиться, что мы владеем доменом.
 * Содержимое — ровно строка ключа из INDEXNOW_KEY (тот же ключ задан в backend).
 */
export async function getServerSideProps({ res }) {
  const key = (process.env.INDEXNOW_KEY || "").trim();

  if (!key) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return { props: {} };
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.write(key);
  res.end();

  return { props: {} };
}

/** Пустой UI: ответ уже отправлен в getServerSideProps */
export default function IndexNowKeyTxtPage() {
  return null;
}
