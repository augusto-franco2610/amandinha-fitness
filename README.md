# Amandinha Fitness

App web (funciona como app no iPhone) para registrar treinos de musculação, alimentação, peso, calorias e aplicações semanais de Mounjaro.

- **Hospedagem:** GitHub Pages (grátis)
- **Login e dados na nuvem:** Firebase, do Google (plano gratuito Spark)
- **Apple Saúde:** via app Atalhos do iPhone
- **Garmin:** treinos e frequência cardíaca entram no Saúde pelo Garmin Connect e no app pelo Strava
- **Strava e lembretes (peso 07:00, Mounjaro sexta 22:00):** Cloudflare Worker gratuito

Enquanto o Firebase não estiver configurado, o app abre em **modo demonstração** (dados só no aparelho).

---

## 1. Criar o projeto no Firebase (uma vez, ~10 min)

1. Acesse **console.firebase.google.com** com sua conta Google e clique em **Criar projeto** → nome `amandinha-fitness` → pode desativar o Google Analytics.
2. **Authentication** → **Vamos começar** → aba **Método de login** → **Google** → ativar → escolha o e-mail de suporte → **Salvar**.
3. Ainda em Authentication → aba **Configurações** → **Domínios autorizados** → **Adicionar domínio** → `SEU-USUARIO.github.io`.
4. **Firestore Database** → **Criar banco de dados** → local `southamerica-east1 (São Paulo)` → modo de produção.
5. Na aba **Regras** do Firestore, apague tudo, cole o conteúdo do arquivo `firestore.rules` deste repositório e clique em **Publicar**.
6. Engrenagem ⚙️ → **Configurações do projeto** → em "Seus apps" clique no ícone **</>** (Web) → apelido `web` → **Registrar app**. Vai aparecer um bloco `firebaseConfig` com `apiKey`, `authDomain`, `projectId` etc.

## 2. Colar a configuração no app

Abra `index.html`, procure por `const FIREBASE_CONFIG` e preencha com os valores do passo 6.
Em `EMAILS_PERMITIDOS`, coloque o Gmail da Amandinha para só ela conseguir entrar:

```js
const EMAILS_PERMITIDOS = ["email.da.amandinha@gmail.com"];
```

> A `apiKey` do Firebase pode ficar pública: quem protege os dados são as regras do Firestore (passo 5), que só deixam cada conta ver os próprios registros.

## 3. Publicar no GitHub Pages

Repositório → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch `main`, pasta `/ (root)` → **Save**.
Em 1–2 minutos o app fica em `https://SEU-USUARIO.github.io/amandinha-fitness/`.

## 4. Instalar no iPhone dela

1. Abra o link no **Safari**.
2. Compartilhar → **Adicionar à Tela de Início**.
3. Abra pelo ícone e toque em **Entrar com Google**.

## 5. Atalho do Apple Saúde

No app **Atalhos** do iPhone dela, crie um atalho chamado **Amandinha Saúde**:

1. **Obter Dicionário de** → *Entrada do Atalho*
2. **Obter Valor do Dicionário** → chave `peso`
3. **Se** *Valor do Dicionário* **tiver qualquer valor** → **Registrar Amostra de Saúde**: tipo **Peso**, valor = *Valor do Dicionário*, unidade **kg**
4. Repita 2 e 3 com a chave `kcal` e o tipo **Energia Alimentar** (kcal)

No app, o botão **Enviar peso e calorias ao Apple Saúde** (aba Diário) abre esse atalho já com os dados do dia.

**Garmin → Saúde:** no Garmin Connect, Mais → Configurações → Apps conectados → Apple Saúde → ativar. Assim os treinos, calorias gastas e frequência cardíaca do relógio entram no Saúde sozinhos.

## 6. Importar fichas de treino

Na aba Treino → **Importar**. Aceita:

- **Planilha (.xlsx ou .csv)** com colunas `Treino`, `Exercício`, `Séries`, `Repetições`, `Descanso` (o nome das colunas pode variar um pouco). Uma aba por treino também funciona.
- **PDF com texto, .txt ou texto colado**, uma linha por exercício:

```
Treino A - Inferiores
Agachamento livre 4x10-12 90s
Leg press 4x12

Treino B - Superiores
Puxada frontal 4 séries de 12
```

