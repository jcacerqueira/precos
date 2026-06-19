# PriceWatch PT Comparator

App para monitorizar produtos por nome, comparar preços por loja, enviar resumo diário e alertas de promoção.

## Railway

Variáveis mínimas:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
ADMIN_API_KEY=uma-chave-secreta
CHECK_CRON=0 9 * * *
SCRAPER_USER_AGENT=Mozilla/5.0 PriceWatchPT/2.3 contact:teu-email@example.com
REQUEST_TIMEOUT_MS=15000
ENABLED_STORES=continente,auchan,pingodoce,lidl
RESEND_API_KEY=re_xxxxx
RESEND_FROM=PriceWatch PT <onboarding@resend.dev>
ALERT_TO=teu-email@example.com
```

## Lojas

Por defeito, a app usa as lojas com maior probabilidade de devolver resultados públicos:

```env
ENABLED_STORES=continente,auchan,pingodoce,lidl
```

Podes tentar ativar todas:

```env
ENABLED_STORES=continente,auchan,pingodoce,lidl,intermarche,minipreco,mercadona,aldi
```

Mas algumas lojas podem devolver `HTTP 403`, `HTTP 404` ou não ter catálogo público completo pesquisável. Isto não é erro da app: significa que a loja bloqueia scraping, não tem pesquisa pública estável, ou depende de app/localidade/loja.

## Email

A app dá prioridade à Resend se `RESEND_API_KEY` existir. SMTP fica como fallback, mas em Railway pode falhar porque portas SMTP 465/587 podem estar bloqueadas.

## Admin

Botões incluídos:

- Verificar preços agora
- Diagnóstico SMTP
- Enviar resumo teste
- Enviar promoção teste
- Executar rotina diária
