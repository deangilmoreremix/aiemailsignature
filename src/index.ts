import { createResponse, continueResponse } from "./responses.js";
import { generateImage, editImage } from "./images.js";

/**
 * Example entry point demonstrating real API usage.
 * Replace with your application's HTTP/server layer.
 */
async function main() {
  const mode = process.argv[2];

  if (mode === "chat") {
    const reply = await createResponse("Hello, who are you?");
    console.log("RESPONSE:", reply);
  } else if (mode === "image") {
    const img = await generateImage("A serene mountain lake at sunrise, photorealistic.");
    console.log("IMAGE URL:", img.url ?? "(b64 returned)");
  } else if (mode === "image-edit") {
    console.error("image-edit requires an input file path argument.");
  } else {
    console.log("Usage: npm start -- chat | image");
  }
}

main().catch((err) => {
  console.error("[ERROR] Real API call failed:", err.message);
  process.exit(1);
});

export { createResponse, continueResponse, generateImage, editImage };
