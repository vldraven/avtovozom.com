import { useEffect } from "react";
import { useRouter } from "next/router";

/** Redirect legacy VK publish page → unified social publish. */
export default function PublishVkRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.id;
    const id = raw == null ? "" : String(Array.isArray(raw) ? raw[0] : raw).trim();
    if (id) router.replace(`/staff/publish-social/${id}`);
  }, [router]);
  return null;
}
