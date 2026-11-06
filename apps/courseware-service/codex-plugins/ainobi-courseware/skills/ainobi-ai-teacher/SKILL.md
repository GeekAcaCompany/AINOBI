---
name: ainobi-ai-teacher
description: Creates a new AINOBI AI teacher, the animated character that presents and narrates courseware, from a description. You draw and check every image yourself when you can generate images, and the host draws only when you cannot. Use when the user wants a new AI teacher, avatar, presenter, or narrator character.
---

# New AI teachers

A teacher is made in steps: a full-body drawing, a check of where the face and mouth are, an open-mouth version of the same drawing, a check of that version, and a final check of the finished character. The host runs these steps and does the cutting and assembling. You do the drawing and the checking when you can generate images, and then no key is needed.

## 1. Agree on the look

Ask the user what the teacher should look like, unless they said: age, hair, clothes, manner, and anything they must not be. Write it as one or two sentences in English. Tell them it takes several minutes.

## 2. Choose who draws

- **You draw (`drawn_by: "agent"`)** when you can generate images and edit an image you are given. This works on a local AINOBI Studio, where you and the host share files.
- **The host draws (`drawn_by: "host"`)** otherwise. It needs the owner's `OPENAI_API_KEY`. If the tool answers `NOT_CONFIGURED`, tell the user that a new teacher needs that key in `.env.local` or an agent that can generate images, and stop. Studio's built-in teacher is always there to use.

Then call `ai_teacher_generate { prompt, drawn_by }`.

## 3. Answer each request (when you draw)

Every result carries `agent_request` and `next`. Do what `next` says:

- **`kind: "draw"`.** Read `instructions` in full and follow them exactly: they fix the background, framing, and pose that the later steps rely on. With no `input_images`, draw the character. With an input image, edit that image only as asked (for example, open the mouth) and keep everything else identical. Save a square PNG of 1024×1024 pixels, then `ai_teacher_answer { task_id, request_id, image_path }` with its absolute path.
- **`kind: "look"`.** Open every file in `input_images` and look at it yourself. Answer exactly what the instructions ask, with coordinates in that image's own pixels, origin at the top left. Then `ai_teacher_answer { task_id, request_id, answer }`, where `answer` is only the JSON object.
- **`ANSWER_REFUSED`.** Nothing moved on: fix what the error says and answer the same request again.
- **No request yet.** The host is working: call `ai_teacher_status { task_id }`.

Judge honestly. A check you pass when the image is wrong produces a broken teacher; a check you fail makes the host ask for a new drawing, which is the right outcome. The host repeats a step a few times on its own before it gives up.

## 4. Finish

- **`succeeded`:** show the user `preview_url`, ask for a name, then `ai_teacher_save { task_id, name }`.
- **`failed`:** tell the user why in plain words, and offer to try again, perhaps with a clearer or simpler description.

The saved teacher appears in `courseware_ai_teachers`. To put it on slides and give it a voice, follow the `ainobi-courseware` skill's narration steps.
