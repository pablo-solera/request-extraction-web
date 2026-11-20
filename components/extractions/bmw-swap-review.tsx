"use client";

import { describeSwapOffer } from "@/lib/extractions/availability-messages";
import type { BmwTypekeyAvailability } from "@/lib/readers/bmw/types";

export type SwapReviewItem = { id: string; typekey: string; series: string; developmentCode: string; availability: BmwTypekeyAvailability };

export function BmwSwapReview({ items, onRemove, onSwap }: { items: SwapReviewItem[]; onRemove: (id: string) => void; onSwap: (id: string, baseTypekey: string) => void }) {
  if (items.length === 0) return null;
  return <section aria-labelledby="swap-review-title" className="space-y-3 rounded-xl border border-danger-line bg-danger-wash p-4" role="alert">
    <h3 className="text-body font-semibold text-danger-ink" id="swap-review-title">{items.length === 1 ? "Un typekey no tiene datos en BMW" : `${items.length} typekeys no tienen datos en BMW`}</h3>
    <ul className="space-y-3">{items.map((item) => {
      const offer = describeSwapOffer(item.availability);
      const buttonClass = "inline-flex size-11 shrink-0 items-center justify-center rounded-full border";
      return <li className="flex items-start gap-3 rounded-lg border border-danger-line bg-surface p-3" key={item.id}>
        <div className="min-w-0 flex-1 text-body text-ink">
          <p><span className="font-mono font-semibold" translate="no">{item.typekey}</span> <span className="text-meta text-ink-muted">({item.series} · {item.developmentCode})</span> no tiene datos en BMW Flat Rates{offer.kind === "none" ? <> y {offer.reason}. Solo puedes quitarlo de la solicitud.</> : "."}</p>
          {offer.kind === "swap" ? <p className="mt-1">
            Su tipo base <span className="font-mono font-semibold" translate="no">{offer.baseTypekey}</span>{offer.identical ? " es igual en todas las características." : <> es igual salvo en: <strong className="font-semibold text-pending-ink">{offer.differences.join(", ")}</strong>.</>} ¿Quieres sustituirlo por <span className="font-mono font-semibold" translate="no">{offer.baseTypekey}</span>?
          </p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {offer.kind === "swap" ? <button aria-label={`Sustituir ${item.typekey} por el tipo base ${offer.baseTypekey}`} className={`${buttonClass} border-success-ink bg-success-wash text-success-ink hover:bg-success-line`} onClick={() => onSwap(item.id, offer.baseTypekey)} title={`Sustituir por ${offer.baseTypekey}`} type="button">
            <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </button> : null}
          <button aria-label={`Quitar ${item.typekey} de la solicitud`} className={`${buttonClass} border-danger-line bg-danger-wash text-danger-ink hover:bg-danger-line`} onClick={() => onRemove(item.id)} title="Quitar de la solicitud" type="button">
            <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </li>;
    })}</ul>
  </section>;
}
