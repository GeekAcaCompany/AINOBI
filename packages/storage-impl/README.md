# @ainobi/storage-impl

The object storage implementations behind `@ainobi/storage`: Aliyun OSS and S3-compatible stores (OCI Object Storage and others), with the presigned URL formats stored objects depend on.

Runtime: Node.

```ts
import { configureCloudStorage, getCloudStorageClient, presignS3Url } from '@ainobi/storage-impl';

configureCloudStorage({
  cloud_storage_provider: 'aliyun_oss',
  aliyun_oss_bucket: 'my-bucket',
  aliyun_oss_endpoint: 'oss-ap-northeast-1.aliyuncs.com',
  aliyun_oss_access_key_id: process.env.OSS_ACCESS_KEY_ID ?? '',
  aliyun_oss_access_key_secret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
});

const client = getCloudStorageClient();
await client.uploadFile('raw/pdf/abc.pdf', pdfBytes, 'application/pdf');
const url = await presignS3Url('raw/pdf/abc.pdf');
```

The package reads no environment variables: `configureCloudStorage` takes the settings once at your composition root (`CloudStorageSettings`, defaults in `DEFAULT_CLOUD_STORAGE_SETTINGS`). Besides the clients it exports the key and URL helpers (`normalizeS3ObjectKey`, `parseS3BucketKey`, `guessContentType`) and the presigned URL builders (`buildOssV1PresignedGetUrl`, `buildS3PresignedGetUrl`, …).

The builders are pure functions and are also published on their own as `@ainobi/storage-impl/signing`, which loads neither SDK — for hosts that only sign URLs, or that bring their own transport:

```ts
import { buildS3PresignedGetUrl } from '@ainobi/storage-impl/signing';

const url = buildS3PresignedGetUrl({
  accessKeyId, secretAccessKey, region: 'ap-tokyo-1',
  endpointUrl: 'ns.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com',
  bucketName: 'courseware', objectKey: 'raw/pdf/abc.pdf',
  expiresInSeconds: 3600, now: new Date(),
});
```

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/storage-impl build
pnpm --filter @ainobi/storage-impl pack --pack-destination ./tarballs
npm install ./tarballs/example-storage-impl-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
