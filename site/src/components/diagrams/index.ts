// Concept diagrams for codex entries. An entry opts in with `diagram: <key>`
// in its frontmatter; the key must appear here. Each diagram is drawn only from
// what that entry already states (see the component's own note).
import Chakras from "./Chakras.astro";
import Directions from "./Directions.astro";
import Gnomon from "./Gnomon.astro";
import LakshmiStar from "./LakshmiStar.astro";
import Tattvas from "./Tattvas.astro";

export const DIAGRAMS: Record<string, any> = {
  chakras: Chakras,
  directions: Directions,
  gnomon: Gnomon,
  "lakshmi-star": LakshmiStar,
  tattvas: Tattvas,
};

export const diagramFor = (key?: string) => (key ? DIAGRAMS[key] : undefined);
