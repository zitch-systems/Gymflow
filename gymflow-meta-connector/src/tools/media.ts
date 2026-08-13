import type { Config } from '../config.js';
import { graphDelete, graphGet, graphPostMultipart } from '../metaClient.js';
import type { DeleteMediaInput, GetMediaUrlInput, UploadMediaInput } from '../schemas.js';
import { assertConfirmed } from './writes.js';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB — covers all Meta-supported media types

// ---------------------------------------------------------- get media URL
export interface GetMediaUrlResult {
  mediaId: string;
  url: string | undefined;
  mimeType: string | undefined;
  sha256: string | undefined;
  fileSize: string | undefined;
  note: string;
}

export async function getMediaUrl(
  config: Config,
  input: GetMediaUrlInput,
): Promise<GetMediaUrlResult> {
  const raw = (await graphGet(config, input.mediaId)) as Record<string, string | undefined>;
  return {
    mediaId: input.mediaId,
    url: raw.url,
    mimeType: raw.mime_type,
    sha256: raw.sha256,
    fileSize: raw.file_size,
    note: 'The url field is a temporary pre-signed download link valid for approximately 5 minutes.',
  };
}

// ---------------------------------------------------------- upload media
export interface UploadMediaResult {
  action: 'upload_media';
  phoneNumberId: string;
  mediaId: string | undefined;
  note: string;
}

export async function uploadMedia(
  config: Config,
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  assertConfirmed(config, input.mimeType, input.confirm);
  const phoneNumberId = input.phoneNumberId ?? config.metaPhoneNumberId;

  const dlController = new AbortController();
  const dlTimer = setTimeout(() => dlController.abort(), config.graphTimeoutMs);
  let fileBlob: Blob;
  try {
    const dlRes = await fetch(input.mediaUrl, { signal: dlController.signal });
    if (!dlRes.ok) {
      throw new Error(`Could not download media from the provided URL (HTTP ${dlRes.status}).`);
    }
    const contentLength = dlRes.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large: ${contentLength} bytes exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`);
    }
    const buf = await dlRes.arrayBuffer();
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large: ${buf.byteLength} bytes exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`);
    }
    fileBlob = new Blob([buf], { type: input.mimeType });
  } finally {
    clearTimeout(dlTimer);
  }

  const ext = input.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
  const res = (await graphPostMultipart(
    config,
    `${phoneNumberId}/media`,
    { messaging_product: 'whatsapp', type: input.mimeType },
    'file',
    fileBlob,
    `upload.${ext}`,
  )) as { id?: string };

  return {
    action: 'upload_media',
    phoneNumberId,
    mediaId: res.id,
    note: 'Use the returned mediaId to send media messages or reference it in template components.',
  };
}

// ---------------------------------------------------------- delete media
export interface DeleteMediaResult {
  action: 'delete_media';
  mediaId: string;
  deleted: boolean;
}

export async function deleteMedia(
  config: Config,
  input: DeleteMediaInput,
): Promise<DeleteMediaResult> {
  assertConfirmed(config, input.mediaId, input.confirm);
  const res = (await graphDelete(config, input.mediaId)) as { deleted?: boolean };
  return {
    action: 'delete_media',
    mediaId: input.mediaId,
    deleted: res.deleted !== false,
  };
}
