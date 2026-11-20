import { expect, it } from "vite-plus/test";

import { discordPreviewURL } from "./rajesh-attachment-url";

it("uses only HTTPS links to Discord attachment paths", () => {
  const signed = "https://cdn.discordapp.com/attachments/1/2/clip.mp4?ex=1&hm=signed";
  expect(discordPreviewURL(signed)).toBe(signed);
  expect(discordPreviewURL("https://media.discordapp.net/attachments/1/2/photo.png")).toBeDefined();
  for (const url of [
    undefined,
    "/attachments/1/2/clip.mp4",
    "http://cdn.discordapp.com/attachments/1/2/clip.mp4",
    "https://cdn.discordapp.com.example.org/attachments/1/2/clip.mp4",
    "https://user@cdn.discordapp.com/attachments/1/2/clip.mp4",
    "https://cdn.discordapp.com:4000/attachments/1/2/clip.mp4",
    "https://cdn.discordapp.com/assets/clip.mp4",
  ]) {
    expect(discordPreviewURL(url)).toBeUndefined();
  }
});
