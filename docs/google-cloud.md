# Narration and AI scoring on Google Cloud

Narration uses Gemini TTS, and AI scoring of essay, shadowing, and speech questions uses Gemini. By default both run on Google AI Studio with `GEMINI_API_KEY`. This page moves them to Google Cloud Vertex AI instead, for example to bill a Google Cloud project. Studio reaches Vertex AI with one service account; Vertex AI's speech endpoint does not accept API keys, so a service account is needed even if you already have a key.

## 1. Create the service account

In the [Google Cloud console](https://console.cloud.google.com/), in the project you want to bill:

Google renamed Vertex AI to Gemini Enterprise Agent Platform in 2026, so the console may show the new names. The IDs `aiplatform.googleapis.com` and `roles/aiplatform.user` did not change.

1. Enable the **Vertex AI API**, now possibly listed as the **Agent Platform API** (APIs & Services → Library → search `aiplatform.googleapis.com` → Enable).
2. Go to IAM & Admin → Service Accounts → Create service account. Give it a name such as `ainobi-studio`.
3. Grant it the **Vertex AI User** role, now possibly listed as **Agent Platform User** (`roles/aiplatform.user`). It needs no other role.
4. Open the account → Keys → Add key → Create new key → JSON. A key file downloads.

With the `gcloud` command line, the same steps are:

```sh
gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT
gcloud iam service-accounts create ainobi-studio --project YOUR_PROJECT
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member serviceAccount:ainobi-studio@YOUR_PROJECT.iam.gserviceaccount.com --role roles/aiplatform.user
gcloud iam service-accounts keys create .ainobi/gcp-key.json \
  --iam-account ainobi-studio@YOUR_PROJECT.iam.gserviceaccount.com
```

## 2. Point Studio at it

Save the key as `.ainobi/gcp-key.json` in this repository. The `.ainobi/` folder is ignored by git, so the key is never committed. Then add to `.env.local`:

```sh
GEMINI_TTS_VERTEXAI=true
GOOGLE_APPLICATION_CREDENTIALS=.ainobi/gcp-key.json
```

Restart Studio. Its startup lines show `Narration  on, with AI scoring, on Google Cloud`.

`GEMINI_TTS_VERTEXAI=true` is the switch, and it moves narration and AI scoring together. Without it, Studio uses AI Studio whenever `GEMINI_API_KEY` is set, and Vertex AI when only the service account is. To go back, remove the line or set it to `false`.

The key file names its project, and Studio uses that project. To bill another one, add `GOOGLE_CLOUD_PROJECT=other-project`; the account needs the Vertex AI User role there.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `GEMINI_TTS_VERTEXAI` | unset | `true` for Vertex AI, `false` for AI Studio; unset, AI Studio if `GEMINI_API_KEY` is set |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | Path to the key file; relative paths are read from the repository |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | none | The key's JSON itself, instead of a file, for hosts that only take settings |
| `GOOGLE_CLOUD_PROJECT` | the key's project | The project that is billed |
| `GEMINI_TTS_LOCATION` | `global` | The Vertex AI location for narration |
| `VERTEXAI_BASE_URL` | Google's address | A relay in front of Vertex AI, where Google is not reachable directly |

## Keep the key safe

The key lets anyone who holds it use Vertex AI on your bill. Keep it out of anything you share, and delete it in the console (Keys → Delete) if it leaks.
