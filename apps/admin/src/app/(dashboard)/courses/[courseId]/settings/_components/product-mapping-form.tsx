"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SettingsSection } from "@/components/forms/settings-section";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lookupStagingProductsAction, searchStagingProductsAction, setCourseProductMappingAction } from "../actions";

type Product = { id: number; name: string };

export function ProductMappingForm({ courseId, productIds }: { courseId: string; productIds: number[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchPending, startSearch] = useTransition();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product[]>(() => productIds.map((id) => ({ id, name: "Product name unavailable" })));
  const [savedIds, setSavedIds] = useState(productIds);
  const isDirty = JSON.stringify(selected.map((item) => item.id)) !== JSON.stringify(savedIds);

  useEffect(() => {
    let active = true;
    if (productIds.length) {
      lookupStagingProductsAction(productIds).then((found) => {
        if (active) setSelected((current) => current.map((item) => found.find((product) => product.id === item.id) ?? item));
      }).catch(() => { if (active) toast.error("Could not load saved product names"); });
    }
    return () => { active = false; };
  }, [courseId]);

  function save() {
    const ids = selected.map((product) => product.id);
    startTransition(async () => {
      try {
        await setCourseProductMappingAction(courseId, ids);
        setSavedIds(ids);
        router.refresh();
        toast.success("Product mapping saved");
      } catch (error) {
        toast.error("Could not save product mapping", { description: (error as Error).message });
      }
    });
  }
  function search() {
    startSearch(async () => {
      try { setProducts(await searchStagingProductsAction(query)); }
      catch (error) { toast.error("Could not search products", { description: (error as Error).message }); }
    });
  }
  return <form onSubmit={(event) => { event.preventDefault(); save(); }}><SettingsSection title="WooCommerce products" description="Prototype: saving this mapping does not yet update student access." footer={<Button type="submit" variant="primary" disabled={pending || !isDirty}>{pending ? "Saving…" : "Save"}</Button>}>
    <Field id="woocommerce-product-search" label="Find a staging product" hint="Search published products on the staging shop.">
      <div className="flex items-center gap-3">
        <Input id="woocommerce-product-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (!searchPending) search(); } }} />
        <Button type="button" variant="secondary" disabled={searchPending} onClick={search}>Search products</Button>
      </div>
    </Field>
    {products.map((product) => <div key={product.id} className="flex items-center justify-between gap-3"><span>{product.name} ({product.id})</span><Button type="button" variant="secondary" disabled={selected.some((item) => item.id === product.id)} onClick={() => setSelected((current) => [...current, product])}>Add</Button></div>)}
    <div className="flex flex-col gap-3 pt-6">
      <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold text-ink">Selected products</h3><p className="text-sm text-ink-3">Products connected to this course.</p></div>
      {selected.length === 0 ? <p className="text-sm text-ink-3">No products selected.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="py-2 pr-4 font-medium">Product</th><th className="py-2 pr-4 font-medium">Product ID</th><th className="py-2 text-right font-medium"><span className="sr-only">Remove</span></th></tr></thead><tbody className="divide-y divide-line">{selected.map((product) => <tr key={product.id}><td className="py-2.5 pr-4 text-ink">{product.name}</td><td className="py-2.5 pr-4 text-ink-2">{product.id}</td><td className="py-2 text-right"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${product.name} (${product.id})`} onClick={() => setSelected((current) => current.filter((item) => item.id !== product.id))}><X aria-hidden="true" /></Button></td></tr>)}</tbody></table></div>}
    </div>
  </SettingsSection></form>;
}
