# Model adapters / 模型适配器

Every generative template asks a model for **a background only**. The pipeline sends the adapter:

| Field | Type | |
|---|---|---|
| `prompt` | string | Fully resolved v2 prompt incl. the system HARD CONSTRAINTS section |
| `image` | Buffer (PNG) | Layout reference: the product cut-out already placed at its final position on white |
| `mask` | Buffer (PNG) \| null | White = editable, black = product (keep). `useMask: false` in the channel config disables it |
| `size` | `"WxH"` | Template `genSize` (multiples of 16) |
| `seed` | number \| undefined | From node params |
| `config` | object | The channel's config from Settings, merged with per-node overrides (e.g. `quality`) |

…and expects back:

```js
{ buffer /* image bytes, any size — it is resized with fit:cover */, model /* string for the ledger */,
  cost /* USD */, usage /* optional tokens */, costEstimated /* optional bool */, requestId /* optional */ }
```

Throw an `Error` with a human-readable message on failure; it is shown on the node and logged to the cost ledger.
After the adapter returns, the pipeline pastes the original product back (with alignment to wherever the model drew
it), adds shadows and text, and runs the precheck — adapters never need to care about that.

## Built-in adapters

### `http` – any synchronous JSON API, no code

Settings → 通用 HTTP API:

| Field | Example |
|---|---|
| `endpoint` | `https://api.example.com/v1/images/edits` |
| `method` | `POST` |
| `keyEnv` | `WB_HTTP_API_KEY` — the **name** of an env var. Must start with `WB_HTTP_` so the UI can't aim another channel's key at an arbitrary URL. |
| `authHeader` | `Authorization: Bearer {{key}}` (literal keys are rejected) |
| `bodyTemplate` | `{"model":"my-model","prompt":"{{prompt}}","image":"{{image_data_url}}","size":"{{size}}"}` |
| `resultPath` | `data[0].b64_json` or `images[0].url` (base64, data URI or URL). Empty = the response body is the image. |
| `pricePerImage` | `0.02` |

Template variables: `prompt`, `image_b64`, `image_data_url`, `mask_b64`, `mask_data_url`, `width`, `height`, `size`, `seed`.
A JSON string that is exactly `"{{var}}"` is replaced by the typed value (numbers stay numbers); otherwise values are
interpolated. All values are JSON-escaped safely.

Queue-style APIs (submit → poll → fetch) need a small custom adapter — see `fal.js` for a ~80-line example.

### `comfyui` – local workflows

1. In ComfyUI enable *Dev mode* and use **Save (API Format)** to export your workflow JSON.
2. Settings → 本地 ComfyUI: paste it into `workflowJson`, set `baseUrl` (default `http://127.0.0.1:8188`).
3. Map inputs as `"<nodeId>.<inputName>"`:
   - `promptNode` e.g. `6.text` (CLIPTextEncode) — required
   - `imageNode` e.g. `10.image` (LoadImage) — the layout reference is uploaded via `/upload/image`
   - `maskNode` optional (LoadImage used as a mask)
   - `seedNode` e.g. `3.seed` (KSampler)
   - `outputNode` optional; default = first node that produced images
4. Enable the channel and pick it on a canvas node.

The adapter calls `POST /upload/image` → `POST /prompt` → polls `GET /history/<id>` → `GET /view`. Width/height come
from your workflow; results are resized to the template.

### `openai`, `fal`

Keys only from `OPENAI_API_KEY` / `FAL_KEY` (no fallbacks between them). `OPENAI_BASE_URL` points the OpenAI adapter at
any compatible gateway. Both record token/price-table costs in the ledger.

### `grok` – external / manual import

The server never calls a model. It writes `data/grok_jobs/<outputId>.json` with the full prompt, aspect ratio, crop
info and a reference PNG, and the output waits in status **awaiting**. Fulfil it with any tool:

- UI: canvas → node → *Versions* → **导入背景图 / Import background** (also download the reference and copy the prompt there)
- API: `POST /api/grok/import/:outputId` with the image bytes (`Content-Type: image/png|jpeg`)
- CLI: `python3 scripts/grok_jobs.py list pending` / `prompt <id>` / `import <id> <file>`

It was built for Grok Bot's built-in image generation, but nothing in it is Grok-specific.

### `mock`

Procedural backgrounds (bathroom / texture / studio) with a MOCK badge. Used by tests and demos; the precheck marks its
output as not publishable.

## Writing your own adapter

1. Create `server/providers/myvendor.js`:

```js
import { fetchJson, toImageBuffer } from './util.js';

export default {
  id: 'myvendor', type: 'myvendor',
  keyEnv: 'MYVENDOR_API_KEY',                       // shown in Settings; channel can't be enabled without it
  keyPresent: () => Boolean(process.env.MYVENDOR_API_KEY),
  capabilities: () => ({ ops: ['img2img'], pricing: '$0.03 / image' }),
  async generate({ prompt, image, size, config }) {
    const key = process.env.MYVENDOR_API_KEY;       // read at call time; never store or log it
    if (!key) throw new Error('MYVENDOR_API_KEY is not set');
    const json = await fetchJson('https://api.myvendor.com/v1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt, image: image.toString('base64'), size }),
    }, config.timeoutSec || 180);
    return { buffer: await toImageBuffer(json.image), model: config.model || 'myvendor-v1', cost: 0.03 };
  },
};
```

2. Register it in `server/providers/index.js`: add to `ADAPTERS` and a row to `SEEDS`
   (`[id, type, display name, enabled(0/1), default config]`). Default config keys become editable fields in Settings;
   keys whose names look like secrets (`apiKey`, `token`, `secret`, `password`) are rejected by the API on purpose.
3. Add a test against a local mock server (see `test/providers.test.js`) — CI must never call a real API.
4. Document the env var in `.env.example`.
