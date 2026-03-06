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
          The overview is the <strong>cover page</strong> of your playbook. It identifies which
          diagnostic guide is in use.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Label</strong> &mdash; the issue category (e.g.{" "}
            <em>Too runny</em>, <em>Too thick</em>). During triage, the system
            matches the user&apos;s description to a label to decide{" "}
            <em>which playbook</em> to load.
          </li>
          <li>
            <strong>Title</strong> &mdash; a short, descriptive name shown in
            admin and in the triage prompt. Make it clear and specific.
          </li>
          <li>
            <strong>Product types</strong> &mdash; scope this playbook to
            specific products. Leave empty to apply to all. This lets you have
            different diagnostic paths for the same label on different machines.
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
            <strong>Required</strong> items must be collected before the
            assistant can narrow down a cause and suggest resolution steps.
          </li>
          <li>
            <strong>Type</strong> affects how the chat UI renders the request:{" "}
            <em>photo</em> = user sends an image; <em>reading</em> = a
            numeric/value; <em>observation</em> = user describes what they see;{" "}
            <em>action</em> = they perform a task; <em>confirmation</em> = yes/no.
          </li>
          <li>
            <strong>Action link</strong> (optional) &mdash; connects to an
            Action record that provides step-by-step instructions for{" "}
            <em>how</em> to collect this evidence (e.g. how to read the display).
          </li>
        </ul>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Order items so the most important or
          easiest-to-get come first. Evidence IDs are referenced by causes (in
          the Causes tab) to link what you collect to what you diagnose.
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
            <strong>Ruling evidence</strong> links evidence items from the
            checklist that help confirm or rule out this cause. The more clearly
            you link causes to evidence, the more consistent the assistant&apos;s
            conclusions will be.
          </li>
        </ul>
        <p className="mt-2 text-sm">
          <strong>Tip:</strong> Include the causes your support team actually
          sees in practice. When one cause is confirmed, the assistant selects
          the matching resolution Steps.
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
          them. Use simple, actionable language. The exact text you write here is
          what the user will see &mdash; it is never paraphrased.
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
        A playbook is a <strong>diagnostic guide</strong> for one type of issue
        (e.g. &quot;Texture too runny&quot; or &quot;Machine error X&quot;). It
        tells the support assistant:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>What kind of problem this is</li>
        <li>What information to collect from the user</li>
        <li>What the possible causes are</li>
        <li>When to escalate to a person</li>
        <li>What steps to suggest once a cause is found</li>
      </ul>
      <p className="mt-2 text-sm text-ink/80">
        You build this guide by filling in the sections described below. The
        assistant then follows this guide during a chat with the user.
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
        to decide <strong>which playbook</strong> to run. A single label can have
        multiple playbooks if different product types need different diagnostic
        paths.
      </p>
      <p className="mt-2 text-sm text-ink/80">
        <strong>Symptoms</strong> live <em>inside</em> a playbook and describe
        the different ways a user might phrase or experience the issue. They are
        sent to the assistant <em>after</em> a playbook is selected, giving it
        detailed context.
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
          <strong>Label + Title</strong> &rarr; during triage, the system picks{" "}
          <em>which</em> playbook to use.
        </li>
        <li>
          <strong>Symptoms</strong> &rarr; once loaded, the assistant knows{" "}
          <em>what the problem looks like</em> in the user&apos;s words.
        </li>
        <li>
          <strong>Evidence</strong> &rarr; the assistant asks for items on the
          checklist, one at a time.
        </li>
        <li>
          <strong>Causes</strong> &rarr; as evidence comes in, the assistant
          narrows down <em>what might be wrong</em>, using ruling evidence links.
        </li>
        <li>
          <strong>Triggers</strong> &rarr; every turn, the system checks the
          user&apos;s message; if it matches a trigger, we{" "}
          <strong>escalate</strong> immediately.
        </li>
        <li>
          When one <strong>Cause</strong> is confirmed &rarr; the assistant
          delivers the matching <strong>Steps</strong> as the resolution.
        </li>
      </ol>
      <div className="mt-4 rounded border border-border bg-page p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Flow summary
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink/80">
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
          Triggers act as safety overrides at any point in this flow.
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
          <strong>Keep language consistent</strong> with how your customers and
          support team talk (same terms, same tone).
        </li>
        <li>
          <strong>Update causes and ruling evidence</strong> when you see new
          real cases or realise a cause was missing.
        </li>
        <li>
          <strong>Review triggers</strong> from time to time so escalation still
          matches your current policies.
        </li>
        <li>
          <strong>Test with real examples:</strong> run through a few sample
          chats and check that the right evidence is asked for, the right cause
          is chosen, and the right steps are shown.
        </li>
        <li>
          <strong>Document changes:</strong> when you change a playbook, note
          what you changed and why, so the next person can keep maintaining it.
        </li>
      </ul>
    </section>
  );
}
