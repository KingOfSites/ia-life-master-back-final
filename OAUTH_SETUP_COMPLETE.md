# 🔐 Configuração Completa de OAuth (Google e Apple)

Este guia detalha como configurar login com Google e Apple para produção.

---

## 🍎 PARTE 1 — Login com Apple (Sign in with Apple)

### O que você precisa

- ✅ Conta Apple Developer ativa
- ✅ App criado no App Store Connect
- ✅ Bundle Identifier definitivo (ex: `com.ialife.app`)

### Configuração no Expo

As dependências já estão instaladas:
```bash
# Já instalado no package.json
expo-apple-authentication
```

### Uso no Frontend

O código já está implementado em `ia-life-master-front/app/login.tsx`:

```typescript
import * as AppleAuthentication from 'expo-apple-authentication';

const handleAppleLogin = async () => {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  
  // Enviar identityToken para o backend
  // O backend valida o token automaticamente
};
```

### ⚠️ Importante

- ✅ Funciona somente em **iOS real** (não funciona no simulador)
- ❌ **Não funciona no Expo Go**
- ✅ Precisa de **build** (`eas build -p ios`)
- ✅ O backend valida o `identityToken` automaticamente usando as chaves públicas da Apple

### Configuração no Xcode

1. Abra o projeto no Xcode
2. Selecione o target do app
3. Vá em **Signing & Capabilities**
4. Clique em **+ Capability**
5. Adicione **Sign in with Apple**
6. Certifique-se de que o **Bundle Identifier** está correto

### Configuração no Apple Developer Portal

