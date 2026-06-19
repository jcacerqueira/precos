# PriceWatch PT Comparator

App React + Express para monitorizar produtos por nome, comparar preços por supermercado, enviar resumo diário e alertas de promoção.

## Novidades desta versão

- Página/área de **Logs do scraper** no admin.
- Endpoint `/api/logs/scraper` com logs detalhados por produto/loja.
- Botão **Reset logs**.
- Ao abrir **Ver lojas**, aparecem todas as lojas ativas, incluindo as que ficaram `Sem resultado`.
- Logs guardam candidatos encontrados, candidatos rejeitados por score, erros 403/404/timeout e resultados aceites.
- Pesquisa tenta variações do termo, por exemplo com e sem tamanho `1.5L`.

## Variáveis recomendadas no Railway

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
CHECK_CRON=0 9 * * *
ADMIN_API_KEY=uma-chave-secreta
SCRAPER_USER_AGENT=PriceWatchPT/2.6 contact:teu-email@example.com
REQUEST_TIMEOUT_MS=15000
ENABLED_STORES=continente,auchan,pingodoce,lidl
MIN_MATCH_SCORE=25
RESEND_API_KEY=re_xxxxx
RESEND_FROM=PriceWatch PT <onboarding@resend.dev>
ALERT_TO=teu-email@example.com
```

Depois de atualizar, faz:

1. Redeploy no Railway.
2. Clica em **Reset resultados**.
3. Clica em **Reset logs**.
4. Clica em **Verificar preços agora**.
5. Abre **Ver logs scraper** para ver o que aconteceu loja a loja.

## Deploy

```powershell
git init
git branch -M main
git remote add origin https://github.com/jcacerqueira/precos.git
git add .
git commit -m "Add scraper logs and all store details"
git push -u origin main --force
```

Se o `origin` já existir:

```powershell
git remote set-url origin https://github.com/jcacerqueira/precos.git
git add .
git commit -m "Add scraper logs and all store details"
git push -u origin main --force
```
