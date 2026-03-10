import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ActionQuickEditModal,
  CauseEditor,
  CauseRuleBuilder,
  ValueDefinitionEditor,
} from "@/app/admin/playbooks/V2EditorControls";
import { PlaybookEditorPanel } from "@/app/admin/playbooks/PlaybookEditorPanel";
import type { PlaybookFormState } from "@/app/admin/playbooks/types";
import { usePlaybookAdminData } from "@/app/admin/playbooks/usePlaybookAdminData";
import type { CauseItem, EvidenceItem, EvidenceRule } from "@/lib/playbooks/schema";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/admin/playbooks",
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  HTMLInputElement: { value: dom.window.HTMLInputElement, configurable: true },
  HTMLSelectElement: { value: dom.window.HTMLSelectElement, configurable: true },
  HTMLTextAreaElement: { value: dom.window.HTMLTextAreaElement, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  Event: { value: dom.window.Event, configurable: true },
  MouseEvent: { value: dom.window.MouseEvent, configurable: true },
  KeyboardEvent: { value: dom.window.KeyboardEvent, configurable: true },
  getComputedStyle: { value: dom.window.getComputedStyle, configurable: true },
});

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

const htmlElementPrototype = dom.window.HTMLElement.prototype as typeof dom.window.HTMLElement.prototype & {
  attachEvent?: () => void;
  detachEvent?: () => void;
};

if (!htmlElementPrototype.attachEvent) {
  htmlElementPrototype.attachEvent = () => undefined;
}

if (!htmlElementPrototype.detachEvent) {
  htmlElementPrototype.detachEvent = () => undefined;
}

afterEach(() => {
  cleanup();
});

test("ValueDefinitionEditor shows linked action contract as read-only summary", () => {
  const evidence: EvidenceItem = {
    id: "ev_mode",
    description: "Mode",
    type: "confirmation",
    required: true,
    actionId: "check_mode",
  };

  const view = render(
    <ValueDefinitionEditor
      evidenceItem={evidence}
      actionsById={
        new Map([
          [
            "check_mode",
            {
              id: "check_mode",
              title: "Check mode",
              expectedInput: {
                type: "enum",
                options: ["Freeze", "Wash"],
              },
            },
          ],
        ])
      }
      onChange={() => undefined}
    />
  );

  assert.ok(view.getByText("Synced value contract"));
  assert.ok(view.getByText(/Check mode/));
  assert.ok(view.getByText(/Options: Freeze, Wash/));
  assert.equal(view.queryByLabelText("Value kind"), null);
});

test("ValueDefinitionEditor renders editable controls for unlinked evidence", () => {
  const evidence: EvidenceItem = {
    id: "ev_temp",
    description: "Temperature",
    type: "reading",
    required: true,
    valueDefinition: { kind: "number", unit: "C" },
  };
  const view = render(
    <ValueDefinitionEditor
      evidenceItem={evidence}
      actionsById={new Map()}
      onChange={() => undefined}
    />
  );

  assert.equal((view.getByLabelText("Unit") as HTMLInputElement).value, "C");
  assert.ok(view.getByLabelText("Unknown values (one per line)"));
  assert.ok(view.getByLabelText("Notes"));
});

test("CauseRuleBuilder limits photo evidence to exists and missing operators", () => {
  const view = render(
    <CauseRuleBuilder
      label="Support rules"
      rules={[
        {
          evidenceId: "ev_photo",
          operator: "exists",
        },
      ]}
      evidenceChecklist={[
        {
          id: "ev_photo",
          description: "Photo",
          type: "photo",
          required: false,
          valueDefinition: { kind: "photo" },
        },
      ]}
      actionsById={new Map()}
      onChange={() => undefined}
    />
  );

  const operatorSelect = view.getByLabelText("Operator");
  const options = Array.from(operatorSelect.querySelectorAll("option")).map((option) => option.value);
  assert.deepEqual(options, ["exists", "missing"]);
});

