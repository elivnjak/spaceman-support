"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

type ProductType = {
  id: string;
  name: string;
  isOther: boolean;
  sortOrder: number;
};

export default function AdminProductTypesPage() {
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [isOther, setIsOther] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  async function reload() {
    const res = await fetch("/api/admin/product-types");
    const data = await res.json();
    setProductTypes(data);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function addProductType() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/admin/product-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          isOther,
        }),
      });
      setName("");
      setIsOther(false);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    await fetch("/api/admin/product-types", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await reload();
  }

  async function saveOrder(ordered: ProductType[]) {
    setSavingOrder(true);
    try {
      await fetch("/api/admin/product-types", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ordered.map((p) => p.id) }),
      });
      setProductTypes(ordered);
    } finally {
      setSavingOrder(false);
    }
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedIndex == null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }
    const next = [...productTypes];
    const [removed] = next.splice(draggedIndex, 1);
    next.splice(dropIndex, 0, removed);
    setDraggedIndex(null);
    saveOrder(next);
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-8">
      <PageHeader title="Product types" />

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-ink">Add product type</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Yogurt"
          />
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Toggle enabled={isOther} onChange={setIsOther} />
            <span className="text-sm text-ink">Is &quot;Other&quot; option</span>
          </div>
          <Button
            onClick={addProductType}
            disabled={submitting || !name.trim()}
          >
            Add product type
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Current product types</h2>
          <p className="text-sm text-muted">
            {productTypes.length} total • Drag to reorder
          </p>
        </div>
        <div className="space-y-2">
          {productTypes.map((productType, index) => (
            <div
              key={productType.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
              className={`flex cursor-grab items-center justify-between rounded-lg border px-3 py-2 active:cursor-grabbing ${
                draggedIndex === index
                  ? "border-primary opacity-50"
                  : dragOverIndex === index
                    ? "border-primary border-dashed bg-aqua/30"
                    : "border-border"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-muted" aria-hidden>
                  ⋮⋮
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{productType.name}</p>
                  {productType.isOther ? (
                    <p className="text-xs text-muted">Other option</p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(productType.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
          {productTypes.length === 0 ? (
            <p className="text-sm text-muted">No product types configured yet.</p>
          ) : null}
        </div>
        {savingOrder ? (
          <p className="mt-2 text-xs text-muted">Saving order…</p>
        ) : null}
      </Card>
    </div>
  );
}
