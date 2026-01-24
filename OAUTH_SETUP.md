# Configuração de OAuth (Google e Apple)

Este documento descreve como configurar o login com Google e Apple para produção.

## Variáveis de Ambiente - Backend

No arquivo `.env` do backend (`ia-life-master-back/.env`), certifique-se de ter:

```env
JWT_SECRET=seu_jwt_secret_aqui
```

## Variáveis de Ambiente - Frontend

No arquivo `.env` do frontend (`ia-life-master-front/.env`), adicione:

```env
EXPO_PUBLIC_GOOGLE_CLIENT_ID=seu_google_client_id_aqui
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=seu_google_ios_client_id_aqui
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=seu_google_android_client_id_aqui
```

## Configuração do Google OAuth

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Ative a API "Google+ API" ou "Google Identity"
4. Vá em "Credenciais" > "Criar credenciais" > "ID do cliente OAuth 2.0"
5. Configure:
   - **Tipo de aplicativo**: iOS e Android (crie uma credencial para cada)
   - **Nome**: Nome do seu app
   - **Bundle ID (iOS)**: O bundle ID do seu app iOS (ex: `com.ialife.app`)
   - **Package name (Android)**: O package name do seu app Android (ex: `com.ialife.app`)
6. Copie os Client IDs gerados e adicione nas variáveis de ambiente do frontend

### Para Web (opcional)

Se você também quiser suportar login via web, adicione no backend `.env`:

```env
GOOGLE_CLIENT_ID=seu_google_web_client_id
GOOGLE_CLIENT_SECRET=seu_google_web_client_secret
```

## Configuração do Apple Sign In

O Apple Sign In funciona automaticamente no iOS sem necessidade de configuração adicional no código, mas você precisa:

1. Ter uma conta de desenvolvedor Apple
2. Configurar o "Sign in with Apple" no [Apple Developer Portal](https://developer.apple.com/)
3. Adicionar a capability "Sign in with Apple" no seu projeto Xcode
4. Configurar o App ID com a capability habilitada

### Passos no Xcode:

1. Abra o projeto no Xcode
2. Selecione o target do app
3. Vá em "Signing & Capabilities"
4. Clique em "+ Capability"
5. Adicione "Sign in with Apple"

## Testando

### Google:
- No iOS: O login deve abrir o navegador ou o app do Google
- No Android: O login deve abrir o navegador ou o app do Google

### Apple:
- No iOS: O login deve mostrar o modal nativo do Apple Sign In
- No Android: Não disponível (botão não aparece)

## Notas Importantes

1. **Apple Sign In** só funciona em dispositivos iOS reais (não funciona no simulador)
2. **Google OAuth** requer que você configure os redirect URIs corretamente no Google Cloud Console
3. Certifique-se de que as variáveis de ambiente estão configuradas antes de fazer o build para produção
4. Para produção, use variáveis de ambiente diferentes das de desenvolvimento

## Troubleshooting

### Google não abre:
- Verifique se as variáveis de ambiente estão configuradas
- Verifique se o Client ID está correto
- Verifique se o Bundle ID/Package Name corresponde ao configurado no Google Cloud Console

### Apple não aparece:
- Verifique se está testando em um dispositivo iOS real
- Verifique se a capability está habilitada no Xcode
- Verifique se o App ID tem a capability habilitada no Apple Developer Portal