test("CauseRuleBuilder scrolls the newly added rule into view", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const originalScrollIntoView = dom.window.HTMLElement.prototype.scrollIntoView;
  let scrollCount = 0;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrollCount += 1;
  };

  function Wrapper() {
    const [rules, setRules] = React.useState<EvidenceRule[]>([
      { evidenceId: "ev_status", operator: "equals", values: ["Yes"] },
    ]);
    return (
      <CauseRuleBuilder
        label="Support rules"
        rules={rules}
        evidenceChecklist={[
          {
            id: "ev_status",
            description: "Status",
            type: "confirmation",
            required: false,
            valueDefinition: { kind: "enum", options: ["Yes", "No"] },
          },
        ]}
        actionsById={new Map()}
        onChange={setRules}
      />
    );
  }

  const view = render(<Wrapper />);
  await user.click(view.getByRole("button", { name: "Add rule" }));
  await waitFor(() => assert.ok(scrollCount > 0));

  dom.window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

test("CauseRuleBuilder adds a blank evidence selection instead of prepopulating the first evidence item", async () => {
  const user = userEvent.setup({ document: dom.window.document });

  function Wrapper() {
    const [rules, setRules] = React.useState<EvidenceRule[]>([]);
    return (
      <CauseRuleBuilder
        label="Support rules"
        rules={rules}
        evidenceChecklist={[
          {
            id: "ev_status",
            description: "Status",
            type: "confirmation",
            required: false,
            valueDefinition: { kind: "enum", options: ["Yes", "No"] },
          },
        ]}
        actionsById={new Map()}
        onChange={setRules}
      />
    );
  }

  const view = render(<Wrapper />);
  await user.click(view.getByRole("button", { name: "Add rule" }));
  await waitFor(() => assert.ok(view.getByText("Select evidence")));
  assert.equal(view.queryByText(/Selected: ev_status/), null);
});

test("CauseRuleBuilder keeps the selected evidence visible and offers clear selection", () => {
  const view = render(
    <CauseRuleBuilder
      label="Support rules"
      rules={[
        {
          evidenceId: "ev_cleaning_done",
          operator: "equals",
          values: ["Completed"],
        },
      ]}
      evidenceChecklist={[
        {
          id: "ev_cleaning_done",
          description: "Routine disassembly, cleaning and correct lubrication performed.",
          type: "confirmation",
          required: false,
          valueDefinition: { kind: "enum", options: ["Completed", "Skipped"] },
        },
      ]}
      actionsById={new Map()}
      onChange={() => undefined}
    />
  );

  assert.ok(view.getByText(/Selected:/));
  assert.ok(view.getByRole("button", { name: /ev_cleaning_done/i }));
  assert.ok(view.getByRole("button", { name: "Clear selection" }));
  assert.equal(view.queryByText("No matching options."), null);
});

test("ActionQuickEditModal blocks partial numeric ranges and submits full action fields", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "check_temp",
        title: "Check temperature",
        instructions: "Read the display",
        expectedInput: {
          type: "number",
          unit: "C",
          range: { min: -8, max: -4 },
        },
        safetyLevel: "caution",
        appliesToModels: ["6236A-C"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const saved: unknown[] = [];

  const view = render(
    <ActionQuickEditModal
      open
      mode="create"
      action={null}
      onClose={() => undefined}
      onSaved={(action) => saved.push(action)}
    />
  );

  await user.type(view.getByLabelText("Action ID"), "check_temp");
  await user.type(view.getByLabelText("Title"), "Check temperature");
  await user.type(view.getByLabelText("Instructions"), "Read the display");
  await user.selectOptions(view.getByLabelText("Expected input"), "number");
  await user.type(view.getByLabelText("Range min"), "-8");
  await user.click(view.getByRole("button", { name: "Create action" }));

  await waitFor(() => assert.ok(view.getByText("Number ranges require both min and max.")));
  assert.equal(requests.length, 0);

  await user.type(view.getByLabelText("Range max"), "-4");
  await user.type(view.getByLabelText("Unit"), "C");
  await user.selectOptions(view.getByLabelText("Safety level"), "caution");
  await user.type(view.getByLabelText("Applies to models"), "6236A-C");
  await user.click(view.getByRole("button", { name: "Create action" }));

  await waitFor(() => assert.equal(saved.length, 1));
  assert.deepEqual(requests[0], {
    id: "check_temp",
    title: "Check temperature",
    instructions: "Read the display",
    expectedInput: {
      type: "number",
      unit: "C",
      range: { min: -8, max: -4 },
    },
    safetyLevel: "caution",
    appliesToModels: ["6236A-C"],
  });

  globalThis.fetch = originalFetch;
});

