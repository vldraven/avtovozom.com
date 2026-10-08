import LegalDocLayout from "../components/LegalDocLayout";
import { TERMS_META, termsSections } from "../lib/legalDocs";

export default function TermsPage() {
  return <LegalDocLayout meta={TERMS_META} sections={termsSections()} />;
}
