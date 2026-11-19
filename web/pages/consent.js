import LegalDocLayout from "../components/LegalDocLayout";
import PdWithdrawalForm from "../components/PdWithdrawalForm";
import { CONSENT_META, consentSections } from "../lib/legalDocs";

export default function ConsentPage() {
  return (
    <LegalDocLayout meta={CONSENT_META} sections={consentSections()}>
      <PdWithdrawalForm />
    </LegalDocLayout>
  );
}
