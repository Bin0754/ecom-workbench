# Prompt templates / 提示词模板

Generative templates (PT01 ingredients, PT03 texture, PT04 benefits, PT05 lifestyle scene, A+ header / banner / tile)
use **sectioned v2 prompts** (`server/prompts.js` → `PROMPTS_V2`). Admins edit the defaults in Settings → 模板;
designers can override per node on the canvas (section by section or as raw text).

## Sections

```
## PURPOSE        what this Amazon image is for and what the overlay will say
## SUBJECT        the locked product from Image 1 (form, colors) — do not edit the product
## SCENE & SET    surface, props (derived from ingredients), background depth
## CAMERA         matches the angle of the source photo (front / 45° / side / top / macro)
## LIGHTING       key light side detected from the photo, fill and shadow sides
## COMPOSITION    where the product sits and which zone must stay calm for text
## STYLE          commercial clean-beauty photography, mood from benefits
## HARD CONSTRAINTS   appended by the system — cannot be removed by a template
```

The HARD CONSTRAINTS section always says: one product only (no duplicates), do not redraw/move/relabel it, no text or
logos, no people/hands, the product rests on a surface with a contact shadow, keep the text zone calm, photorealistic.

## Variables

Write `{variable}` anywhere in a template. Values come from the SKU record, the source photo analysis and node params:

| Variable | Source |
|---|---|
| `{name}`, `{brand}` | SKU |
| `{product_type}`, `{product_form}` | inferred from the name (serum dropper, cream jar, tube, toner, pump, sheet mask…) or set explicitly |
| `{product_colors}` | dominant colors of the cut-out |
| `{hero_ingredients}` | first ingredients, % stripped |
| `{ingredient_props}`, `{ingredient_prop}` | ingredient → prop map (vitamin C → orange slices, hyaluronic → droplets, oat → rolled oats…) |
| `{palette}` | node param › SKU palette › ingredient palette (+ brand colors) |
| `{key_benefit}`, `{benefit_mood}` | first benefit; mood from benefit keywords |
| `{audience}` | SKU audience or a sensible default |
| `{scene}` | node param › SKU scene › marble vanity |
| `{texture_desc}`, `{texture_surface}`, `{formula_color}` | per product form |
| `{camera}` | from the source angle |
| `{light_side}`, `{fill_side}`, `{shadow_side}` | from the photo's luminance gradient |
| `{product_zone}`, `{text_zone}` | from the template layout spec |

Unknown variables are left as-is (and the unit tests fail if a built-in template leaves one unresolved).

## Adding a template

Templates live in `server/templates.js`:

```js
{ id: 'PT08', name: 'My template', slot: 'PT08', width: 2000, height: 2000, sort: 12,
  spec: { bg: 'generate', genSize: '1024x1024', product: { cx: 0.5, cy: 0.6, h: 0.5, maxW: 0.5 },
          pasteBack: true, layout: 'none', sources: ['front', '45deg'] },
  prompt: PROMPTS_V2.PT08 }
```

- `bg`: `white` (deterministic MAIN), `solid` (layout only), `generate` (model background)
- `product`: center (`cx`, `cy`), height `h` and max width `maxW` as fractions of the canvas; `fill` for MAIN
- `layout`: text overlay renderer in `pipeline.js` (`ingredients`, `howto`, `texture`, `benefits`, `size`, `inbox`, `aplus_header`, `aplus_banner`, `none`)
- `sources`: preferred source angles in order
- `slot`: Amazon slot used for export naming (`MAIN`, `PT01`…`PT08`, or `APLUS`)

Templates are upserted into the DB on start; an admin's edited prompt is preserved.

## Tips

- Keep text out of prompts' visual content — all copy is overlaid by code, which is what keeps it accurate and compliant.
- Shoot sources straight-on when possible; strongly tilted products are harder for models to respect and may "ghost".
- Use *recomposite* (regenerate without calling the model) after changing only copy or layout.
