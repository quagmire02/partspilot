import type { BuyLink } from "./plan";

/** Deterministic vendor search links for an exact product name. https only. */
export function buyLinks(query: string): BuyLink[] {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, " "));
  return [
    { label: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
    { label: "AliExpress", url: `https://www.aliexpress.com/wholesale?SearchText=${q}` },
    { label: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${q}` },
  ];
}
