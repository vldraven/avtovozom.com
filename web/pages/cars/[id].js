import { useRouter } from "next/router";

import { publicCarHref } from "../../lib/carRoutes";
import CarDetailView from "../../components/CarDetailView";
import { getServerApiBase } from "../../lib/serverApiUrl";

export async function getServerSideProps({ params }) {
  const carId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  if (!carId || !/^\d+$/.test(String(carId))) {
    return { notFound: true };
  }
  const api = getServerApiBase();
  try {
    const res = await fetch(`${api}/cars/${carId}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { notFound: true };
    const car = await res.json();
    const canonicalPath = publicCarHref(car);
    // SEO: один URL в индексе — /cars/{id} только редирект на /catalog/.../id.
    if (canonicalPath.startsWith("/catalog/")) {
      return { redirect: { destination: canonicalPath, permanent: true } };
    }
    return { props: { initialCar: car } };
  } catch {
    return { notFound: true };
  }
}

export default function CarDetailsPage({ initialCar = null }) {
  const router = useRouter();
  const rawId = router.query.id;
  const carIdFromRouter =
    rawId == null ? null : String(Array.isArray(rawId) ? rawId[0] : rawId);
  const carId =
    carIdFromRouter || (initialCar?.id != null ? String(initialCar.id) : null);
  const ssrReady = Boolean(initialCar) || router.isReady;

  if (!ssrReady) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      </div>
    );
  }

  if (!carId) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Некорректная ссылка.</p>
          </div>
        </main>
      </div>
    );
  }

  return <CarDetailView carId={carId} initialCar={initialCar} />;
}
