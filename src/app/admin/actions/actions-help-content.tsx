import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Inline help (collapsible block shown on new/edit action forms)    */
/* ------------------------------------------------------------------ */

export const ACTIONS_FORM_HELP: ReactNode = (
  <>
    <p>
      An <strong>action</strong> provides step-by-step instructions for{" "}
      <em>how to collect a specific piece of evidence</em> during diagnosis. When
      a playbook&apos;s evidence checklist item has an{" "}
      <strong>Action link</strong>, the assistant shows these instructions to the
      user alongside the evidence request.
    </p>
    <ul className="mt-2 list-disc space-y-1 pl-5">
      <li>
        <strong>Title</strong> &mdash; a short, descriptive name (e.g. &quot;Read
        hopper temperature&quot;, &quot;Check clearance&quot;).
      </li>
      <li>
        <strong>Instructions</strong> &mdash; the full step-by-step text shown to
        the user explaining how to perform the action and report back.
      </li>
      <li>
        <strong>Expected input</strong> &mdash; describes what type of response
        the chat UI should render: <em>photo</em>, <em>number</em> (with
        optional unit and range), <em>text</em>, <em>boolean</em> (yes/no), or{" "}
        <em>enum</em> (pick from a list).
      </li>
      <li>
        <strong>Safety level</strong> &mdash;{" "}
        <code className="rounded bg-page px-1 py-0.5 text-xs">safe</code>{" "}
        (normal),{" "}
        <code className="rounded bg-page px-1 py-0.5 text-xs">caution</code>{" "}
        (shown with a warning prefix), or{" "}
        <code className="rounded bg-page px-1 py-0.5 text-xs">
          technician_only
        </code>{" "}
        (filtered out for end users, only shown to technicians).
      </li>
      <li>
        <strong>Applies to models</strong> (optional) &mdash; restrict this
        action to specific machine models. Leave empty to apply to all.
      </li>
    </ul>
    <p className="mt-2 text-sm">
      <strong>Tip:</strong> Write instructions as if speaking directly to the
      user. Be specific about what to look at, what tool to use, and what to
      report back.
    </p>
  </>
);

/* ------------------------------------------------------------------ */
/*  Full guide sections (used in the ActionsGuideModal)               */
/* ------------------------------------------------------------------ */

export function ActionsGuideIntro() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">What is an action?</h2>
      <p className="mt-2 text-sm text-ink/80">
        An action is a <strong>reusable instruction record</strong> that tells
        the user exactly how to collect a specific piece of evidence. Actions
        live in a separate catalog so they can be shared across multiple
        playbooks and evidence items.
      </p>
      <p className="mt-2 text-sm text-ink/80">
        When the assistant asks the user for an evidence item that has an action
        linked, the action&apos;s instructions and expected input format are
        shown alongside the request, guiding the user through the data
        collection step.
      </p>
    </section>
  );
}

export function ActionsGuideHowUsed() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">
        How actions are used in diagnosis
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
        <li>
          <strong>Evidence link</strong> &mdash; a playbook&apos;s evidence
          checklist item can set an{" "}
          <code className="rounded bg-page px-1 py-0.5 text-xs">actionId</code>{" "}
          pointing to an action record.
        </li>
        <li>
          <strong>Request rendering</strong> &mdash; when the assistant requests
          that evidence item, the chat UI uses the action&apos;s{" "}
          <strong>instructions</strong> and <strong>expected input</strong> to
          render an appropriate prompt (e.g. a number input with unit, a photo
          upload, a yes/no toggle).
        </li>
        <li>
          <strong>Safety filtering</strong> &mdash; the action&apos;s{" "}
          <strong>safety level</strong> is evaluated during response validation.
          Actions marked{" "}
          <code className="rounded bg-page px-1 py-0.5 text-xs">
            technician_only
          </code>{" "}
          are stripped from responses sent to end users.{" "}
          <code className="rounded bg-page px-1 py-0.5 text-xs">caution</code>{" "}
          actions are shown with a warning prefix.
        </li>
        <li>
          <strong>Model scoping</strong> &mdash; if{" "}
          <strong>applies to models</strong> is set, the action is only shown
          when the user&apos;s machine matches one of the listed models.
        </li>
      </ol>
    </section>
  );
}

export function ActionsGuideFields() {
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
                Machine-readable slug referenced by evidence checklist items
                via{" "}
                <code className="rounded bg-page px-1 py-0.5 text-xs">
                  actionId
                </code>
                . Lowercase, underscores OK.
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">Title</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">
                Short descriptive name (e.g. &quot;Read hopper
                temperature&quot;). Shown in admin and in the chat UI.
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">Instructions</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">
                Step-by-step text explaining how to perform the action and
                what to report back. This is the main content the user sees.
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">Expected input</td>
              <td className="py-2 pr-4">No</td>
              <td className="py-2">
                What type of response the UI should collect. Defaults to free
                text if not set.
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">Safety level</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">
                Controls visibility and warnings:{" "}
                <em>safe</em> (normal), <em>caution</em> (warning prefix),{" "}
                <em>technician_only</em> (hidden from end users).
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium">Applies to models</td>
              <td className="py-2 pr-4">No</td>
              <td className="py-2">
                Restrict to specific machine models. Empty means the action
                applies to all models.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ActionsGuideExpectedInput() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">Expected input types</h2>
      <p className="mt-2 text-sm text-ink/80">
        The expected input type determines how the chat UI renders the
        collection prompt for this action.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 pr-4 font-medium text-ink">Type</th>
              <th className="pb-2 pr-4 font-medium text-ink">UI rendering</th>
              <th className="pb-2 font-medium text-ink">Extra fields</th>
            </tr>
          </thead>
          <tbody className="text-ink/80">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">photo</td>
              <td className="py-2 pr-4">Image upload prompt</td>
              <td className="py-2">&mdash;</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">number</td>
              <td className="py-2 pr-4">Numeric input field</td>
              <td className="py-2">Unit (e.g. °C), range min/max</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">text</td>
              <td className="py-2 pr-4">Free text input</td>
              <td className="py-2">&mdash;</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">boolean</td>
              <td className="py-2 pr-4">Yes / No toggle</td>
              <td className="py-2">&mdash;</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-mono text-xs">enum</td>
              <td className="py-2 pr-4">Dropdown / option list</td>
              <td className="py-2">
                Comma-separated options (min 2 required)
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ActionsGuideTips() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">Tips</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>
          <strong>Write instructions as direct steps.</strong> Tell the user
          exactly what to do: &quot;Open the front panel. Read the number
          displayed on the hopper temperature screen.&quot;
        </li>
        <li>
          <strong>Set the right expected input type.</strong> A well-chosen type
          (e.g. number with unit and range) makes the chat UI more helpful and
          the collected data more consistent.
        </li>
        <li>
          <strong>Use safety levels appropriately.</strong> Mark actions that
          involve electrical components, refrigerant, or disassembly as{" "}
          <em>caution</em> or <em>technician_only</em> to prevent untrained
          users from unsafe actions.
        </li>
        <li>
          <strong>Reuse across playbooks.</strong> Actions are separate from
          playbooks so the same instruction (e.g. &quot;Read hopper
          temp&quot;) can be linked from multiple evidence items in different
          playbooks.
        </li>
        <li>
          <strong>Keep IDs stable.</strong> Evidence checklist items reference
          actions by ID. Changing an action ID breaks those links.
        </li>
      </ul>
    </section>
  );
}
