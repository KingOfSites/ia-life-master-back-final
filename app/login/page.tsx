"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				flexDirection: "column",
				gap: 16,
				alignItems: "flex-start",
				justifyContent: "center",
				padding: 40,
				fontFamily: "sans-serif",
				background: "linear-gradient(135deg, #113832 0%, #0b2d2c 100%)",
				color: "#f5f5f5",
			}}
		>
			<h1 style={{ margin: 0 }}>Login</h1>
			<p style={{ margin: 0, color: "#d9e3d9" }}>
				Entre com sua conta Google
			</p>

            <button
  onClick={() =>
    signIn("google", {
      callbackUrl: "/", // ou "/dashboard" se quiser ir pra outra rota
    })
  }
  style={{
    marginTop: 16,
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid #c7d423",
    background: "linear-gradient(90deg, #c7d423, #ddef00)",
    color: "#093f3f",
    fontWeight: 600,
    cursor: "pointer",
  }}
>
  Login com Google
</button>

			
		</div>
	);
}
