import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Inline help (collapsible block shown on new/edit label forms)     */
/* ------------------------------------------------------------------ */

export const LABELS_FORM_HELP: ReactNode = (
  <>
    <p>
      A <strong>label</strong> is a stable issue category identifier (e.g.{" "}
      <code className="rounded bg-page px-1 py-0.5 text-xs">too_runny</code>,{" "}
      <code className="rounded bg-page px-1 py-0.5 text-xs">too_thick</code>).
      During triage, the system matches the user&apos;s description to a label to
      decide <strong>which playbook</strong> to load.
    </p>
    <ul className="mt-2 list-disc space-y-1 pl-5">
      <li>
        <strong>ID</strong> &mdash; a machine-readable slug. Used across the
        system (tickets, analytics, escalation handoffs, RAG queries). Once
        created, avoid changing it &mdash; existing playbooks and references
        point to this ID.
      </li>
      <li>
        <strong>Display name</strong> &mdash; the human-readable title shown in
        admin and in the triage prompt (e.g. &quot;Too runny&quot;,
        &quot;Machine error E5&quot;). Keep it short and recognisable.
      </li>
      <li>
        <strong>Description</strong> (optional) &mdash; a longer explanation of
        what this label covers. Helps other admin users understand the
        category&apos;s scope when browsing the list.
      </li>
    </ul>
    <p className="mt-2 text-sm">
      <strong>Tip:</strong> Each label can have one or more playbooks linked to
      it. If different product types need different diagnostic paths for the same
      issue, create one label and multiple playbooks scoped by product type.
    </p>
  </>
);

/* ------------------------------------------------------------------ */
/*  Full guide sections (used in the LabelsGuideModal)                */
/* ------------------------------------------------------------------ */

export function LabelsGuideIntro() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">What is a label?</h2>
      <p className="mt-2 text-sm text-ink/80">
        A label is a <strong>stable issue category</strong> &mdash; a single
        identifier like{" "}
        <code className="rounded bg-page px-1 py-0.5 text-xs">too_runny</code>{" "}
        or{" "}
        <code className="rounded bg-page px-1 py-0.5 text-xs">error_e5</code>.
        It is the first thing the system decides when a user starts a support
        conversation.
      </p>
      <p className="mt-2 text-sm text-ink/80">
        Labels sit at the top of the diagnostic hierarchy. The triage step
        picks <strong>one label</strong> based on the user&apos;s initial
        description, and that choice determines which playbook runs for the rest
        of the conversation.
      </p>
    </section>
  );
}

export function LabelsGuideRole() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        How labels are used in the system
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
        <li>
          <strong>Triage</strong> &mdash; when a user describes their problem,
          all labels (with their display names and associated playbook titles) are
          presented to the triage model. It picks the best-matching label.
        </li>
        <li>
          <strong>Playbook selection</strong> &mdash; the selected label is used
          to look up the matching playbook(s) from the database. If multiple
          playbooks share the same label, product type scoping narrows the
          choice.
        </li>
        <li>
          <strong>RAG context</strong> &mdash; the label ID is appended to
          embedding queries each turn, improving retrieval relevance for
          issue-specific documentation.
        </li>
        <li>
          <strong>Stable references</strong> &mdash; ticket filters, audit logs,
          analytics dashboards, and escalation handoffs all reference the label
          ID. Changing a label ID would break these references.
        </li>
        <li>
          <strong>Label switch</strong> &mdash; during diagnosis, if evidence
          contradicts the current playbook, the assistant can suggest switching to
          a different label, re-triaging the session.
        </li>
      </ol>
    </section>
  );
}

export function LabelsGuideFields() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">Field reference</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 pr-4 font-medium text-ink">Field</th>
              <th className="pb-2 pr-4 font-medium text-ink">Required</th>
              <th className="pb-2 font-medium text-ink">Purpose</th>
            </tr>
          </thead>
          <tbody className="text-ink/80">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">ID</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">
                Machine-readable slug. Used in playbook links, triage, RAG
                queries, tickets, and analytics. Lowercase, underscores OK.
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">Display name</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">
                Human-readable title shown in the admin list and in the triage
                prompt. Should be short, clear, and recognisable by your
                support team.
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium">Description</td>
              <td className="py-2 pr-4">No</td>
              <td className="py-2">
                Longer explanation of what this label covers. Helps admin users
                understand the category scope. Not used in the LLM prompt.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LabelsGuideRelationship() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        Labels vs. symptoms vs. playbooks
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded border border-border bg-page p-3">
          <p className="font-medium text-ink">Labels</p>
          <p className="mt-1 text-ink/70">
            &quot;What category of problem?&quot;
          </p>
          <p className="mt-1 text-xs text-muted">
            Drive triage and playbook selection. Stable across the system.
          </p>
        </div>
        <div className="rounded border border-border bg-page p-3">
          <p className="font-medium text-ink">Playbooks</p>
          <p className="mt-1 text-ink/70">
            &quot;How do we diagnose and fix it?&quot;
          </p>
          <p className="mt-1 text-xs text-muted">
            Linked to a label. Contain symptoms, evidence, causes, triggers,
            and steps.
          </p>
        </div>
        <div className="rounded border border-border bg-page p-3">
          <p className="font-medium text-ink">Symptoms</p>
          <p className="mt-1 text-ink/70">
            &quot;What does it look like to the user?&quot;
          </p>
          <p className="mt-1 text-xs text-muted">
            Live inside a playbook. Guide the conversation after selection.
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink/80">
        A single label can have multiple playbooks if different product types
        need different diagnostic paths. Symptoms are not used during triage
        &mdash; only the label and playbook title are.
      </p>
    </section>
  );
}

export function LabelsGuideTips() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">Tips</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>
          <strong>Keep IDs stable.</strong> Changing a label ID breaks
          references in playbooks, tickets, and analytics.
        </li>
        <li>
          <strong>Use clear display names.</strong> They appear in the triage
          prompt and in admin &mdash; both the LLM and your team need to
          understand them at a glance.
        </li>
        <li>
          <strong>Don&apos;t over-split.</strong> Create labels for genuinely
          distinct issue categories. If two issues share the same diagnostic
          path, they can share a label with different playbooks scoped by
          product type.
        </li>
        <li>
          <strong>Review periodically.</strong> As new issues arise, add labels.
          If a label is never matched, consider merging or removing it to keep
          triage accurate.
        </li>
      </ul>
    </section>
  );
}
