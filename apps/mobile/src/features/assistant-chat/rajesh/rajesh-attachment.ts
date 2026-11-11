import type { DraftComposerAttachment } from "../../../lib/composerImages";
import type { RajeshFile } from "./rajesh-gateway";

// The gateway's limits for one message: its request body caps the total, base64 included.
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Why these files cannot go in one message, or null when they can. */
export function checkRajeshAttachments(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): string | null {
  if (attachments.length > MAX_FILES)
    return `Rajesh chat sends up to ${MAX_FILES} files in one message.`;
  const total = attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  if (total > MAX_TOTAL_BYTES) return "Files in one message can add up to 8 MB.";
  return null;
}

/** The composer's files as the gateway takes them: base64 contents. */
export async function attachmentsForRajesh(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): Promise<ReadonlyArray<RajeshFile>> {
  const { File } = await import("expo-file-system");
  return Promise.all(
    attachments.map(async (attachment) => {
      // Photos are held as data URLs; other files as copies in the app's documents.
      const data =
        attachment.type === "image" && attachment.dataUrl
          ? attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1)
          : attachment.fileUri
            ? await new File(attachment.fileUri).base64()
            : null;
      if (data === null) throw new Error(`'${attachment.name}' is no longer available.`);
      return { name: attachment.name, mime: attachment.mimeType, data };
    }),
  );
}
