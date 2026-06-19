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


## Melhorias desta versão

- Botão **Reset resultados** no admin: apaga `store_results` e histórico de notificações, mantendo os produtos monitorizados.
- A tabela de produtos monitorizados passa a mostrar o link **Abrir loja** para o resultado mais barato.
- A deteção de promoção ficou mais restrita: já não marca promoção só porque aparece texto genérico como “promoções” ou “campanhas” no card/site.
- A pesquisa guarda apenas o melhor resultado por loja e usa `MIN_MATCH_SCORE` para reduzir falsos positivos.

Opcional:

```env
MIN_MATCH_SCORE=35
```


## Versão 2.5 — preço correto e detalhes por supermercado

Melhorias incluídas:

- Corrige casos em que o scraper lia PVPR/preço antigo como preço atual, como `PVPR 2,04€` em vez de `1,35€`.
- Ignora preços unitários como `0,90 €/lt`, `0,99 €/Lt`, `€/kg`, `€/100ml` e valores de depósito.
- Guarda PVPR/preço anterior como `oldPrice` e usa-o para marcar promoção quando é maior que o preço atual.
- Na tabela de produtos, o botão **Ver lojas** abre todos os resultados recentes por supermercado, com preço, estado, score e link direto.
- Mantém o botão **Reset resultados** para limpar resultados antigos antes de voltar a verificar.

Depois de instalar esta versão, clica em **Reset resultados** e depois em **Verificar preços agora** para eliminar resultados antigos que tinham preços mal extraídos.
