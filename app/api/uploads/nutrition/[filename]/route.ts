import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    console.log("[UPLOADS] Requisição recebida:", { filename, url: req.url });
    
    // Validar nome do arquivo para prevenir path traversal
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      console.log("[UPLOADS] Nome de arquivo inválido:", filename);
      return NextResponse.json({ error: "Nome de arquivo inválido" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", "nutrition", filename);
    const uploadsDir = path.join(process.cwd(), "public", "uploads", "nutrition");
    
    // Verificar se o diretório existe
    if (!existsSync(uploadsDir)) {
      console.log("[UPLOADS] Diretório não existe:", uploadsDir);
      return NextResponse.json({ error: "Diretório de uploads não encontrado" }, { status: 404 });
    }
    
    // Verificar se o arquivo existe
    if (!existsSync(filePath)) {
      // Listar alguns arquivos do diretório para debug
      let filesInDir: string[] = [];
      try {
        const { readdir } = await import("fs/promises");
        filesInDir = (await readdir(uploadsDir)).slice(0, 10);
      } catch (e) {
        // Ignorar erro
      }
      
      console.log("[UPLOADS] Arquivo não encontrado:", {
        filePath,
        filename,
        cwd: process.cwd(),
        uploadsDir,
        dirExists: existsSync(uploadsDir),
        totalFilesInDir: filesInDir.length,
        sampleFiles: filesInDir,
        lookingFor: filename
      });
      return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
    }
    
    console.log("[UPLOADS] Servindo arquivo:", { filename, filePath });

    // Ler o arquivo
    const fileBuffer = await readFile(filePath);
    
    // Determinar o tipo MIME baseado na extensão
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    // Retornar o arquivo com headers apropriados
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("[UPLOADS] Erro ao servir arquivo:", error);
    return NextResponse.json(
      { error: "Erro ao servir arquivo" },
      { status: 500 }
    );
  }
}
