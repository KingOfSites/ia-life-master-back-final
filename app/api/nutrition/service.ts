import { openai } from "@/lib/openai";
import { nutritionPrompt } from "./prompt";

export async function analyzeFoodWithAI(imageBase64: string) {
  const response = await openai().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: nutritionPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analise esta imagem de alimento",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
            },
          },
        ],
      },
    ],
    temperature: 0.2,
  });

  const content = response.choices[0].message.content;

  if (!content) {
    throw new Error("Resposta vazia da OpenAI");
  }

  return JSON.parse(content);
}
