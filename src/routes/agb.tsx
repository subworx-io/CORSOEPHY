import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/agb")({
  head: () => ({ meta: [{ title: "AGB — Corso" }] }),
  component: () => <LegalPage title="AGB" />,
});
