import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ArtworkRemoveButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <Button type="button" variant="secondary" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} className="absolute right-2 top-2 z-10 bg-surface/90 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><X aria-hidden="true" /></Button>;
}