test("PlaybookEditorPanel add cause appends a new blank cause row", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  function Wrapper() {
    const [form, setForm] = React.useState<PlaybookFormState>({
      labelId: "label_a",
      title: "Test playbook",
      enabled: true,
      productTypeIds: [],
      steps: [],
      symptoms: [],
      evidenceChecklist: [],
      candidateCauses: [],
      escalationTriggers: [],
    });

    return (
      <PlaybookEditorPanel
        editing={null}
        form={form}
        setForm={setForm}
        activeTab="causes"
        setActiveTab={() => undefined}
        labels={[{ id: "label_a", displayName: "Label A" }]}
        productTypes={[]}
        actionsList={[]}
        actionsById={new Map()}
        helpExpanded={false}
        toggleHelp={() => undefined}
        showSchemaVersion={false}
        getIssuesForPrefix={() => []}
        onOpenCreateActionModal={() => undefined}
        onOpenEditActionModal={() => undefined}
        onOpenCreateLabelModal={() => undefined}
        onOpenEditLabelModal={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
        saving={false}
        savedFeedback={false}
      />
    );
  }

  const view = render(<Wrapper />);
  assert.ok(view.getByText("No causes yet."));
  await user.click(view.getByRole("button", { name: "Add cause" }));
  await waitFor(() => assert.equal(view.getAllByLabelText("Cause ID").length, 1));
  await waitFor(() => assert.equal(dom.window.document.activeElement?.getAttribute("id"), view.getByLabelText("Cause ID").getAttribute("id")));
});

