import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NutritionInfo = {
	calories: number;
	carbohydrates: number;
	protein: number;
	fat: number;
	fiber: number;
	sugar: number;
	sodium: number;
	potassium: number;
	vitamin_c?: number;
};

type FoodItem = {
	food_id: string;
	food_name: string;
	confidence: number; // 0-1
	serving_size: string;
	nutrition: NutritionInfo;
};

type NutritionResponse = {
	foods: FoodItem[];
};

const cleanJson = (text: string) => {
	const trimmed = text.trim();
	if (trimmed.startsWith("```")) {
		const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "");
		return withoutFence.trim();
	}
	return trimmed;
};

export async function POST(req: Request) {
	try {
		const formData = await req.formData();
		const file = formData.get("image");

		if (!file || !(file instanceof File)) {
			return NextResponse.json(
				{ error: "Nenhuma imagem enviada no campo 'image'." },
				{ status: 400 },
			);
		}

		const arrayBuffer = await file.arrayBuffer();
		const base64 = Buffer.from(arrayBuffer).toString("base64");
		const mimeType = file.type || "image/jpeg";

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.2,
			messages: [
				{
					role: "system",
					content:
						"Você é uma IA de nutrição. Responda SOMENTE em JSON com o formato: { \"foods\": [ { \"food_id\": \"string\", \"food_name\": \"string\", \"confidence\": number (0-1), \"serving_size\": \"string\", \"nutrition\": { \"calories\": number, \"carbohydrates\": number, \"protein\": number, \"fat\": number, \"fiber\": number, \"sugar\": number, \"sodium\": number, \"potassium\": number, \"vitamin_c\": number|null } } ] }. Não inclua texto fora do JSON.",
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Identifique os alimentos na imagem e retorne o JSON seguindo o formato combinado.",
						},
						{
							type: "image_url",
							image_url: {
								url: `data:${mimeType};base64,${base64}`,
							},
						},
					],
				},
			],
			max_tokens: 400,
		});

		const reply = completion.choices[0].message?.content ?? "";
		const jsonString = cleanJson(reply);

		let parsed: NutritionResponse;
		try {
			parsed = JSON.parse(jsonString) as NutritionResponse;
		} catch (parseErr) {
			console.error("Falha ao parsear JSON da IA:", parseErr, jsonString);
			return NextResponse.json(
				{ error: "Resposta inesperada da IA ao analisar a imagem." },
				{ status: 502 },
			);
		}

		if (!parsed?.foods?.length) {
			return NextResponse.json(
				{ error: "Nenhum alimento identificado na imagem." },
				{ status: 422 },
			);
		}

		// Sanitiza confidence para 0-1
		const sanitized: NutritionResponse = {
			foods: parsed.foods.map((f, idx) => ({
				food_id: f.food_id || `food-${idx + 1}`,
				food_name: f.food_name || "Alimento",
				confidence: Math.max(0, Math.min(1, Number(f.confidence ?? 0))),
				serving_size: f.serving_size || "1 porção",
				nutrition: {
					calories: Number(f.nutrition?.calories ?? 0),
					carbohydrates: Number(f.nutrition?.carbohydrates ?? 0),
					protein: Number(f.nutrition?.protein ?? 0),
					fat: Number(f.nutrition?.fat ?? 0),
					fiber: Number(f.nutrition?.fiber ?? 0),
					sugar: Number(f.nutrition?.sugar ?? 0),
					sodium: Number(f.nutrition?.sodium ?? 0),
					potassium: Number(f.nutrition?.potassium ?? 0),
					vitamin_c:
						f.nutrition?.vitamin_c === undefined
							? undefined
							: Number(f.nutrition?.vitamin_c),
				},
			})),
		};

		return NextResponse.json(sanitized);
	} catch (error) {
		console.error("Erro em /api/nutrition:", error);
		return NextResponse.json(
			{ error: "Erro ao processar a imagem" },
			{ status: 500 },
		);
	}
}
