"use client";

import { useEffect, useState } from "react";

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

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Product types</h1>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">Add product type</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Yogurt"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
          />
          <label className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 dark:border-gray-600">
            <input
              type="checkbox"
              checked={isOther}
              onChange={(e) => setIsOther(e.target.checked)}
            />
            <span className="text-sm">Is “Other” option</span>
          </label>
          <button
            type="button"
            onClick={addProductType}
            disabled={submitting || !name.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add product type
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Current product types</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
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
              className={`flex cursor-grab items-center justify-between rounded border px-3 py-2 active:cursor-grabbing dark:border-gray-700 ${
                draggedIndex === index
                  ? "border-blue-500 opacity-50"
                  : dragOverIndex === index
                    ? "border-blue-400 border-dashed bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="text-gray-400 dark:text-gray-500"
                  aria-hidden
                >
                  ⋮⋮
                </span>
                <div>
                  <p className="text-sm font-medium">{productType.name}</p>
                  {productType.isOther ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Other option</p>
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
            <p className="text-sm text-gray-500 dark:text-gray-400">No product types configured yet.</p>
          ) : null}
        </div>
        {savingOrder ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Saving order…</p>
        ) : null}
      </section>
    </div>
  );
}