test("PlaybookEditorPanel keeps only one cause card expanded at a time", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const originalScrollIntoView = dom.window.HTMLElement.prototype.scrollIntoView;
  const scrollCalls: string[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrollCalls.push(this.textContent ?? "");
  };

  function Wrapper() {
    const [form, setForm] = React.useState<PlaybookFormState>({
      labelId: "label_a",
      title: "Test playbook",
      enabled: true,
      productTypeIds: [],
      steps: [],
      symptoms: [],
      evidenceChecklist: [],
      candidateCauses: [
        {
          id: "cause_one",
          cause: "First cause body",
          likelihood: "high",
          outcome: "resolution",
          supportMode: "all",
          rulingEvidence: ["ev_a"],
          supportRules: [],
          excludeRules: [],
        },
        {
          id: "cause_two",
          cause: "Second cause body",
          likelihood: "low",
          outcome: "escalation",
          supportMode: "any",
          rulingEvidence: [],
          supportRules: [],
          excludeRules: [],
        },
      ],
      escalationTriggers: [],
    });

    return (
      <PlaybookEditorPanel
        editing={null}
        form={form}
        setForm={setForm}
        activeTab="causes"
        setActiveTab={() => undefined}
        labels={[{ id: "label_a", displayName: "Label A" }]}
        productTypes={[]}
        actionsList={[]}
        actionsById={new Map()}
        helpExpanded={false}
        toggleHelp={() => undefined}
        showSchemaVersion={false}
        getIssuesForPrefix={() => []}
        onOpenCreateActionModal={() => undefined}
        onOpenEditActionModal={() => undefined}
        onOpenCreateLabelModal={() => undefined}
        onOpenEditLabelModal={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
        saving={false}
        savedFeedback={false}
      />
    );
  }

  const view = render(<Wrapper />);
  await waitFor(() => assert.equal(view.getAllByLabelText("Cause description").length, 1));
  await user.click(view.getByRole("button", { name: /cause_two/i }));
  await waitFor(() => assert.equal(view.getAllByLabelText("Cause description").length, 1));
  assert.ok(view.getByDisplayValue("Second cause body"));
  assert.equal(view.queryByDisplayValue("First cause body"), null);
  assert.ok(scrollCalls.some((text) => text.includes("cause_two")));

  dom.window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

test("PlaybookEditorPanel lets the current cause collapse closed", async () => {
  const user = userEvent.setup({ document: dom.window.document });

  function Wrapper() {
    const [form, setForm] = React.useState<PlaybookFormState>({
      labelId: "label_a",
      title: "Test playbook",
      enabled: true,
      productTypeIds: [],
      steps: [],
      symptoms: [],
      evidenceChecklist: [],
      candidateCauses: [
        {
          id: "cause_one",
          cause: "First cause body",
          likelihood: "high",
          outcome: "resolution",
          supportMode: "all",
          rulingEvidence: [],
          supportRules: [],
          excludeRules: [],
        },
      ],
      escalationTriggers: [],
    });

    return (
      <PlaybookEditorPanel
        editing={null}
        form={form}
        setForm={setForm}
        activeTab="causes"
        setActiveTab={() => undefined}
        labels={[{ id: "label_a", displayName: "Label A" }]}
        productTypes={[]}
        actionsList={[]}
        actionsById={new Map()}
        helpExpanded={false}
        toggleHelp={() => undefined}
        showSchemaVersion={false}
        getIssuesForPrefix={() => []}
        onOpenCreateActionModal={() => undefined}
        onOpenEditActionModal={() => undefined}
        onOpenCreateLabelModal={() => undefined}
        onOpenEditLabelModal={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
        saving={false}
        savedFeedback={false}
      />
    );
  }

  const view = render(<Wrapper />);
  await waitFor(() => assert.ok(view.getByLabelText("Cause description")));
  await user.click(view.getByRole("button", { name: /collapse cause_one/i }));
  await waitFor(() => assert.equal(view.queryByLabelText("Cause description"), null));
});

test("PlaybookEditorPanel collapsed cause headers show badges and counts", () => {
  const form: PlaybookFormState = {
    labelId: "label_a",
    title: "Test playbook",
    enabled: true,
    productTypeIds: [],
    steps: [],
    symptoms: [],
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_demo",
        cause: "Collapsed summary text",
        likelihood: "high",
        outcome: "resolution",
        supportMode: "all",
        rulingEvidence: ["ev_a", "ev_b"],
        supportRules: [{ evidenceId: "ev_a", operator: "exists" }],
        excludeRules: [{ evidenceId: "ev_b", operator: "missing" }],
      },
    ],
    escalationTriggers: [],
  };

  const view = render(
    <PlaybookEditorPanel
      editing={null}
      form={form}
      setForm={() => undefined}
      activeTab="causes"
      setActiveTab={() => undefined}
      labels={[{ id: "label_a", displayName: "Label A" }]}
      productTypes={[]}
      actionsList={[]}
      actionsById={new Map()}
      helpExpanded={false}
      toggleHelp={() => undefined}
      showSchemaVersion={false}
      getIssuesForPrefix={() => []}
      onOpenCreateActionModal={() => undefined}
      onOpenEditActionModal={() => undefined}
      onOpenCreateLabelModal={() => undefined}
      onOpenEditLabelModal={() => undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
      saving={false}
      savedFeedback={false}
    />
  );

  assert.ok(view.getByText("2 ruling evidence"));
  assert.ok(view.getByText("1 support rules"));
  assert.ok(view.getByText("1 exclude rules"));
});

test("CauseEditor renders strongly distinct support and exclude sections", () => {
  const cause: CauseItem = {
    id: "cause_demo",
    cause: "Demo cause",
    likelihood: "medium",
    outcome: "resolution",
    supportMode: "all",
    rulingEvidence: [],
    supportRules: [],
    excludeRules: [],
  };

  const view = render(
    <CauseEditor
      cause={cause}
      evidenceChecklist={[]}
      actionsById={new Map()}
      onChange={() => undefined}
    />
  );

  const support = view.getByTestId("cause-rule-section-support");
  const exclude = view.getByTestId("cause-rule-section-exclude");
  assert.match(support.className, /bg-emerald/);
  assert.match(exclude.className, /bg-amber/);
  assert.ok(view.getByText("No support rules yet."));
  assert.ok(view.getByText("No exclude rules yet."));
});

test("usePlaybookAdminData exposes error and retry flow", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt += 1;
    if (attempt <= 4) {
      return new Response("boom", { status: 500 });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  function Probe() {
    const { loading, error, playbooks, reload } = usePlaybookAdminData();
    if (loading) return <p>loading</p>;
    if (error) {
      return (
        <div>
          <p>{error}</p>
          <button type="button" onClick={reload}>
            retry
          </button>
        </div>
      );
    }
    return <p>loaded:{playbooks.length}</p>;
  }

  const view = render(<Probe />);
  await waitFor(() => assert.ok(view.getByText("Failed to load labels.")));
  fireEvent.click(view.getByRole("button", { name: "retry" }));
  await waitFor(() => assert.ok(view.getByText("loaded:0")));

  globalThis.fetch = originalFetch;
});