Cardio também é importado: linhas como `Esteira 20 min` ou `Caminhada 30 min` viram exercícios de cardio, e tabelas de progressão por semana ("1–2: …", "Semanas 3–4: …") viram o plano semanal. Dias da semana no título da ficha ("Segunda — Treino A") são lidos, e o app sugere a ficha do dia. A data de início do plano fica em Ajustes → Plano de treino.

Foto ou PDF escaneado ainda não é lido automaticamente.

## 7. Servidor do Strava e dos lembretes (Cloudflare, grátis)

O Strava exige uma chave secreta, e os lembretes precisam de algo ligado 24h para disparar no horário. Os dois ficam num Cloudflare Worker (plano gratuito, sem cartão). O código está em `servidor/worker.js`.

**7.1 Criar o Worker**
1. Crie uma conta em **dash.cloudflare.com**.
2. **Workers e Pages** → **Criar** → **Criar Worker** → nome `amandinha-fitness` → **Implantar**.
3. **Editar código** → apague tudo, cole o conteúdo de `servidor/worker.js` → **Implantar**.
4. Anote o endereço, algo como `https://amandinha-fitness.SEU-USUARIO.workers.dev`.

**7.2 Guardar as inscrições (KV)**
1. **Armazenamento e bancos de dados** → **KV** → **Criar** → nome `amandinha-subs`.
2. No Worker → **Configurações** → **Associações** → **Adicionar** → **Namespace KV** → nome da variável `SUBS` → escolha `amandinha-subs`.

**7.3 Horários dos lembretes**
No Worker → **Configurações** → **Gatilhos** → **Gatilhos Cron** → adicione os dois (horário UTC, Brasília = UTC−3):
- `0 10 * * *` → peso, todo dia às 07:00
- `0 1 * * SAT` → Mounjaro, toda sexta às 22:00

**7.4 App do Strava**
1. Entre no Strava com a conta dela e abra **strava.com/settings/api**.
2. Crie o app: nome `Amandinha Fitness`, site `https://SEU-USUARIO.github.io/amandinha-fitness/`, **Domínio de retorno de chamada** `SEU-USUARIO.github.io`.
3. Anote o **Client ID** e o **Client Secret**.

**7.5 Variáveis do Worker**
No Worker → **Configurações** → **Variáveis e segredos**:
- `APP_URL` (texto) = `https://SEU-USUARIO.github.io/amandinha-fitness/`
- `STRAVA_CLIENT_ID` (texto) = o Client ID
- `STRAVA_CLIENT_SECRET` (**segredo**) = o Client Secret

**7.6 Ligar o app ao Worker**
No `index.html`, preencha:
```js
const WORKER_URL = "https://amandinha-fitness.SEU-USUARIO.workers.dev";
const STRAVA_CLIENT_ID = "123456";
```

**7.7 No iPhone dela**
1. O app precisa estar na **Tela de Início** (passo 4). O iPhone só manda notificação de app instalado (iOS 16.4 ou mais novo).
2. Abra pelo ícone → foto no canto → **Lembretes** → **Ativar notificações** → **Permitir** → **Enviar teste**.
3. Ainda em Ajustes → **Conectar com Strava** → autorize.

O Garmin precisa estar ligado ao Strava (Garmin Connect → Apps conectados → Strava). Aí as atividades chegam ao app, e os treinos de musculação do app ganham calorias e frequência cardíaca automaticamente.

---

## Estrutura

| Arquivo | Para quê |
|---|---|
| `index.html` | O app inteiro (telas, estilos e lógica) |
| `manifest.json`, `icons/` | Ícone e nome na Tela de Início |
| `sw.js` | Deixa o app abrir com internet fraca |
| `firestore.rules` | Regras de segurança dos dados |
| `servidor/worker.js` | Servidor do Strava e dos lembretes (Cloudflare Worker) |
| `servidor/wrangler.toml` | Configuração do Worker para quem publica pela linha de comando |

Os dados ficam no Firestore em `users/{id-da-conta}/` com as coleções `fichas`, `treinos`, `diario`, `mounjaro`, `alimentos`, `atividades` e `config`.
