# Ultra quality (Chapter 1)

Ultra is a fourth quality in the walk's menu. In Chapter 1, where Dvij wakes in the lodge, it adds a film
look (`src/lib/walk/ultra.ts`). Every other chapter on Ultra plays exactly as High.

| Part | What it does | Where |
|---|---|---|
| Ambient occlusion | Shade in corners, under the beams and the furniture (SSAO at half resolution, a warm brown) | `ultra.ts` |
| God rays | Daylight streaming through the gaps in the boarded west window's shutters, with the room's dust hanging in it (`lodge-fx.ts`) | `ultra.ts`, `WAKE_WINDOW` |
| Bloom | A glow where the light is brightest (the window's gaps, the motes) | `ultra.ts` |
| Soft shadows | Variance shadow maps, blurred; the ceiling fan casts its turning shadow (the map redrawn each frame while it turns) | `game.ts` `setShadows` |
| The glass's splash | Water thrown from the glass as he spills it: drops that fly, fall and soak in, a wet mark on what they land on | `story/glass.ts` `splash` |
| Depth of field | Focus on whatever is in the middle of the view, eased | `ultra.ts` |
| Tone mapping and grade | AgX, a little more contrast, warmed toward amber | `ultra.ts` |
| Vignette | The corners darkened | `ultra.ts` |

## Default

The game picks Ultra by default only on a computer with its own graphics card (NVIDIA, AMD Radeon RX, Apple M
Pro/Max/Ultra, Intel Arc: `src/lib/walk/gpu.ts`). Chips built into the processor (Intel UHD and Iris, AMD's
Radeon Graphics, Apple M) keep the earlier choice by screen size: High or Medium. Anyone can pick Ultra in the
menu.

## Cost on the author's laptop (Intel UHD Graphics, 0x9A78; Chrome, D3D11; 1280×720)

Measured 23 Oct 2026 with Chapter 1's opening, the median frame over six seconds. Frames come in steps of a
60 Hz refresh (16.7 ms).

| Setting | Frame time | Frames a second |
|---|---|---|
| High | 33 ms | 30 |
| Ultra, all parts | 83 ms | 12 |
| Ultra without ambient occlusion | 67 ms | 15 |
| Ultra without god rays | 67 ms | 15 |
| Ultra without bloom | 67 ms | 15 |
| Ultra without depth of field | 51–66 ms | 15–20 |
| Ultra without soft shadows | 67 ms | 15 |
| Ultra without the fan's shadow | 65 ms | 15 |
| Ultra, only the tone curve, grade and vignette | 33 ms | 30 |

Each heavy part costs about one refresh step on this chip, and depth of field the most, so Ultra stays off by
default on integrated graphics. To weigh the parts again, open the walk with `?test&story&ultra-without=ao,rays`
(any of `ao`, `rays`, `bloom`, `dof`, `soft`, `fan`).
