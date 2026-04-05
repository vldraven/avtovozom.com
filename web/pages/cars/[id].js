import { useRouter } from "next/router";

import CarDetailView from "../../components/CarDetailView";

export default function CarDetailsPage() {
  const router = useRouter();
  const { id } = router.query;

  if (!router.isReady) {
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

  const carId = Array.isArray(id) ? id[0] : id;
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
  return <CarDetailView carId={String(carId)} />;
}
