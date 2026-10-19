# The valley in 3D: device checklist

Playwright drives Chrome only, so these need a person (design §10.1, §18 item 14). For each browser below,
open `/valley/`, press **3D**, and tick what holds.

| Check | Edge | Firefox | Safari (Mac) | Chrome (Android) | Safari (iPhone) |
|---|---|---|---|---|---|
| The flat map shows first, and **3D** draws the valley within a few seconds | | | | | |
| Dragging turns the view; scrolling or pinching zooms; it never shows the land's underside | | | | | |
| All 8 place labels are readable and stay inside the view | | | | | |
| Tapping a label flies there and names it; "Read about it" lands on its card | | | | | |
| **Real India** renames the labels, and back again | | | | | |
| **Map** returns to the flat map, and the page scrolls normally | | | | | |
| Movement feels smooth (no long stalls while turning) | | | | | |
| `/valley/#3d` opens straight into 3D | | | | | |
| With "reduce motion" on in the system settings, choosing a place cuts instead of flying | | | | | |
| Desktop only: Tab reaches every label, Enter flies, arrow keys turn, + and - zoom, Home resets | | | — | — | — |

If a browser can't draw 3D at all, the **3D** button should say so and leave the flat map in place; that counts as a
pass for the fallback, but note which browser it was.
