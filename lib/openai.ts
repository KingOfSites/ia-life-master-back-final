import OpenAI from "openai";

let openaiInstance: OpenAI | null = null;

export const openai = (): OpenAI => {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.");
    }
    openaiInstance = new OpenAI({
      apiKey,
    });
  }
  return openaiInstance;
};
