"use client";

import { Modal } from "@/components/ui/Modal";
import {
  LabelsGuideIntro,
  LabelsGuideRole,
  LabelsGuideFields,
  LabelsGuideRelationship,
  LabelsGuideTips,
} from "./labels-help-content";

interface LabelsGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function LabelsGuideModal({ open, onClose }: LabelsGuideModalProps) {
  return (
    <Modal open={open} onClose={onClose} className="!max-w-3xl">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Labels Guide</h1>
            <p className="mt-1 text-sm text-muted">
              How labels work and how to manage them effectively.
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

        <div className="space-y-8">
          <LabelsGuideIntro />
          <LabelsGuideRole />
          <hr className="border-border" />
          <LabelsGuideFields />
          <LabelsGuideRelationship />
          <hr className="border-border" />
          <LabelsGuideTips />
        </div>
      </div>
    </Modal>
  );
}
