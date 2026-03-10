import type { ReactNode } from "react";

type TabKey = "overview" | "symptoms" | "evidence" | "causes" | "triggers" | "steps";

/* ------------------------------------------------------------------ */
/*  Per-tab inline help (shown in the collapsible block on each tab)  */
/* ------------------------------------------------------------------ */

export const TAB_HELP: Record<TabKey, { title: string; body: ReactNode }> = {
  overview: {
    title: "Overview",
    body: (
      <>
        <p>
          The overview is the <strong>routing and scope layer</strong> of your playbook. It tells
          the system which issue taxonomy this playbook belongs to, which products it applies to,
          and which authored workbook version should be treated as the source of truth.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Label</strong> &mdash; the issue category (e.g.{" "}
            <em>Too runny</em>, <em>Too thick</em>). During triage, the system
            first selects a label, then loads the matching playbook for the
            current product context.
          </li>
          <li>
            <strong>Title</strong> &mdash; a short, descriptive name shown in
            admin and in triage. Make it clear enough that both humans and the
            routing model can distinguish it from sibling playbooks on the same
            label.
          </li>
          <li>
            <strong>Product types</strong> &mdash; scope this playbook to
            specific products. Leave empty to apply to all. This lets you have
            different diagnostic paths for the same label on different machines.
          </li>
          <li>
            <strong>Schema version</strong> &mdash; schema v2 playbooks can
            carry structured evidence and cause semantics. The admin workbook
            import/export flow is now the advanced bulk-edit and backup path,
            while the in-app editor is the primary authoring surface for v2
            evidence contracts, causes, and structured rules.
          </li>
        </ul>
      </>
    ),
  },

  symptoms: {
    title: "Symptoms",
    body: (
      <>
        <p>
          Symptoms describe <strong>what the problem looks like in the user&apos;s words</strong>{" "}
          (e.g. &quot;watery output&quot;, &quot;melts too fast&quot;, &quot;won&apos;t hold shape&quot;).
        </p>
        <p className="mt-2">
          They are sent to the diagnostic assistant <em>after</em> a playbook is
          selected, giving it detailed context about what to look for. They also
          help detect when the user&apos;s actual problem doesn&apos;t match this
          playbook, so a label switch can be suggested.
        </p>
        <div className="mt-3 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
          <strong>Symptoms vs. Labels:</strong> Labels answer &quot;what category
          of problem?&quot; and drive playbook selection. Symptoms answer
          &quot;what does this look like to the user?&quot; and guide the
          conversation. You don&apos;t need to list every possible phrase &mdash;
          a few clear, common descriptions are enough.
        </div>
      </>
    ),
  },

  evidence: {
    title: "Evidence",
    body: (
      <>
        <p>
          The evidence checklist lists the <strong>specific data points</strong>{" "}
          the assistant should collect during the conversation &mdash; photos,
          readings, observations, actions, or confirmations.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Required</strong> items gate structured diagnosis. They
            should represent the minimum evidence needed before the system can
            safely support or exclude a cause.
          </li>
          <li>
            <strong>Type</strong> affects how the chat UI renders the request:{" "}
            <em>photo</em> = user sends an image; <em>reading</em> = a
            numeric/value; <em>observation</em> = user describes what they see;{" "}
            <em>action</em> = they perform a task; <em>confirmation</em> = yes/no.
          </li>
          <li>
            <strong>Action link</strong> (optional) &mdash; connects to an
            Action record that provides the reusable collection contract for{" "}
            <em>how</em> to collect this evidence and what exact value shape
            should come back.
          </li>
        </ul>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Prefer action-backed enum, boolean, and number
          inputs when business logic depends on exact values. Keep evidence IDs
          stable because schema-v2 cause rules and workbook exports reference
          them directly.
        </p>
        <p className="mt-2 text-sm">
          In the causes editor, evidence is selected through a searchable
          click-based chooser rather than typed IDs. New rules intentionally
          start blank so you can explicitly choose the right evidence item.
        </p>
      </>
    ),
  },

  causes: {
    title: "Causes",
    body: (
      <>
        <p>
          Candidate causes are the <strong>possible root causes</strong> the
          assistant is trying to choose between (e.g. &quot;Temperature too
          high&quot;, &quot;Wrong ingredient ratio&quot;).
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Likelihood</strong> is a starting prior &mdash;{" "}
            <em>high</em> means &quot;consider this even before much evidence is
            collected&quot;; <em>low</em> means &quot;only if evidence
            specifically points to it&quot;.
          </li>
          <li>
            <strong>Ruling evidence</strong> is still useful as a quick index in
            the inline editor, but in schema v2 the authoritative cause logic is
            the structured <strong>support rules</strong>,{" "}
            <strong>exclude rules</strong>, and optional{" "}
            <strong>outcome</strong> metadata maintained directly in the
            in-app causes editor.
          </li>
        </ul>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Keep sibling causes mutually distinguishable.
          When a cause needs deterministic evaluation or technician escalation,
          maintain that logic in the schema-v2 fields rather than prose alone.
          Each cause now has its own accordion card, with separate support and
          exclude sections, so use those sections to make the boundary between
          sibling causes obvious.
        </p>
        <p className="mt-2 text-sm">
          New causes open in place, and new rules do not preselect evidence.
          That is intentional: it makes the authored logic easier to read and
          avoids accidental carry-over from the first checklist item.
        </p>
      </>
    ),
  },

  triggers: {
    title: "Triggers",
    body: (
      <>
        <p>
          Escalation triggers are phrases or keywords that mean{" "}
          <strong>stop diagnosing and escalate to a person</strong> (e.g.
          &quot;electrical smell&quot;, &quot;refrigerant leak&quot;,
          &quot;sparking&quot;).
        </p>
        <p className="mt-2">
          Every turn, <em>before</em> the assistant is even called, the system
          checks the user&apos;s message against these triggers using a text
          match. If matched, the session is immediately escalated without further
          diagnosis.
        </p>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Use phrases customers might actually say or that
          your team has agreed mean &quot;escalate&quot;. Keep the list short and
          focused so escalation happens when it should, without blocking normal
          conversations.
        </p>
      </>
    ),
  },

  steps: {
    title: "Steps",
    body: (
      <>
        <p>
          Resolution steps are the <strong>exact actions</strong> the user should
          take once a cause has been confirmed. The assistant is strictly required
          to use only the steps defined here &mdash; it cannot invent new ones.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Instruction</strong> &mdash; the main text the user will see.
            After the assistant produces a resolution, the system validates that
            the instruction text hasn&apos;t drifted from what you wrote. If it has,
            your exact authored text replaces the assistant&apos;s version.
          </li>
          <li>
            <strong>How to verify</strong> (optional) &mdash; tells the user how
            to confirm the step worked (e.g. &quot;Hopper display shows -8°C to
            -4°C&quot;).
          </li>
        </ul>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Write steps in the order the user should follow
          them. Use simple, actionable language. The runtime may normalize step
          IDs, but the authored instruction text remains the canonical source of
          truth shown to the user.
        </p>
      </>
    ),
  },
};

