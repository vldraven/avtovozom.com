import { getPublicSiteUrlFromRequest } from "../lib/publicSiteUrl";

export async function getServerSideProps({ req, res }) {
  const base = getPublicSiteUrlFromRequest(req);
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
