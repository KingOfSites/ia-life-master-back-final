import { storage } from "@/lib/firebase-admin";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

function getUserIdFromAuth(req: Request): string | null {
    const auth = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.replace("Bearer ", "").trim();
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
        return decoded.userId ?? null;
    } catch {
        return null;
    }
}

function extFromMime(mime: string): string {
    const m = String(mime || "").toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    return "jpg";
}

export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromAuth(req);
        if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

        const formData = await req.formData();
        const imageFile = formData.get("image");
        if (!imageFile || !(imageFile instanceof File)) {
            return NextResponse.json(
                { error: "Envie uma imagem no campo 'image' (multipart/form-data)." },
                { status: 400 }
            );
        }

        const arrayBuffer = await imageFile.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        const mimeType = imageFile.type || "image/jpeg";
        const ext = extFromMime(mimeType);
        const fileName = `${userId}_${Date.now()}.${ext}`;
        const objectPath = `uploads/profile/${fileName}`;
        const bucket = storage.bucket();
        const storageFile = bucket.file(objectPath);

        await storageFile.save(buf, {
            resumable: false,
            contentType: mimeType,
            metadata: { cacheControl: "public, max-age=31536000, immutable" },
        });

        let imageUrl: string;
        try {
            await storageFile.makePublic();
            imageUrl = storageFile.publicUrl();
        } catch {
            const [signedUrl] = await storageFile.getSignedUrl({
                action: "read",
                expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
            });
            imageUrl = signedUrl;
        }

        await prisma.user.update({
            where: { id: userId },
            data: { profileImage: imageUrl },
        });

        return NextResponse.json({ profileImage: imageUrl });
    } catch (e: any) {
        console.error("[USER] profile-image upload error:", e);
        return NextResponse.json(
            { error: e?.message || "Erro ao enviar foto de perfil." },
            { status: 500 }
        );
    }
}
