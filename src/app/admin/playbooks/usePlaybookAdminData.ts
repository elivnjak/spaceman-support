"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { Action, Label, Playbook, ProductTypeOption } from "./types";

type AdminDataState = {
  labels: Label[];
  productTypes: ProductTypeOption[];
  actionsList: Action[];
  playbooks: Playbook[];
};

const EMPTY_STATE: AdminDataState = {
  labels: [],
  productTypes: [],
  actionsList: [],
  playbooks: [],
};

export function usePlaybookAdminData(focusPlaybookId?: string) {
  const [data, setData] = useState<AdminDataState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const reload = useCallback(() => {
    setReloadNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTargetMissing(false);

    Promise.all([
      fetch("/api/admin/labels", { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load labels.");
        return response.json() as Promise<Label[]>;
      }),
      fetch("/api/admin/product-types", { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load product types.");
        return response.json() as Promise<ProductTypeOption[]>;
      }),
      fetch("/api/admin/playbooks", { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load playbooks.");
        return response.json() as Promise<Playbook[]>;
      }),
      fetch("/api/admin/actions", { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load actions.");
        return response.json() as Promise<Action[]>;
      }),
    ])
      .then(([labels, productTypes, playbooks, actionsList]) => {
        if (controller.signal.aborted) return;
        const normalizedPlaybooks = playbooks.map((playbook) => ({
          ...playbook,
          enabled: Boolean(playbook.enabled),
        }));
        setData({
          labels,
          productTypes,
          playbooks: normalizedPlaybooks,
          actionsList,
        });
        if (focusPlaybookId) {
          setTargetMissing(!normalizedPlaybooks.some((item) => item.id === focusPlaybookId));
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load playbook admin data.");
        setData(EMPTY_STATE);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [focusPlaybookId, reloadNonce]);

  return {
    ...data,
    loading,
    error,
    targetMissing,
    reload,
    setPlaybooks: (updater: SetStateAction<Playbook[]>) =>
      setData((current) => ({
        ...current,
        playbooks: typeof updater === "function" ? (updater as (prev: Playbook[]) => Playbook[])(current.playbooks) : updater,
      })),
    setLabels: (updater: SetStateAction<Label[]>) =>
      setData((current) => ({
        ...current,
        labels: typeof updater === "function" ? (updater as (prev: Label[]) => Label[])(current.labels) : updater,
      })),
    setActionsList: (updater: SetStateAction<Action[]>) =>
      setData((current) => ({
        ...current,
        actionsList:
          typeof updater === "function"
            ? (updater as (prev: Action[]) => Action[])(current.actionsList)
            : updater,
      })),
  };
}
