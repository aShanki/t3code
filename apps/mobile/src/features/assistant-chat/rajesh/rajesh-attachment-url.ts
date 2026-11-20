/** Only use Discord's signed attachment links, never a URL supplied in message text. */
export function discordPreviewURL(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith("/attachments/")
    ) {
      return url.href;
    }
  } catch {
    return;
  }
}
