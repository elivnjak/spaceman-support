import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AdminImagesPage() {
  return (
    <div>
      <PageHeader title="Reference images" />
      <Card>
        <p className="text-sm text-muted">
          This section is no longer in active use.
        </p>
        <p className="mt-2 text-sm text-muted">
          Manage support knowledge in{" "}
          <Link href="/admin/docs" className="underline hover:text-ink">
            Documents
          </Link>{" "}
          and{" "}
          <Link href="/admin/labels" className="underline hover:text-ink">
            Labels
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
