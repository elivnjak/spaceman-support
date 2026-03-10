import test from "node:test";
import assert from "node:assert/strict";
import { GET as GETPlaybooks, POST as POSTPlaybooks } from "@/app/api/admin/playbooks/route";
import { PATCH as PATCHPlaybook, DELETE as DELETEPlaybook } from "@/app/api/admin/playbooks/[id]/route";

test("admin playbooks GET requires auth", async () => {
  const response = await GETPlaybooks(new Request("http://localhost/api/admin/playbooks"));
  assert.equal(response.status, 401);
});

test("admin playbooks POST requires auth", async () => {
  const response = await POSTPlaybooks(
    new Request("http://localhost/api/admin/playbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
  );
  assert.equal(response.status, 401);
});

test("admin playbook PATCH requires auth", async () => {
  const response = await PATCHPlaybook(
    new Request("http://localhost/api/admin/playbooks/test-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    { params: Promise.resolve({ id: "test-id" }) }
  );
  assert.equal(response.status, 401);
});

test("admin playbook DELETE requires auth", async () => {
  const response = await DELETEPlaybook(
    new Request("http://localhost/api/admin/playbooks/test-id", { method: "DELETE" }),
    { params: Promise.resolve({ id: "test-id" }) }
  );
  assert.equal(response.status, 401);
});
