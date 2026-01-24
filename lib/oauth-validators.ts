/**
 * Validadores de tokens OAuth para Google e Apple
 */

import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";

/**
 * Valida o token de acesso do Google
 * @param accessToken Token de acesso retornado pelo Google
 * @returns Informações do usuário se válido, null caso contrário
 */
export async function validateGoogleToken(accessToken: string): Promise<{
	id: string;
	email: string;
	name?: string;
	picture?: string;
} | null> {
	try {
		// Verificar token com a API do Google
		const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			console.error("[GOOGLE VALIDATION] Token inválido:", response.status);
			return null;
		}

		const userInfo = await response.json();

		// Validar campos obrigatórios
		if (!userInfo.id || !userInfo.email) {
			console.error("[GOOGLE VALIDATION] Dados incompletos:", userInfo);
			return null;
		}

		return {
			id: userInfo.id,
			email: userInfo.email,
			name: userInfo.name || userInfo.given_name || undefined,
			picture: userInfo.picture || undefined,
		};
	} catch (error) {
		console.error("[GOOGLE VALIDATION] Erro ao validar token:", error);
		return null;
	}
}

/**
 * Valida o identityToken da Apple
 * @param identityToken JWT token retornado pela Apple
 * @returns Informações do usuário se válido, null caso contrário
 */
export async function validateAppleToken(identityToken: string): Promise<{
	sub: string; // user ID
	email?: string;
	email_verified?: boolean;
} | null> {
	try {
		// Decodificar o token sem verificar (para obter o header)
		const decoded = jwt.decode(identityToken, { complete: true }) as any;

		if (!decoded || !decoded.header || !decoded.header.kid) {
			console.error("[APPLE VALIDATION] Token inválido: sem header ou kid");
			return null;
		}

		// Buscar as chaves públicas da Apple
		const keysResponse = await fetch("https://appleid.apple.com/auth/keys");
		if (!keysResponse.ok) {
			console.error("[APPLE VALIDATION] Erro ao buscar chaves públicas");
			return null;
		}

		const keys = await keysResponse.json();
		const key = keys.keys.find((k: any) => k.kid === decoded.header.kid);

		if (!key) {
			console.error("[APPLE VALIDATION] Chave pública não encontrada");
			return null;
		}

		// Converter a chave para formato PEM
		const publicKey = jwkToPem(key);

		// Verificar o token
		const verified = jwt.verify(identityToken, publicKey, {
			algorithms: ["RS256"],
		}) as any;

		// Validar issuer e audience
		if (verified.iss !== "https://appleid.apple.com") {
			console.error("[APPLE VALIDATION] Issuer inválido:", verified.iss);
			return null;
		}

		// Verificar expiração
		if (verified.exp && verified.exp < Date.now() / 1000) {
			console.error("[APPLE VALIDATION] Token expirado");
			return null;
		}

		return {
			sub: verified.sub,
			email: verified.email,
			email_verified: verified.email_verified === "true" || verified.email_verified === true,
		};
	} catch (error) {
		console.error("[APPLE VALIDATION] Erro ao validar token:", error);
		return null;
	}
}


 */

import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";

/**
 * Valida o token de acesso do Google
 * @param accessToken Token de acesso retornado pelo Google
 * @returns Informações do usuário se válido, null caso contrário
 */
export async function validateGoogleToken(accessToken: string): Promise<{
	id: string;
	email: string;
	name?: string;
	picture?: string;
} | null> {
	try {
		// Verificar token com a API do Google
		const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			console.error("[GOOGLE VALIDATION] Token inválido:", response.status);
			return null;
		}

		const userInfo = await response.json();

		// Validar campos obrigatórios
		if (!userInfo.id || !userInfo.email) {
			console.error("[GOOGLE VALIDATION] Dados incompletos:", userInfo);
			return null;
		}

		return {
			id: userInfo.id,
			email: userInfo.email,
			name: userInfo.name || userInfo.given_name || undefined,
			picture: userInfo.picture || undefined,
		};
	} catch (error) {
		console.error("[GOOGLE VALIDATION] Erro ao validar token:", error);
		return null;
	}
}

/**
 * Valida o identityToken da Apple
 * @param identityToken JWT token retornado pela Apple
 * @returns Informações do usuário se válido, null caso contrário
 */
export async function validateAppleToken(identityToken: string): Promise<{
	sub: string; // user ID
	email?: string;
	email_verified?: boolean;
} | null> {
	try {
		// Decodificar o token sem verificar (para obter o header)
		const decoded = jwt.decode(identityToken, { complete: true }) as any;

		if (!decoded || !decoded.header || !decoded.header.kid) {
			console.error("[APPLE VALIDATION] Token inválido: sem header ou kid");
			return null;
		}

		// Buscar as chaves públicas da Apple
		const keysResponse = await fetch("https://appleid.apple.com/auth/keys");
		if (!keysResponse.ok) {
			console.error("[APPLE VALIDATION] Erro ao buscar chaves públicas");
			return null;
		}

		const keys = await keysResponse.json();
		const key = keys.keys.find((k: any) => k.kid === decoded.header.kid);

		if (!key) {
			console.error("[APPLE VALIDATION] Chave pública não encontrada");
			return null;
		}

		// Converter a chave para formato PEM
		const publicKey = jwkToPem(key);

		// Verificar o token
		const verified = jwt.verify(identityToken, publicKey, {
			algorithms: ["RS256"],
		}) as any;

		// Validar issuer e audience
		if (verified.iss !== "https://appleid.apple.com") {
			console.error("[APPLE VALIDATION] Issuer inválido:", verified.iss);
			return null;
		}

		// Verificar expiração
		if (verified.exp && verified.exp < Date.now() / 1000) {
			console.error("[APPLE VALIDATION] Token expirado");
			return null;
		}

		return {
			sub: verified.sub,
			email: verified.email,
			email_verified: verified.email_verified === "true" || verified.email_verified === true,
		};
	} catch (error) {
		console.error("[APPLE VALIDATION] Erro ao validar token:", error);
		return null;
	}
}

