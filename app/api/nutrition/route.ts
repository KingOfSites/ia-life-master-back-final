import { NextResponse } from "next/server";
import { analyzeFoodWithAI } from "./service";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get("image") as File | null;

    if (!image) {
      return NextResponse.json(
        { error: "Imagem não enviada" },
        { status: 400 }
      );
    }

    // cria arquivo temporário
    const buffer = Buffer.from(await image.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), image.name);
    fs.writeFileSync(tempPath, buffer);

    // converte para base64
    const base64 = fs.readFileSync(tempPath).toString("base64");

    // chama a IA
    const result = await analyzeFoodWithAI(base64);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro /api/nutrition:", error);
    return NextResponse.json(
      { error: "Erro ao analisar imagem" },
      { status: 500 }
    );
  }
}
