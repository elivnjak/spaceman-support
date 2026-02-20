"use client";

import AdminPlaybooksPage from "../page";
import { useParams } from "next/navigation";

export default function AdminPlaybookEditPage() {
  const params = useParams<{ id: string }>();
  return <AdminPlaybooksPage focusPlaybookId={params.id} dedicatedMode />;
}
