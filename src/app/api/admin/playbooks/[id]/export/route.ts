import { NextResponse } from "next/server";
import { buildPlaybookWorkbookBuffer } from "@/lib/playbooks/workbook";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { buffer, fileName } = await buildPlaybookWorkbookBuffer(id);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/playbooks/[id]/export", GETHandler);
