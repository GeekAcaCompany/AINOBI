# @ainobi/avatar-generator

Generates an Inochi2D avatar (`.inx`) from a text description. An image model draws the character, then a vision model checks the composition, the mouth variants, and the finished model. Anything that fails a check raises `AvatarPipelineError`, so a half-finished avatar is never delivered.

Runtime: Node.js. It calls an OpenAI compatible API for images and vision, so it needs a key and costs money per run.

```ts
import { generateAvatarModel } from '@ainobi/avatar-generator';

const { modelPath, previewPath } = await generateAvatarModel({
  prompt: 'A warm young science teacher in a blue blazer',
  outputDir: './out',
  settings: { apiKey, apiBase: null, imageModel: 'gpt-image-1', visionModel: 'gpt-4o' },
});
```

`modelPath` is the `.inx` file, which `@ainobi/avatar` renders, and `previewPath` is a PNG of the character.

## When the agent is the model

An AI agent that can draw and see can stand in for the image and vision models, with no key. `AgentModelBridge` turns each model call into a request the agent answers: draw an image and give its file, or look at images and give the JSON verdict. The pipeline, its prompts, and its quality gates are the same as with a hosted model.

```ts
import { AGENT_PIPELINE_SETTINGS, AgentModelBridge, agentPipelineClients, generateAvatarModel } from '@ainobi/avatar-generator';

const bridge = new AgentModelBridge({ dir: './out/agent' });
const done = generateAvatarModel({ prompt, outputDir: './out', settings: AGENT_PIPELINE_SETTINGS, clients: agentPipelineClients(bridge) });
// Show bridge.pending to the agent; pass its reply to bridge.answer(request_id, { image_path } or { answer }).
```

Requests and answers are files, so the agent must share the machine's disk. An answer the agent can fix, such as a non-square image, throws `AgentAnswerError` and the request stays open.