/* ------------------------------------------------------------------ */
/*  Full guide sections (used in the PlaybookGuideModal)              */
/* ------------------------------------------------------------------ */

export function GuideIntro() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">What is a playbook?</h2>
      <p className="mt-2 text-sm text-ink/80">
        A playbook is a <strong>diagnostic contract</strong> for one issue family
        (e.g. &quot;Texture too runny&quot; or &quot;Machine error X&quot;). In
        the SaaS-grade schema-v2 model, a playbook tells the system:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>Which issue taxonomy and product scope this guide belongs to</li>
        <li>Which evidence must be collected and in what input shape</li>
        <li>Which causes can be supported, excluded, or escalated</li>
        <li>Which safety triggers override diagnosis immediately</li>
        <li>Which authored steps should be shown once a cause is confirmed</li>
      </ul>
      <p className="mt-2 text-sm text-ink/80">
        The inline admin form covers the core playbook fields. Full schema-v2
        authoring now happens directly in the admin UI for evidence contracts,
        support rules, exclude rules, and cause outcomes. Workbook
        export/import remains available as the advanced bulk-edit and backup
        path.
      </p>
    </section>
  );
}

export function GuideLabelsVsSymptoms() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        Labels vs. Symptoms &mdash; why both exist
      </h2>
      <p className="mt-2 text-sm text-ink/80">
        A <strong>label</strong> is the issue category &mdash; a single
        identifier like <code className="rounded bg-page px-1 py-0.5 text-xs">too_runny</code>.
        Labels are used during <em>triage</em> (before any playbook is loaded)
        to decide <strong>which playbook family</strong> to run. A single label
        can have multiple playbooks if different product types need different
        diagnostic paths.
      </p>
      <p className="mt-2 text-sm text-ink/80">
        <strong>Symptoms</strong> live <em>inside</em> a playbook and describe
        the different ways a user might phrase or experience the issue. They are
        sent to the assistant <em>after</em> a playbook is selected, giving it
        detailed conversational context. They are not where deterministic cause
        logic should live.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded border border-border bg-page p-3">
          <p className="font-medium text-ink">Labels</p>
          <p className="mt-1 text-ink/70">
            &quot;What category of problem?&quot;
          </p>
          <p className="mt-1 text-xs text-muted">
            Drive playbook selection. Stable identifiers for tickets, analytics,
            and escalation handoffs.
          </p>
        </div>
        <div className="rounded border border-border bg-page p-3">
          <p className="font-medium text-ink">Symptoms</p>
          <p className="mt-1 text-ink/70">
            &quot;What does this look like to the user?&quot;
          </p>
          <p className="mt-1 text-xs text-muted">
            Guide the diagnostic conversation. Help detect when the user&apos;s
            real problem doesn&apos;t match.
          </p>
        </div>
      </div>
    </section>
  );
}

