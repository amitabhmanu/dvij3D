// What a place's 3D label says (design §10.1, §5.5). The spoiler rule is the
// flat map's, exactly: the map draws every place's name, so a label always
// names its place too (the painted drape prints those names anyway), and what
// the reader hasn't reached stays veiled where it is on the flat page, in the
// place's card. The Real India button renames labels as it does the map's pins.

export type LabelPlace = { name: string; pin: string };

export function labelText(p: LabelPlace, real: boolean): { text: string; aria: string } {
  return real ? { text: p.pin, aria: `${p.name}, most like ${p.pin}` } : { text: p.name, aria: p.name };
}
