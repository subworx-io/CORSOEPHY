import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/impressum")({
  head: () => ({ meta: [{ title: "Impressum — Corso" }] }),
  component: () => <LegalPage title="Impressum" />,
});