export function GuideSectionDetail({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={`guide-${id}`}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2 text-sm text-ink/80">{children}</div>
    </section>
  );
}

export function GuideHowItWorks() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        How the parts work together
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
        <li>
          <strong>Label + Title + Product scope</strong> &rarr; during triage,
          the system chooses <em>which</em> playbook to use.
        </li>
        <li>
          <strong>Symptoms</strong> &rarr; once loaded, the assistant knows{" "}
          <em>what the problem looks like</em> in the user&apos;s words.
        </li>
        <li>
          <strong>Evidence + Actions</strong> &rarr; the assistant asks for
          items on the checklist, using the linked action contract to collect
          exact values.
        </li>
        <li>
          <strong>Structured causes</strong> &rarr; as evidence comes in, the
          system evaluates what is supported, excluded, or still ambiguous using
          schema-v2 rules where available.
        </li>
        <li>
          <strong>Triggers</strong> &rarr; every turn, the system checks the
          user&apos;s message; if it matches a trigger, we{" "}
          <strong>escalate</strong> immediately.
        </li>
        <li>
          When one <strong>Cause</strong> is supported &rarr; the assistant
          delivers the matching <strong>Steps</strong>, using the authored
          playbook text as the canonical resolution.
        </li>
      </ol>
      <div className="mt-4 rounded border border-border bg-page p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Flow summary
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink/80">
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            Label
          </span>
          <span className="text-muted">&rarr;</span>
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            Symptoms
          </span>
          <span className="text-muted">&rarr;</span>
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            Evidence
          </span>
          <span className="text-muted">&rarr;</span>
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            Causes
          </span>
          <span className="text-muted">&rarr;</span>
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            Steps
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Actions shape evidence collection, triggers act as safety overrides,
          and schema-v2 rules authored in the admin UI are now the primary path
          for deterministic cause logic.
        </p>
      </div>
    </section>
  );
}

export function GuideTips() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        Tips for maintaining playbooks
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>
          <strong>Keep labels stable</strong> and keep cause logic out of label
          names. Labels are taxonomy, not diagnosis rules.
        </li>
        <li>
          <strong>Prefer structured inputs</strong> in actions. If business
          logic depends on exact values, use enum, boolean, or number inputs
          instead of ambiguous free text.
        </li>
        <li>
          <strong>Maintain support and exclude rules directly in the Causes
          tab</strong> whenever sibling causes overlap or a cause should
          escalate instead of resolve. Use workbook export/import as the
          advanced backup and bulk-edit path.
        </li>
        <li>
          <strong>Review triggers</strong> from time to time so escalation still
          matches your current policies.
        </li>
        <li>
          <strong>Test with real examples:</strong> run through the generated
          scenario suite and a few manual chats to confirm the right evidence,
          cause, and step set are selected.
        </li>
        <li>
          <strong>Export after stable updates:</strong> once a live DB playbook
          is behaving correctly, export the workbook so the structured v2 state
          is versioned outside the database as well.
        </li>
      </ul>
    </section>
  );
}
