# Google Cloud for narration and AI scoring

Narration uses Gemini TTS, and AI scoring of essay, shadowing, and speech questions uses Gemini, both on Google Cloud Vertex AI. Studio reaches them with one service account. Vertex AI's speech endpoint does not accept API keys, so a service account is needed even if you already have a key.

## 1. Create the service account

In the [Google Cloud console](https://console.cloud.google.com/), in the project you want to bill:

1. Enable the **Vertex AI API** (APIs & Services → Library → Vertex AI API → Enable).
2. Go to IAM & Admin → Service Accounts → Create service account. Give it a name such as `ainobi-studio`.
3. Grant it the **Vertex AI User** role (`roles/aiplatform.user`). It needs no other role.
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
GOOGLE_APPLICATION_CREDENTIALS=.ainobi/gcp-key.json
```

Restart Studio. Its startup lines show `Narration  on, with AI scoring`.

The key file names its project, and Studio uses that project. To bill another one, add `GOOGLE_CLOUD_PROJECT=other-project`; the account needs the Vertex AI User role there.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | Path to the key file; relative paths are read from the repository |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | none | The key's JSON itself, instead of a file, for hosts that only take settings |
| `GOOGLE_CLOUD_PROJECT` | the key's project | The project that is billed |
| `GEMINI_TTS_LOCATION` | `global` | The Vertex AI location for narration |
| `VERTEXAI_BASE_URL` | Google's address | A relay in front of Vertex AI, where Google is not reachable directly |

## Keep the key safe

The key lets anyone who holds it use Vertex AI on your bill. Keep it out of anything you share, and delete it in the console (Keys → Delete) if it leaks.
