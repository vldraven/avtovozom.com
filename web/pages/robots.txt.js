function getSiteUrlServer() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (raw) return raw;
  return "http://localhost:3000";
}

export async function getServerSideProps({ res }) {
  const base = getSiteUrlServer();
  const body = `User-agent: *
Allow: /

# Личные кабинеты и служебные разделы
Disallow: /auth
Disallow: /profile
Disallow: /messages
Disallow: /staff/

Sitemap: ${base}/sitemap.xml
`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.write(body);
  res.end();

  return { props: {} };
}

/** Пустой UI: ответ уже отправлен в getServerSideProps */
export default function RobotsTxtPage() {
  return null;
}
