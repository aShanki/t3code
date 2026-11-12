import type { DraftComposerAttachment } from "../../../lib/composerImages";
import { uuidv4 } from "../../../lib/uuid";
import type { RajeshFile, RajeshOutgoingFile } from "./rajesh-gateway";

// Each file is uploaded on its own; the thread composer's picker already caps each one's size.
const MAX_FILES = 10;
/** What gateways without streamed uploads take in one message, base64 included. */
const MAX_INLINE_BYTES = 8 * 1024 * 1024;

/** Why these files cannot go in one message, or null when they can. */
export function checkRajeshAttachments(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): string | null {
  return attachments.length > MAX_FILES
    ? `Rajesh chat sends up to ${MAX_FILES} files in one message.`
    : null;
}

/**
 * The composer's files as device files to upload. Photos held only as data URLs are written to
 * the cache first; the returned cleanup removes those copies.
 */
export async function filesForRajesh(attachments: ReadonlyArray<DraftComposerAttachment>) {
  const { Directory, File, Paths } = await import("expo-file-system");
  const written: InstanceType<typeof File>[] = [];
  const cleanup = () => {
    for (const file of written) {
      try {
        if (file.exists) file.delete();
      } catch {}
    }
  };
  try {
    const files = attachments.map((attachment): RajeshOutgoingFile => {
      const base = { uploadId: uuidv4(), name: attachment.name, mime: attachment.mimeType };
      if (attachment.fileUri) {
        return { ...base, uri: attachment.fileUri, size: attachment.sizeBytes };
      }
      if (attachment.type === "image" && attachment.dataUrl) {
        const folder = new Directory(Paths.cache, "rajesh-outgoing");
        folder.create({ idempotent: true, intermediates: true });
        const copy = new File(folder, base.uploadId);
        copy.write(attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1), {
          encoding: "base64",
        });
        written.push(copy);
        return { ...base, uri: copy.uri, size: copy.size ?? attachment.sizeBytes };
      }
      throw new Error(`'${attachment.name}' is no longer available.`);
    });
    return { files, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** The same files as base64, for a gateway that cannot take streamed uploads; null if too large. */
export async function inlineRajeshFiles(
  files: ReadonlyArray<RajeshOutgoingFile>,
): Promise<ReadonlyArray<RajeshFile> | null> {
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_INLINE_BYTES) return null;
  const { File } = await import("expo-file-system");
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mime: file.mime,
      data: await new File(file.uri).base64(),
    })),
  );
}
