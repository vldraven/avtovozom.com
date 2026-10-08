import LegalDocLayout from "../components/LegalDocLayout";
import { PRIVACY_META, privacySections } from "../lib/legalDocs";

export default function PrivacyPage() {
  return <LegalDocLayout meta={PRIVACY_META} sections={privacySections()} />;
}
