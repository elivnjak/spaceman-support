"use client";

import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  GuideIntro,
  GuideLabelsVsSymptoms,
  GuideSectionDetail,
  GuideHowItWorks,
  GuideTips,
} from "./playbook-help-content";

type TabKey = "overview" | "symptoms" | "evidence" | "causes" | "triggers" | "steps";

interface PlaybookGuideModalProps {
  open: boolean;
  onClose: () => void;
  scrollToTab?: TabKey;
}

const SECTION_NAV: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "symptoms", label: "Symptoms" },
  { id: "evidence", label: "Evidence" },
  { id: "causes", label: "Causes" },
  { id: "triggers", label: "Triggers" },
  { id: "steps", label: "Steps" },
];

export function PlaybookGuideModal({ open, onClose, scrollToTab }: PlaybookGuideModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !scrollToTab) return;
    const timeout = setTimeout(() => {
      const el = contentRef.current?.querySelector(`#guide-${scrollToTab}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => clearTimeout(timeout);
  }, [open, scrollToTab]);

  const scrollTo = (id: string) => {
    const el = contentRef.current?.querySelector(`#guide-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Modal open={open} onClose={onClose} className="!max-w-3xl">
      <div ref={contentRef}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Playbook Guide</h1>
            <p className="mt-1 text-sm text-muted">
              Everything you need to know about building effective playbooks.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-page hover:text-ink"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>

        {/* Quick-jump nav */}
        <nav className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-4">
          {SECTION_NAV.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary"
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="space-y-8">
          <GuideIntro />
          <GuideLabelsVsSymptoms />

          <hr className="border-border" />

          <GuideSectionDetail id="overview" title="Overview">
            <p>
              High-level routing and scope information for this playbook &mdash;
              title, linked label, optional product type scoping, and the schema
              version currently stored for this guide.
            </p>
            <p className="mt-2">
              The <strong>title</strong> appears in the triage prompt so the
              right playbook can be selected. The <strong>label</strong> links
              the playbook to the issue taxonomy. <strong>Product type</strong>{" "}
              scoping allows different playbooks for the same label when
              different products need different diagnostic paths. Full schema-v2
              rule authoring is currently maintained through workbook export and
              re-import.
            </p>
          </GuideSectionDetail>

          <GuideSectionDetail id="symptoms" title="Symptoms">
            <p>
              A list of symptoms &mdash; the kinds of things the user might see
              or describe (e.g. &quot;Product is watery&quot;, &quot;Melts too
              fast&quot;). They help the assistant recognise that the user&apos;s
              issue fits this playbook and detect when a different playbook
              might be more appropriate.
            </p>
            <p className="mt-2">
              Add the most common ways customers describe this type of issue.
              Symptoms are <em>not</em> used during triage (only the label and
              title are); they guide the diagnostic conversation once the
              playbook is loaded.
            </p>
          </GuideSectionDetail>

          <GuideSectionDetail id="evidence" title="Evidence">
            <p>
              The evidence checklist &mdash; a list of pieces of information the
              assistant should try to collect during the conversation. Each item
              has a short description, a type, and whether it&apos;s required or
              optional. You can also link an item to an <strong>Action</strong>{" "}
              for the exact collection contract and expected input shape.
            </p>
            <p className="mt-2">
              Evidence is <em>what we need to know</em> before we can safely
              support or exclude a cause. The assistant asks for these one by
              one. Required items should represent the minimum trustworthy
              evidence needed before structured diagnosis can continue.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 pr-4 font-medium text-ink">Type</th>
                    <th className="pb-2 font-medium text-ink">Meaning</th>
                  </tr>
                </thead>
                <tbody className="text-ink/80">
                  <tr className="border-b border-border/50">
                    <td className="py-1.5 pr-4 font-mono">photo</td>
                    <td>User sends an image</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-1.5 pr-4 font-mono">reading</td>
                    <td>A numeric or measured value</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-1.5 pr-4 font-mono">observation</td>
                    <td>User describes what they see</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-1.5 pr-4 font-mono">action</td>
                    <td>User performs a task and reports back</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-4 font-mono">confirmation</td>
                    <td>Yes/no verification</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </GuideSectionDetail>

          <GuideSectionDetail id="causes" title="Causes">
            <p>
              The candidate causes &mdash; the possible root causes the assistant
              is trying to choose between. For each cause you set a short name,
              description, likelihood, and which evidence items help confirm or
              rule it out in the inline editor.
            </p>
            <p className="mt-2">
              <strong>Likelihood</strong> gives the assistant a starting prior.{" "}
              <em>High</em> = consider even before much evidence;{" "}
              <em>low</em> = only if evidence specifically points to it.
            </p>
            <p className="mt-2">
              <strong>Ruling evidence</strong> is the quick inline cross-reference.
              In schema v2, the authoritative cause semantics are workbook-backed{" "}
              <strong>support rules</strong>, <strong>exclude rules</strong>, and
              optional <strong>outcome</strong> fields. Use the workbook path when
              sibling causes need deterministic separation.
            </p>
          </GuideSectionDetail>

          <GuideSectionDetail id="triggers" title="Triggers">
            <p>
              Escalation triggers &mdash; phrases or situations where the
              assistant should <strong>stop diagnosing</strong> and escalate to a
              person. Every turn, before the assistant is even called, the system
              checks the user&apos;s message against these triggers. If matched,
              the session is immediately escalated.
            </p>
            <p className="mt-2">
              Triggers also appear in the assistant&apos;s prompt so it can
              recognise related language even when the exact phrase doesn&apos;t
              match. Keep the list short and focused on genuine safety or
              policy concerns.
            </p>
          </GuideSectionDetail>

          <GuideSectionDetail id="steps" title="Steps">
            <p>
              Resolution steps &mdash; the exact actions the user should take
              once a cause has been confirmed. The assistant is strictly required
              to use only the step IDs you define here.
            </p>
            <p className="mt-2">
              After the assistant produces a resolution, the system validates
              that each step ID exists and that the instruction text hasn&apos;t
              drifted from what you wrote. If drift is detected, your exact
              authored text replaces the assistant&apos;s version. This keeps
              the playbook as the canonical source of resolution wording.
            </p>
            <p className="mt-2">
              The optional <strong>How to verify</strong> field tells the user
              how to confirm the step worked, closing the loop on each
              instruction.
            </p>
          </GuideSectionDetail>

          <hr className="border-border" />

          <GuideHowItWorks />
          <GuideTips />
        </div>
      </div>
    </Modal>
  );
}
