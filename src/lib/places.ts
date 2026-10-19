// The valley map and the Real India layer (design §10), as resolved by
// pipeline/link_places.py from content/places.yaml: the pairings, the pages of
// the comic that name each place, and the photographs with the credits read off
// Wikimedia Commons.
import data from "../content/generated/places.json";

export type Rect = [number, number, number, number];

/** A photograph and everything its licence obliges us to say about it. */
export type Picture = {
  id: string; alt: string; file: string; w: number; h: number;
  artist: string; license: string; licenseUrl: string;
  source: string; // the Commons file page
  commons: string; // the file name there
};

export type PageRef = { id: string; book: number; page: number };

export type Place = {
  id: string; name: string; fiction: string; rects: Rect[]; book: string;
  pages: PageRef[];
  real: {
    name: string; pin: string; region: string; confidence: string; why: string;
    lat: number | null; lng: number | null;
    alsoFrom: string | null;
    noPhoto: string | null;
    images: Picture[];
  };
};

export type Fictional = { id: string; name: string; rects: Rect[]; note: string | null };

export const valley = data as {
  map: { art: string; alt: string };
  epigraph: { text: string; who: string };
  places: Place[];
  fictional: Fictional[];
};

export const places = valley.places;
export const fictional = valley.fictional;

/** Places the map itself labels, which are the ones that get a hotspot. */
export const located = places.filter((p) => p.rects.length > 0);

/** A rect as inline positioning, in percentages of the map. */
export function rectStyle([x0, y0, x1, y1]: Rect): string {
  const pc = (n: number) => `${(n * 100).toFixed(2)}%`;
  return `left:${pc(x0)};top:${pc(y0)};width:${pc(x1 - x0)};height:${pc(y1 - y0)}`;
}

/** Where a pin's label should sit, so the chips don't all collide. */
export function pinStyle([x0, y0, x1, y1]: Rect): string {
  return `left:${(((x0 + x1) / 2) * 100).toFixed(2)}%;top:${(((y0 + y1) / 2) * 100).toFixed(2)}%`;
}

export function osmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
}

/**
 * The attribution line a licence requires. CC0 asks for nothing and gets one
 * anyway; everything else needs the photographer, the licence and a way back to
 * the file. Built here so no page can forget a part of it.
 */
export function creditParts(pic: Picture) {
  const cc0 = /^(cc0|public domain|pd-)/i.test(pic.license);
  return {
    artist: pic.artist,
    license: pic.license,
    licenseUrl: pic.licenseUrl,
    source: pic.source,
    commons: pic.commons.replace(/\.[a-z]+$/i, ""),
    required: !cc0, // CC0: the credit below is courtesy, not obligation
  };
}
