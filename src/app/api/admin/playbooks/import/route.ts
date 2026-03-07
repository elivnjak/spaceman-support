import { NextResponse } from "next/server";
import { importPlaybookWorkbookBuffer } from "@/lib/playbooks/workbook";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function POSTHandler(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file uploaded. Attach an .xlsx file as the 'file' field." },
        { status: 400 },
      );
    }

    const imported = await importPlaybookWorkbookBuffer(await file.arrayBuffer());
    if (!imported.ok) {
      return NextResponse.json({ error: imported.errors.join("\n") }, { status: 400 });
    }

    return NextResponse.json(imported.saved);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiRouteErrorLogging("/api/admin/playbooks/import", POSTHandler);
