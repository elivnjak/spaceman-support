import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler() {
  const filePath = path.resolve(process.cwd(), "data", "playbook-template.xlsx");
  const buffer = await readFile(filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="playbook-template.xlsx"',
    },
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/playbooks/template", GETHandler);