1. Acesse [developer.apple.com](https://developer.apple.com)
2. Vá em **Certificates, Identifiers & Profiles**
3. Selecione seu **App ID**
4. Marque a opção **Sign in with Apple**
5. Salve as alterações

---

## 🔵 PARTE 2 — Login com Google

### O que você precisa

- ✅ Projeto no [Google Cloud Console](https://console.cloud.google.com/)
- ✅ OAuth Client IDs para:
  - iOS
  - Android
  - Web (opcional)

### Configuração no Expo

As dependências já estão instaladas:
```bash
# Já instalado no package.json
expo-auth-session
expo-web-browser
```

### Uso no Frontend

O código já está implementado em `ia-life-master-front/app/login.tsx`:

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

const [request, response, promptAsync] = Google.useAuthRequest({
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  scopes: ["openid", "profile", "email"],
});

const handleGoogleLogin = async () => {
  await promptAsync();
};
```

### ⚠️ Pontos críticos

- ⚠️ **Client IDs não podem ser trocados depois** (cuidado!)
- ⚠️ **Bundle ID / Package Name precisam ser finais**
- ❌ **Não funciona corretamente no Expo Go**
- ✅ O backend valida o `accessToken` automaticamente usando a API do Google

### Configuração no Google Cloud Console

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Ative a **Google+ API** ou **Google Identity API**
4. Vá em **APIs & Services** > **Credentials**
5. Clique em **Create Credentials** > **OAuth client ID**

#### Para iOS:

- **Application type**: iOS
- **Name**: Nome do seu app (ex: "IAlife iOS")
- **Bundle ID**: Seu Bundle ID (ex: `com.ialife.app`)
- Copie o **Client ID** gerado

#### Para Android:

- **Application type**: Android
- **Name**: Nome do seu app (ex: "IAlife Android")
- **Package name**: Seu package name (ex: `com.ialife.app`)
- **SHA-1 certificate fingerprint**: Obtenha com:
  ```bash
  # Para debug
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
  
  # Para release (quando tiver a keystore)
  keytool -list -v -keystore your-release-key.keystore -alias your-key-alias
  ```
- Copie o **Client ID** gerado

#### Para Web (opcional):

- **Application type**: Web application
- **Name**: Nome do seu app (ex: "IAlife Web")
- **Authorized redirect URIs**: Adicione as URIs de callback
- Copie o **Client ID** e **Client Secret**

---

## 🔒 PARTE 3 — Backend (Validação de Tokens)

### Validação Automática

O backend já está configurado para validar os tokens automaticamente:

#### Google Token

O backend valida o `accessToken` do Google fazendo uma requisição para:
```
GET https://www.googleapis.com/oauth2/v2/userinfo
Authorization: Bearer {accessToken}
```

Se o token for válido, retorna as informações do usuário.

#### Apple Token

O backend valida o `identityToken` da Apple:
1. Decodifica o JWT para obter o `kid` (key ID)
2. Busca as chaves públicas da Apple em `https://appleid.apple.com/auth/keys`
3. Encontra a chave correspondente ao `kid`
4. Verifica a assinatura do token
5. Valida o `iss` (issuer) e `exp` (expiração)

### Arquivos de Validação

- `ia-life-master-back/lib/oauth-validators.ts` - Funções de validação
- `ia-life-master-back/app/api/auth/oauth/route.ts` - Rota de autenticação

### Variáveis de Ambiente - Backend

No arquivo `.env` do backend (`ia-life-master-back/.env`):

```env
JWT_SECRET=seu_jwt_secret_super_seguro_aqui
DATABASE_URL=mysql://usuario:senha@host:porta/database
```

### Variáveis de Ambiente - Frontend

No arquivo `.env` do frontend (`ia-life-master-front/.env`):

```env
EXPO_PUBLIC_GOOGLE_CLIENT_ID=seu_google_web_client_id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=seu_google_ios_client_id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=seu_google_android_client_id.apps.googleusercontent.com
EXPO_PUBLIC_BASE_URL=https://seu-backend.com
```

---

## 🚀 PARTE 4 — Subir o App (Depois do Login Pronto)

### 🍎 iOS → TestFlight

1. **Build do app:**
   ```bash
   cd ia-life-master-front
   npx eas build -p ios
   ```

2. **Depois do build:**
   - O app aparece automaticamente no **App Store Connect**
   - Vá em **TestFlight**
   - Adicione testadores internos ou externos
   - Envie o convite

3. **Testar:**
   - Os testadores recebem um email
   - Baixam o app pelo TestFlight
   - Podem testar o login com Apple e Google

### 🤖 Android → Google Play (Teste Interno)

1. **Build do app:**
   ```bash
   cd ia-life-master-front
   npx eas build -p android
   ```

2. **Depois do build:**
   - Acesse [Google Play Console](https://play.google.com/console)
   - Vá em **Release** > **Testing** > **Internal testing**
   - Faça upload do arquivo `.aab` gerado
   - Adicione testadores (emails)

3. **Testar:**
   - Os testadores recebem um link
   - Baixam o app pelo link
   - Podem testar o login com Google

---

## 📝 Checklist de Configuração

### Google OAuth
- [ ] Projeto criado no Google Cloud Console
- [ ] OAuth Client ID criado para iOS
- [ ] OAuth Client ID criado para Android
- [ ] OAuth Client ID criado para Web (opcional)
- [ ] Variáveis de ambiente configuradas no frontend
- [ ] SHA-1 fingerprint adicionado para Android

### Apple Sign In
- [ ] Conta Apple Developer ativa
- [ ] App criado no App Store Connect
- [ ] Bundle ID configurado
- [ ] Capability "Sign in with Apple" adicionada no Xcode
- [ ] Capability habilitada no Apple Developer Portal

### Backend
- [ ] `JWT_SECRET` configurado no `.env`
- [ ] `DATABASE_URL` configurado no `.env`
- [ ] Dependências instaladas (`npm install`)

### Frontend
- [ ] Variáveis de ambiente configuradas no `.env`
- [ ] Build testado localmente (quando possível)

---

## 🐛 Troubleshooting

### Google Login não funciona

1. Verifique se os Client IDs estão corretos no `.env`
2. Verifique se o Bundle ID / Package Name correspondem exatamente
3. Para Android, verifique se o SHA-1 está correto
4. Teste apenas em build real (não funciona no Expo Go)

### Apple Login não funciona

1. Verifique se está testando em dispositivo iOS real (não simulador)
2. Verifique se a capability está habilitada no Xcode
3. Verifique se o Bundle ID está correto
4. Teste apenas em build real (não funciona no Expo Go)

### Erro "Token inválido" no backend

1. Verifique se o `accessToken` (Google)` ou `identityToken` (Apple) está sendo enviado
2. Verifique os logs do backend para mais detalhes
3. Para Apple, verifique se o token não expirou (eles expiram rapidamente)

---

## 📚 Referências

- [Expo Apple Authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [Expo Auth Session](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Google OAuth Setup](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign In Documentation](https://developer.apple.com/sign-in-with-apple/)

---

## ✅ Pronto!

Após seguir todos os passos, você terá:
- ✅ Login com Google funcionando (iOS, Android, Web)
- ✅ Login com Apple funcionando (iOS)
- ✅ Validação de tokens no backend
- ✅ App pronto para TestFlight e Google Play


Este guia detalha como configurar login com Google e Apple para produção.

---

## 🍎 PARTE 1 — Login com Apple (Sign in with Apple)

### O que você precisa

- ✅ Conta Apple Developer ativa
- ✅ App criado no App Store Connect
- ✅ Bundle Identifier definitivo (ex: `com.ialife.app`)

### Configuração no Expo

As dependências já estão instaladas:
```bash
# Já instalado no package.json
expo-apple-authentication
```

### Uso no Frontend

O código já está implementado em `ia-life-master-front/app/login.tsx`:

```typescript
import * as AppleAuthentication from 'expo-apple-authentication';

const handleAppleLogin = async () => {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  
  // Enviar identityToken para o backend
  // O backend valida o token automaticamente
};
```

### ⚠️ Importante

- ✅ Funciona somente em **iOS real** (não funciona no simulador)
- ❌ **Não funciona no Expo Go**
- ✅ Precisa de **build** (`eas build -p ios`)
- ✅ O backend valida o `identityToken` automaticamente usando as chaves públicas da Apple

### Configuração no Xcode

1. Abra o projeto no Xcode
2. Selecione o target do app
3. Vá em **Signing & Capabilities**
4. Clique em **+ Capability**
5. Adicione **Sign in with Apple**
6. Certifique-se de que o **Bundle Identifier** está correto

### Configuração no Apple Developer Portal

1. Acesse [developer.apple.com](https://developer.apple.com)
2. Vá em **Certificates, Identifiers & Profiles**
3. Selecione seu **App ID**
4. Marque a opção **Sign in with Apple**
5. Salve as alterações

---

## 🔵 PARTE 2 — Login com Google

### O que você precisa

- ✅ Projeto no [Google Cloud Console](https://console.cloud.google.com/)
- ✅ OAuth Client IDs para:
  - iOS
  - Android
  - Web (opcional)

### Configuração no Expo

As dependências já estão instaladas:
```bash
# Já instalado no package.json
expo-auth-session
expo-web-browser
```

### Uso no Frontend

O código já está implementado em `ia-life-master-front/app/login.tsx`:

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

const [request, response, promptAsync] = Google.useAuthRequest({
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  scopes: ["openid", "profile", "email"],
});

const handleGoogleLogin = async () => {
  await promptAsync();
};
```

### ⚠️ Pontos críticos

- ⚠️ **Client IDs não podem ser trocados depois** (cuidado!)
- ⚠️ **Bundle ID / Package Name precisam ser finais**
- ❌ **Não funciona corretamente no Expo Go**
- ✅ O backend valida o `accessToken` automaticamente usando a API do Google

### Configuração no Google Cloud Console

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Ative a **Google+ API** ou **Google Identity API**
4. Vá em **APIs & Services** > **Credentials**
5. Clique em **Create Credentials** > **OAuth client ID**

#### Para iOS:

- **Application type**: iOS
- **Name**: Nome do seu app (ex: "IAlife iOS")
- **Bundle ID**: Seu Bundle ID (ex: `com.ialife.app`)
- Copie o **Client ID** gerado

#### Para Android:

- **Application type**: Android
- **Name**: Nome do seu app (ex: "IAlife Android")
- **Package name**: Seu package name (ex: `com.ialife.app`)
- **SHA-1 certificate fingerprint**: Obtenha com:
  ```bash
  # Para debug
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
  
  # Para release (quando tiver a keystore)
  keytool -list -v -keystore your-release-key.keystore -alias your-key-alias
  ```
- Copie o **Client ID** gerado

#### Para Web (opcional):

- **Application type**: Web application
- **Name**: Nome do seu app (ex: "IAlife Web")
- **Authorized redirect URIs**: Adicione as URIs de callback
- Copie o **Client ID** e **Client Secret**

---

## 🔒 PARTE 3 — Backend (Validação de Tokens)

### Validação Automática

O backend já está configurado para validar os tokens automaticamente:

#### Google Token

O backend valida o `accessToken` do Google fazendo uma requisição para:
```
GET https://www.googleapis.com/oauth2/v2/userinfo
Authorization: Bearer {accessToken}
```

Se o token for válido, retorna as informações do usuário.

#### Apple Token

O backend valida o `identityToken` da Apple:
1. Decodifica o JWT para obter o `kid` (key ID)
2. Busca as chaves públicas da Apple em `https://appleid.apple.com/auth/keys`
3. Encontra a chave correspondente ao `kid`
4. Verifica a assinatura do token
5. Valida o `iss` (issuer) e `exp` (expiração)

### Arquivos de Validação

- `ia-life-master-back/lib/oauth-validators.ts` - Funções de validação
- `ia-life-master-back/app/api/auth/oauth/route.ts` - Rota de autenticação

### Variáveis de Ambiente - Backend

No arquivo `.env` do backend (`ia-life-master-back/.env`):

```env
JWT_SECRET=seu_jwt_secret_super_seguro_aqui
DATABASE_URL=mysql://usuario:senha@host:porta/database
```

### Variáveis de Ambiente - Frontend

No arquivo `.env` do frontend (`ia-life-master-front/.env`):

```env
EXPO_PUBLIC_GOOGLE_CLIENT_ID=seu_google_web_client_id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=seu_google_ios_client_id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=seu_google_android_client_id.apps.googleusercontent.com
EXPO_PUBLIC_BASE_URL=https://seu-backend.com
```

---

## 🚀 PARTE 4 — Subir o App (Depois do Login Pronto)

### 🍎 iOS → TestFlight

1. **Build do app:**
   ```bash
   cd ia-life-master-front
   npx eas build -p ios
   ```

2. **Depois do build:**
   - O app aparece automaticamente no **App Store Connect**
   - Vá em **TestFlight**
   - Adicione testadores internos ou externos
   - Envie o convite

3. **Testar:**
   - Os testadores recebem um email
   - Baixam o app pelo TestFlight
   - Podem testar o login com Apple e Google

### 🤖 Android → Google Play (Teste Interno)

1. **Build do app:**
   ```bash
   cd ia-life-master-front
   npx eas build -p android
   ```

2. **Depois do build:**
   - Acesse [Google Play Console](https://play.google.com/console)
   - Vá em **Release** > **Testing** > **Internal testing**
   - Faça upload do arquivo `.aab` gerado
   - Adicione testadores (emails)

3. **Testar:**
   - Os testadores recebem um link
   - Baixam o app pelo link
   - Podem testar o login com Google

---

## 📝 Checklist de Configuração

### Google OAuth
- [ ] Projeto criado no Google Cloud Console
- [ ] OAuth Client ID criado para iOS
- [ ] OAuth Client ID criado para Android
- [ ] OAuth Client ID criado para Web (opcional)
- [ ] Variáveis de ambiente configuradas no frontend
- [ ] SHA-1 fingerprint adicionado para Android

### Apple Sign In
- [ ] Conta Apple Developer ativa
- [ ] App criado no App Store Connect
- [ ] Bundle ID configurado
- [ ] Capability "Sign in with Apple" adicionada no Xcode
- [ ] Capability habilitada no Apple Developer Portal

### Backend
- [ ] `JWT_SECRET` configurado no `.env`
- [ ] `DATABASE_URL` configurado no `.env`
- [ ] Dependências instaladas (`npm install`)

### Frontend
- [ ] Variáveis de ambiente configuradas no `.env`
- [ ] Build testado localmente (quando possível)

---

## 🐛 Troubleshooting

### Google Login não funciona

1. Verifique se os Client IDs estão corretos no `.env`
2. Verifique se o Bundle ID / Package Name correspondem exatamente
3. Para Android, verifique se o SHA-1 está correto
4. Teste apenas em build real (não funciona no Expo Go)

### Apple Login não funciona

1. Verifique se está testando em dispositivo iOS real (não simulador)
2. Verifique se a capability está habilitada no Xcode
3. Verifique se o Bundle ID está correto
4. Teste apenas em build real (não funciona no Expo Go)

### Erro "Token inválido" no backend

1. Verifique se o `accessToken` (Google)` ou `identityToken` (Apple) está sendo enviado
2. Verifique os logs do backend para mais detalhes
3. Para Apple, verifique se o token não expirou (eles expiram rapidamente)

---

## 📚 Referências

- [Expo Apple Authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [Expo Auth Session](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Google OAuth Setup](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign In Documentation](https://developer.apple.com/sign-in-with-apple/)

---

## ✅ Pronto!

Após seguir todos os passos, você terá:
- ✅ Login com Google funcionando (iOS, Android, Web)
- ✅ Login com Apple funcionando (iOS)
- ✅ Validação de tokens no backend
- ✅ App pronto para TestFlight e Google Play

