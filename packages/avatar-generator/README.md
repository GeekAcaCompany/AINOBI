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
